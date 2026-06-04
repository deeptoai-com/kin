# 架构评审简报：Workbench / 成果物「真预览」/ 消息顺序

> 日期：2026-06-04 ｜ 面向：外部/资深架构师评审 ｜ 状态：待评审
> 配套：`2026-06-workbench-artifact-ordering-fix-plan.md`（详细修正计划 + UI/IA 设计）。
> 目的：请架构师评估方案合理性，**重点是「真预览」（让用户看到 agent 生成的多文件 App 真正跑起来）的架构选型**。

---

## 0. 产品与约束（评审前提）

- **OxyGenie**：自托管、单组织、多用户（半可信团队）的 Claude-Agent 工作台。**不是公网多租户 SaaS**。
- **执行模型**：每条消息 spawn 一个子进程 worker 调用 Claude Agent SDK；**per-session 沙盒**（每会话独立 `CLAUDE_HOME` + workspace 目录）。已有 `ExecutionRuntime` 抽象 + `LocalProcessBackend`（srt 沙盒）/`DockerBackend`，但**当前是「每消息即起即灭」**，无长驻进程。
- **规模目标**：单台 16G/8-core，约 50 并发会话（已有并发上限 + idle-reaper + per-worker 堆限）。
- **模型网关**：ARK（火山）；Claude Agent SDK **钉死 0.2.112**（0.2.113+ 原生二进制与 ARK 不兼容）。
- **部署**：Docker Compose（本地 hybrid：`start-production.mjs` 同进程跑 Nitro :3000 + WS :3001）/ Dokploy。

---

## 1. 问题（用户实测反馈）

1. **右侧 Workbench 四个 tab（Progress / Sub-agents / Files / Context）只有 Progress 有内容、且滞后**；其余三个空。
2. **每个生成文件一张「打开成果物」卡**（交互诡异）；用 React+Vite 生成了一个产品、agent 自称成功，但**用户完全看不到结果**。
3. **消息前后错乱**。

---

## 2. 调研结果（根因，附 file:line）

**(1) Workbench**
- Files / Context = **从未实现的占位**（`workbench-panel.tsx:248-259` 硬编码空态）。
- Progress / Sub-agents = **靠刮消息流里的 tool-call**（`use-session-workbench.ts:57-84` 刮 `TodoWrite`、`:113` 刮 `Task`）；Progress 滞后因只在完整 assistant 消息落库时更新（`ws-adapter.ts:988-1027`），非增量。Sub-agents 空 = 没派生 Task 或 SDK 事件形状漂移未识别。**脆弱点：刮 tool-call 名字，而非读结构化状态。**

**(2) 成果物 / 预览**
- 过度触发：每个 `Write`/`Edit` 抽一个 artifact（`use-artifact-detection.ts:97-121` / `:243-256`），每 artifact 一张卡（`route.tsx:2176-2183`）。
- React 预览**仅单文件**：`artifact-react.tsx:29` Sandpack 单入口文件，多文件 import 必崩。
- **无真 dev server**：浏览器内 Sandpack 打包，从不起真实 Vite。
- 结构化输出 artifact 元数据（`ws-query-worker.mjs:115-151`）与沙盒 workspace 真文件**两套系统脱节**；已有多文件 `workspace-sandpack-panel.tsx:82-102` 但独立未接入。

**(3) 消息顺序**
- **无序号**，全靠 JS 到达顺序（`ws-server.mjs:745` 发送不加 seq；`ws-adapter.ts:761` 只 push）。
- `messages_loaded` 双处理（`ws-adapter.ts:524-531`，queue switch `:834-1367` 无该分支 → 死事件卡队列）。
- 历史 + live 两段渲染无合并去重（`route.tsx:1459-1471`）。

---

## 3. 我的解决方案（概要；详见配套计划）

