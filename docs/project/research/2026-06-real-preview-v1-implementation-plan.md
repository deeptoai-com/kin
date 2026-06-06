# 真预览 v1 实施计划（架构师已拍板）

> 日期：2026-06-04 ｜ 状态：**已定（架构师拍板）**，待沙盒新对话执行
> 关联：`2026-06-real-preview-architect-brief.md`（评审简报 + 业界对比）、`2026-06-workbench-artifact-ordering-fix-plan.md`（UI/IA）。
> 一句话决策：**Traefik 子域名反代 + 一次性 token 换 preview cookie + `.oxygenie/app.json`/package 探测声明 app + 纯前端 SPA static preview 为硬验收；Live/dev 与服务端应用为 best-effort。**

---

## 1. v1 范围（硬验收口径）

> **Vite / CRA / 普通纯前端 SPA：`install → build → static serve → iframe 可见`。**

- Next（server）、Express、带 API/env 的项目 → **best-effort / 下一版**（走 Live/dev 或后续），不作为 v1 成功标准。
- Live/dev（HMR，编辑态）= best-effort；**Static（完成态）= 硬验收**。

---

## 2. 架构组件

### 2.1 新增 `PreviewRuntime`（独立于 agent 主链路 / 现有 `DockerBackend`）
**不改** agent 工具执行（继续 one-shot `DockerBackend`）。新增一层 `PreviewRuntime` / `SessionSandboxManager`：

```ts
type PreviewProvider = 'docker' | 'e2b' | 'daytona'   // v1 只实现 docker

interface PreviewRuntime {
  ensureSessionSandbox(sessionId): Promise<SandboxHandle>   // per-session 持久容器
  installDeps(previewId): Promise<void>                     // 流式日志/超时/可取消/缓存
  startPreview({ sessionId, manifest, mode }): Promise<{ previewId, internalPort }>
  stopPreview(previewId): Promise<void>
  reapIdlePreviews(): Promise<void>
  getPreviewUrl(previewId): string
}
```
- **per-session 持久容器**：挂载该 session 的 workspace + **持久 `node_modules` 卷**（跨预览缓存）；低权限用户、**无宿主密钥、无 Docker socket**、资源限额。
- **双档**：`mode='static'`（默认/硬验收）= 跑 `buildCommand` → 用 **preview 镜像内置的小静态服务器** serve `dist/`（不依赖用户项目装 `serve`）；`mode='live'`（best-effort）= 跑 `devCommand`（HMR）。

### 2.2 `preview-controller` sidecar（关键安全护栏）
- **唯一持有 Docker socket 的组件**；app / PreviewManager 通过它的内部 API 起停容器，**绝不**把 docker socket 塞进 app/preview 容器。
- v1 若为提速让 app 直接管：至少走 **socket-proxy + 最小权限**；preview 容器本身永远不碰 socket。

### 2.3 路由：Traefik + Docker provider + forward-auth
- 复用现有 Traefik（Dokploy 生产链路已是 Traefik）。preview 容器起来时打 **Traefik labels** → 动态被发现，免静态配置。
- 域名：
  - **本地**：`<previewId>.127-0-0-1.sslip.io`；**主站也用同族**（如 `app.127-0-0-1.sslip.io`）——不要 localhost/sslip 混用（否则 iframe cookie 更麻烦）。
  - **生产**：`<previewId>.preview.<domain>` + **wildcard DNS + wildcard cert**。
  - **子路径** = 仅最后兜底，不入主线。
  - **v1 不做 per-preview on-demand TLS。**
- **forward-auth** 中间件 → 命中 app 的鉴权端点：校验 preview cookie（或首次的 bootstrap token）+ **该用户对该 session 有权**，再放行。