**UI/IA 原则**：交付物 **push** 并保留；过程信息 push 到**可折叠**载体、**完成自动收起**；导航/索引/元信息 **pull**（右侧 Workbench 按需）。一轮 = 一张「turn 卡」（最终文本 + 至多一张交付物卡 + 一个折叠「运行过程」）。

**分期**
- **Phase A（前端/adapter，中等、可控）**：A1 事件加单调 `seq` + 单一有序时间线 + 删 `messages_loaded` 双处理（治错乱）；A2 turn 卡 + 过程折叠（完成收起）；A3 artifact 每轮一张（去重）。
- **Phase B（前端 + 轻 server fn，小–中）**：B1 Files 读沙盒 workspace FS；B2 Context 接已有用量/模型/skills/mcp；B3 Progress/Sub-agents 稳健化 + 核验 SDK 事件。
- **Phase C（沙盒为主，大、架构性）**：**真预览** —— 本简报第 5 节专门评审。

---

## 4. 难点评估（诚实）

| 相 | 规模 | 风险 | 说明 |
|---|---|---|---|
| A1 顺序 | 中 | 中（核心链路） | 改动概念简单，但落在最大最中心的 `ws-adapter.ts`(1418行)/`chat-session-store.ts`/`route.tsx`(2000+行)，回归影响每次对话，须真机端到端验证。 |
| A2 turn 卡 + 折叠 | 中 | 低（纯展示） | 收益最直观，建议先做。 |
| A3 artifact 去重 | 小–中 | 低 | 局部。 |
| B1/B2 | 小–中 | 低（加法、pull） | Files 读沙盒 FS；Context 接已有数据。 |
| B3 | 小（先诊断） | 取决于结论 | SDK 事件形状核验，根治并入 C。 |
| **C 真预览** | **大** | **高 / 架构性** | **非 UI 问题**：长驻 dev server + 端口暴露 + 反代/路由 + 生命周期回收 + iframe 安全。撞上「per-message 即起即灭 → per-session 长驻」的运行时演进（Phase 0.5 推迟项）。 |

**一句话**：80% 的「看起来不对」用可控前端工（A+B）即可消除；剩 20%「真正跑起来给我看」是沙盒硬活（C），需架构决策。

---

## 5. 「真预览」业界怎么解（评审核心）⭐

**问题本质**：agent 生成一个**多文件、有依赖、要跑 dev server** 的 App，如何让用户在产品里**看到它真正运行**。业界两大流派：

### 流派 ①：浏览器内运行时（无后端基建）
- **bolt.new = WebContainers**（StackBlitz）：用 WASM 在**浏览器标签页内**跑 Node + npm + dev server，预览即时、可装任意 npm 包、零服务器成本。**局限**：仅限浏览器可跑的（无原生二进制、受浏览器约束）、重型项目吃前端内存。
- **Sandpack**（CodeSandbox）：更轻，浏览器内打包单/少文件组件。**OxyGenie 现在用的就是这个的最弱形态（单文件）** → 这就是多文件看不到的根因。

### 流派 ②：远程/持久沙盒 + dev server + 反代「端口→URL」（主流、能跑真东西）
- **E2B Fragments**：Firecracker microVM；`Sandbox.create(template)` → 写文件 → 装依赖 → web 模板返回 **`https://${sbx.getHost(port)}`** 预览 URL，iframe 嵌。**一次生成=一个完整可跑 fragment**（非每文件）。
- **OpenHands**：**每会话一个持久 Docker runtime 容器**；把容器内 web 端口经 **host 端口映射 / 反向代理 / URL 模板**（`SANDBOX_CONTAINER_URL_PATTERN`、`WEB_HOST`、host networking）暴露给用户。云端（Daytona）直接把 localhost 端口换成专用 URL，如 `https://5000-sandbox123.node456.daytona.io`。**痛点也很真实**（GitHub issue：localhost vs 远程 host、原生端口转发支持）——说明「端口→可达 URL 的路由」是这条路线的核心工程。
- **Lovable** = Fly.io + Firecracker microVM；**v0** = 远程沙盒；**deer-flow 2.0**（ByteDance，owner 提到的）= **隔离 Docker 沙盒 + 持久文件系统 + Bash**，能 run code / **build web apps** / 产出报告/PPT/网页（同属 Docker 沙盒族，预览走容器端口）。

### 对 OxyGenie 的判断
- **现状（Sandpack 单文件）= 流派①的最弱档**，先天看不了多文件 Vite App。
- **架构对齐的目标 = 流派②**（OpenHands / E2B / deer-flow 同款）：**OxyGenie 已有 per-session 沙盒 + `DockerBackend`**，缺的就是「**持久化该会话沙盒 + 在里面起 dev/serve + 把端口经反代暴露成预览 URL + iframe 嵌**」。这把 C 从「未知」降为「**复杂但有成熟图纸**」。
- **务实折中**：把 dev-server 预览做成主路径；**WebContainers/Sandpack 作为轻量兜底**（简单单组件 artifact 仍可即时预览，不必起容器）。
- **自托管约束**：默认要能在团队自己的 Docker 里跑（不强依赖 E2B/Daytona 付费云）；但**预览运行时建议做成可插拔**（自托管 Docker 默认 + 可选接 E2B/Daytona）。

---

## 6. 给架构师的关键问题（请重点拍板）

1. **运行时形态**：真预览需要**长驻** dev server（HMR 体验好但重）还是 **build 后静态 serve**（轻、安全，但无热更）？考虑「用户只想看到结果」这个核心诉求 + 50 并发/16G 预算，**长驻 Vite dev server 每会话一个是否吃得消**？是否走「按需启动 + idle 回收」？
2. **per-message 即起即灭 → per-session 持久**：是否就此引入「per-session 暖容器/进程」？如何与现有 `ExecutionRuntime`/`DockerBackend` + idle-reaper + 并发上限协调（这正是 Phase 0.5 推迟的 warm-pool/tier-decoupling）？
3. **端口→URL 路由**：反代用**子路径**（`/preview/<sid>/...`，需处理资源相对路径/HMR websocket）还是**子域名**（`<sid>.preview.host`，更干净但要泛域名/证书）？鉴权如何做到仅本组织可达？
4. **可插拔**：自托管 Docker 默认 + 可选云沙盒（E2B/Daytona）——值不值得现在就抽象，还是先把自托管 Docker 一条路打通？
5. **安全**：预览容器的网络出口（egress）、iframe `sandbox` 属性、密钥隔离——半可信团队威胁模型下的边界在哪？
6. **「一个 App」边界**：artifact「一个交付物」按「本轮写入 workspace 的文件集合」判定，还是要求结构化输出显式声明一个 app（含 entry/port/deps，像 Fragments 的 `fragmentSchema`）？后者更可控但要改 SDK 提示/结构化输出。

---

## 7. 参考来源
- E2B Fragments：github.com/e2b-dev/fragments（`fragmentSchema`、`sbx.getHost(port)` 预览 URL）
- OpenHands Runtime：docs.openhands.dev/openhands/usage/architecture/runtime（端口映射/反代、`SANDBOX_CONTAINER_URL_PATTERN`）；Daytona×OpenHands runtime
- bolt.new / WebContainers：github.com/stackblitz/bolt.new
- deer-flow 2.0：github.com/bytedance/deer-flow（Docker 沙盒 + 持久 FS + build web apps）
- deep-agents-ui：github.com/langchain-ai/deep-agents-ui（面板读结构化 state，非刮 tool-call）

---

## 8. 架构决策（已拍板 2026-06-04）

架构师评审后**拍板**，落地见 `2026-06-real-preview-v1-implementation-plan.md`。一句话：

> **v1：Traefik 子域名反代 + 一次性 token 换 preview cookie + `.oxygenie/app.json`/package 探测声明 app + 纯前端 SPA static preview 为硬验收；Live/dev 与服务端应用为 best-effort。**