### 2.4 鉴权流（跨源、一次性 token 换 cookie）
1. 用户点「预览」→ 主站签发 **bootstrap JWT**：`exp=60~120s`，带 `jti / previewId / sessionId / userId`，服务端记录 jti（Redis）**一次性消费**。
2. token 放 URL，仅用于首次进入：`https://<previewId>.preview.<domain>/__oxy/auth?t=<jwt>`。
3. `/__oxy/auth` 校验 jti（一次性消费）→ 种 **preview cookie** → **302 去掉 URL token**。
4. preview cookie：**opaque session id**（Redis/DB 存映射），TTL 10~15min 滑动续期、**受 preview idle reaper 约束**；`httpOnly` + 生产 `Secure` + **host-only**（不宽泛种到主域）。
5. 后续静态资源 / HMR ws 全靠该 cookie 经 forward-auth。
- URL 常驻 token 仅极端 fallback，不入主路径。

### 2.5 App manifest：`.oxygenie/app.json`（唯一 schema）
```jsonc
{
  "rootDir": "string", "title": "string", "framework": "vite|cra|next|...",
  "installCommand": "pnpm install", "buildCommand": "pnpm build",
  "devCommand": "pnpm dev", "serveCommand": "string?",
  "port": 5173, "entryFiles": ["..."]
}
```
- **v1**：启发式扫描（探 `package.json` + framework）生成一份**临时 manifest** 写进 `.oxygenie/app.json`。
- **未来 (A)**：`declare_app`/`preview_ready` 自定义 SDK 工具只是**写/更新同一份 manifest + 发 ready 事件**——无缝接上（留到 SDK 那轮）。
- **命令校验**：v1 只允许 **`package.json` scripts**（`pnpm build`/`pnpm dev`/`npm run build`），**少碰自由 shell**，不无条件执行任意字符串。

### 2.6 UI（接 `…-fix-plan.md` 的 IA）
- **每个 App 一张「成果物/预览」交付物卡**（非每文件）；卡片 → 打开预览（默认 **Static**；可切 **Live**）。
- 显示 install/build 日志 + 状态机：`installing → building → ready → failed → idle-stopped`。

---

## 3. 配置（16G/8-core 起步）
```
MAX_CONCURRENT_WORKERS=8           # 既有
MAX_ACTIVE_PREVIEWS=4~6            # 新增；install 中的 preview 也占名额
PREVIEW_IDLE_TIMEOUT_MS=300000~600000   # 5~10min
PREVIEW_MEMORY=512m~1g
```
- 会话可 50 个，**同时在跑的 preview 不该 50 个**；idle-reaper 负责回收，active 上限防瞬时击穿。

## 4. 安全（按拍板执行）
- iframe `sandbox="allow-scripts allow-forms allow-downloads"`，**不轻易给 `allow-same-origin`**；preview origin 与主站分开。
- preview 容器：低权限用户、无宿主密钥、无 docker socket、资源限额。
- **egress 分阶段**：install 阶段放行 npm registry；run 阶段默认 deny / allowlist（可配）。
- cookie host-only；不把主站 cookie 暴露给 preview app。
- install：日志 + 超时 + 缓存 + 取消。

---

## 5. 任务拆分（粗序）
1. `PreviewRuntime` 接口 + `DockerPreviewProvider`（ensureSandbox / install / start(static) / stop / reap / getUrl）+ 配置 + active 上限限流。
2. `preview-controller` sidecar（持有 docker socket）+ compose 接线。
3. Traefik labels + forward-auth + `/__oxy/auth` bootstrap→cookie 流 + sslip.io(本地)/wildcard(生产)。
4. `.oxygenie/app.json` schema + 启发式扫描器 + 命令 allowlist。
5. UI：交付物卡 + 预览 iframe + 日志 + 状态机（接 turn-卡 IA）。
6. 端到端验收：Vite SPA（install→build→static→iframe）、idle 回收、active 上限、跨源鉴权隔离。

## 6. 推迟（post-v1）
- (A) `declare_app` 自定义 SDK 工具（咬 SDK 0.2.112 / ARK / 自定义工具事件）。
- Live/dev（HMR）加固；Next/Express/带 API/env 的服务端应用。
- per-preview on-demand TLS；`e2b`/`daytona` provider；子路径 fallback 加固。