要点：
1. **主线 = per-session 持久沙盒 + 按需预览进程 + idle 回收**；**不**每会话常驻 Vite dev server（50 会话/16G 撑不住）。`MAX_ACTIVE_PREVIEWS=4~6`、`PREVIEW_IDLE_TIMEOUT=5~10min`、`PREVIEW_MEMORY=512m~1g`，install 也占名额。
2. **新增 `PreviewRuntime`/`SessionSandboxManager`**，**不硬改** one-shot `DockerBackend`；**`preview-controller` sidecar 独占 Docker socket**，app/preview 容器绝不碰 socket。
3. **双档**：默认 `build → 内置静态服务器 serve`（完成态，硬验收）；HMR 才 `dev`（编辑态，best-effort）。
4. **Traefik + Docker provider + forward-auth**；本地 `*.127-0-0-1.sslip.io`（主站同族域名）、生产 `*.preview.<domain>`+wildcard cert；子路径仅兜底；v1 不做 on-demand TLS。
5. **鉴权**：一次性 bootstrap JWT（exp 60~120s, jti 一次性消费）→ `/__oxy/auth` 换 **opaque、httpOnly、host-only preview cookie**（Redis 映射，10~15min 滑动，受 idle reaper 约束）→ 302 去掉 URL token；不用 URL 常驻 token。
6. **manifest = `.oxygenie/app.json` 唯一 schema**；v1 启发式扫描生成，未来 `declare_app` 工具写同一份；**命令只允许 package.json scripts，不执行自由 shell**。
7. **Provider 抽象先留、只实现 Docker**（不接 E2B/Daytona）。
8. **v1 硬验收 = 纯前端 SPA：install→build→static→iframe 可见**；Next/Express/带 API = best-effort/下一版。

**归属**：在「沙盒 + 与沙盒交互」新对话执行；与 `…-fix-plan.md` 的 Phase A/B（消息顺序、过程折叠、Files/Context、artifact 去重）并行不冲突。

---

## 9. 备案：结构化输出泄漏（Cowork S3 根因，挂本线）

> 记录时间：2026-06-04 ｜ 来源：Cowork 单源重做 S3（见 `2026-06-cowork-s1-review-and-s2s3-handoff.md` §4）。**根因与本「artifact 元数据/结构化输出」策略耦合，统一在本线定，S2 PR 不做文本过滤。**

- **现象**：开启结构化输出后，模型未调用 StructuredOutput 时，SDK 的 `outputFormat` **Stop-hook 强制机制**会①多跑一轮、②把 “You MUST call the StructuredOutput tool” 内部反馈漏进对话。
- **触发条件（双重门）**：`ENABLE_STRUCTURED_OUTPUTS=true` **且** prompt 命中 `hasStructuredOutputFileHint`（`ws-query-worker.mjs` 的 `query().options.outputFormat`，约 588 行）。
- **当前状态（已强制默认关）**：`ENABLE_STRUCTURED_OUTPUTS` 强制默认 `false`（`.env.example` / `CLAUDE.md` / worker 注释均已写明）；关闭状态下泄漏与多跑一轮均不发生。artifact 元数据改由被动探测（`use-artifact-detection.ts`）兜底，不依赖结构化输出。
- **根治选项（待本线定）**：① 维持关闭，artifact 元数据继续走探测；或 ② 若要重新启用，需先解决 Stop-hook 泄漏（过滤该内部反馈文本 + 抑制多跑一轮），并与本节的 manifest/`declare_app` 策略统一——`.oxygenie/app.json` 若成为 artifact 声明的唯一来源，结构化输出可能整体不再需要。**建议 ①，重启用须随本线 artifact 策略一并评审。**
- **不做**：评审已决定 S2 PR **不**加投机性文本过滤（实现者无法离线复现确切注入格式，且只治标不治本——多跑一轮只有关 env 才能消除）。
</content>