## 7. 依赖 / 风险
- **需要 Docker**（preview provider=docker）；纯无 Docker 环境回退到轻量 Sandpack/WebContainers（仅简单单组件）。
- 与本地 hybrid 模式（`start-production.mjs` 跑在宿主、非每会话 Docker）协调：preview 容器仍经 `preview-controller`/docker socket 起；确认本地开发者机器有 Docker。
- 最大坑（架构师点名）：① 别把常驻 dev server 当默认；② 子路径反代复杂度（Vite base/HMR ws/绝对路径/history fallback）——所以子域名主线；③ preview 与主站同源（最危险捷径）；④ npm install 生命周期；⑤ 别硬改 DockerBackend 成长驻；⑥ 缺 active 上限会瞬时击穿。

## 8. 预览生命周期与分享（已落地口径，2026-06）

> 本节记录**实际落地的固定值与语义**（计划里写的是区间 `5~10min` / `4~6`，落地取下限）。代码：`src/preview/runtime.js`（`PreviewRuntime`）、`ws-server.mjs`（heartbeat 回收 + `/__oxy/preview/authorize`）。

### 8.1 销毁时机（idle reaper）
- **空闲阈值 = 5 分钟**（`PREVIEW_IDLE_TIMEOUT_MS`，默认 `300000`）。
- **扫描周期 = 30 秒**（`HEARTBEAT_INTERVAL_MS`，与 WS 心跳共用一个 `setInterval`，回调里调 `previewRuntime.reapIdlePreviews(...)`）。
- **计时基准 = `lastAccessAt`**，由 `touchPreview()` 刷新；触发点：① bootstrap token 兑换 `/__oxy/preview/auth?t=`；② **每次** forward-auth 的 `/__oxy/preview/authorize`（即对子域名的每个请求）。
- 结论：实际销毁发生在**最后一次访问后 ~5 ~ 5.5 分钟**；只回收 `status==='ready'` 的预览。
- ⚠️「标签页开着」≠「在访问」：静态 SPA 加载后不再发请求 → 开着但闲置的标签页照样被回收。

### 8.2 容量上限
- 同时活跃预览 **≤ 4**（`MAX_ACTIVE_PREVIEWS`，Semaphore）；**install/build 中的也占名额**。
- 不做 LRU 驱逐：达上限时**新预览直接报错**「容量已满，等某个空闲回收后再试」，**不**挤掉旧的。

### 8.3 其他销毁触发
- 手动 `stop_preview`：立即销毁并释放名额。
- app / 栈重启或重部署：内存 `active` Map 丢失，预览失效（容器可能残留为孤儿）。

### 8.4 分享 = 公开链接（Option A，公开切换 / PR #116）
- 「分享」把预览标记 **public**，返回**无 token 的裸链接** `<protocol>://<host>/`。
- **鉴权绕过**：forward-auth 中间件**仍挂在**路由上（不动容器 / 不改 Traefik 标签）；`/__oxy/preview/authorize` 对 public host **直接返回 200**，仅对被分享的预览跳过 cookie 闸。
- **常驻**：`reapIdlePreviews` **跳过 `public` 的预览** → 分享期间钉住不被 5 分钟回收，直到手动停止或栈重启。
- **代价**：public 预览会一直占用 1 个 `MAX_ACTIVE_PREVIEWS` 名额（自托管可信团队场景可接受；`stop_preview` 释放）。
- **对外可达前提**：需**可公网解析**的预览域名（如 `*.oxygenie.cc`）；仅本机解析域名（如 `*.oxygenie.local`）只在配置它的机器上有效。
- 实现：`PreviewRuntime.sharePreview / isPublicHost / getStateByHost`、`ws-server` 的 `share_preview` 处理 + authorize public-bypass、`ws-adapter.sharePreview()`、`PreviewState.{public,shareUrl}`、`artifact-html.tsx` 的「分享」按钮。
</content>
