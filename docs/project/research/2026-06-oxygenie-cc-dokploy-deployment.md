# OxyGenie 生产部署决策 + 差异规格（oxygenie.cc on Dokploy）

> 状态：**✅ 已上线**（2026-06-05，`oxygenie.cc`；/health 200、/ws/agent 426 验证通过）。
> **可操作的部署指南(7 步 + 卡点根因表)见 `docs/deployment/dokploy.md`** —— 本文是决策/差异记录。
> 上线前共闯过 8 个卡点(构建 OOM、playwright/office 拖慢、GHCR 私有、卷名冲突、
> DATABASE_URL 失配、migrate DNS EAI_AGAIN、CF 泛域名 SSL、ARK 鉴权),根因与修法见指南的
> "Troubleshooting — blockers" 表。
>
> 原始状态：决策已定，待执行（2026-06-05）
> 目标：把 `codex/phasec-real-preview`（Phase C 真预览 + Ask/Act + controller 硬化）部署到
> Dokploy 服务器 `h.deeptoai.com`，对外域名 `oxygenie.cc`，并跑通 Traefik 路由的真预览 E2E。
> 本文是**决策记录 + 与现有部署资产的精确差异**，执行时按"差异清单"逐条落地。

---

## 0. 为什么有这份文档

部署涉及域名/TLS/鉴权/模型/预览路由多处决策，且现有 `docker-compose.dokploy.yml` 是为
**上一套方案（deeptoai.com + Let's Encrypt + 2 层 `.preview.`）** 配的。若不落档，这些
"为什么这么改"会彻底丢失，无法维护。

---

## 1. 决策总表

| 项 | 决策 | 备注 |
|---|---|---|
| 代码源 | GitHub `foreveryh/oxygenie` @ `codex/phasec-real-preview` | controller 硬化在 `d19621c` |
| 镜像 | **Dokploy 自建**（compose 用 `*app_build`，在 amd64 服务器构建）| 见 §8（已纠正；与 CLAUDE.md GHCR 段不一致，待 Owner 确认）|
| Dokploy 项目 | 新建 `oxygenie` | |
| App 域名 | `oxygenie.cc`（apex） | |
| WebSocket | `wss://oxygenie.cc/ws/agent`（Traefik 按 `/ws` 路径转 3001） | |
| 预览域名 | **单层 `*.oxygenie.cc`**（`<id>.oxygenie.cc`） | **关键**：见 §2 |
| TLS | **Cloudflare 橙云 + Full(Strict) + Origin CA 证书**；**不用 Let's Encrypt** | **关键**：见 §3 |
| ARK 鉴权 | **`ANTHROPIC_AUTH_TOKEN`（Bearer），不用 `ANTHROPIC_API_KEY`** | **关键**：见 §4 |
| ARK 网关 | `ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding` | |
| 模型映射 | 主/sonnet/opus/subagent = `glm-5.1`；haiku = `doubao-seed-2.0-lite` | 见 §5 |
| 多模型切换 | 延后 Phase | 需后端改造 |
| 智谱(ZHIPU) | 本期不用 → 由必填改可选 | Mastra 侧 GLM，本期不配 |
| 随机密钥 | DB / MinIO / Meili / `BETTER_AUTH_SECRET` 自动生成 | |

---

## 2. 为什么预览用单层 `*.oxygenie.cc` 而不是 `*.preview.oxygenie.cc`

**Cloudflare 免费版 Universal SSL 的边缘证书只覆盖 apex + 单层 `*.oxygenie.cc`，不覆盖两层
`*.preview.oxygenie.cc`。** 橙云模式下 TLS 在 CF 边缘终止，CF 没有两层泛域名的边缘证书 →
浏览器访问 `<id>.preview.oxygenie.cc` 会证书失败（即使源站证书签了两层也没用）。

- ✅ 选 `<id>.oxygenie.cc`：CF 免费 SSL 正好覆盖。
- App 在 apex（不被 `*.` 通配匹配），预览 id 用随机串，与 `www/app/api` 等保留子域不冲突。
- 备选（未采用）：CF Advanced Certificate Manager（付费）覆盖两层；或预览那条 DNS 灰云 +
  Traefik Let's Encrypt DNS-01 签两层泛域名。都更复杂，故选单层。

**DNS（已配，Cloudflare）**：
- `oxygenie.cc` → A → 46.224.36.68（Proxied）
- `*.oxygenie.cc` → A → 46.224.36.68（Proxied）

---

## 3. 为什么用 Cloudflare Origin CA 而不是 Let's Encrypt

现有 dokploy compose 所有路由都用 `tls.certresolver=letsencrypt`。**橙云下 Let's Encrypt
HTTP-01 质询会被 CF 拦截而失败。** 因此：

- CF SSL 模式设 **Full (Strict)**。
- 用 **Cloudflare Origin CA 证书**（签 `oxygenie.cc` + `*.oxygenie.cc`，15 年）作为源站证书，
  装进 Dokploy/Traefik 作**默认证书**；Traefik 按 SNI 给 app 和所有 `<id>.oxygenie.cc` 预览路由使用。
- 路由去掉 `certresolver=letsencrypt`，保留 `tls=true`（走默认证书）。

**Origin CA 签发方式**（Service Key 已弃用）：用带 `Zone > SSL and Certificates > Edit`
权限的 **API Token** 调 Origin CA API。本地已生成私钥 + CSR：
- `~/oxygenie-deploy/certs/oxygenie.cc.origin.{key,csr}`（SAN：`oxygenie.cc`,`*.oxygenie.cc`）
- 签发：`POST https://api.cloudflare.com/client/v4/certificates`，`Authorization: Bearer <token>`，
  body `{hostnames:["oxygenie.cc","*.oxygenie.cc"], request_type:"origin-rsa", requested_validity:5475, csr:<PEM>}`
- 后备：`~/oxygenie-deploy/certs/oxygenie.cc.{crt,key}` 自签通配证书（配 CF `Full` 非 Strict 可用）。

> 安全补充：建议在 VPS 防火墙仅放行 Cloudflare IP 段到 443，缩小源站暴露面。

---

## 4. 为什么 ARK 用 ANTHROPIC_AUTH_TOKEN 且无需改鉴权代码

ARK `/api/coding` 网关用 **Bearer（`ANTHROPIC_AUTH_TOKEN`）**，不是 `x-api-key`
（`ANTHROPIC_API_KEY`）。鉴权流：

- `ws-server.mjs` 给每条消息 spawn worker 时 `workerEnv = {...process.env}`（继承全部环境），
  且**仅当 `ANTHROPIC_API_KEY` 存在时**才显式注入它（`ws-server.mjs` ~L1063）。
- worker 里 SDK 的 `query()` **不显式传 apiKey**，靠环境；SDK 调起的 claude-code CLI 直接读
  环境里的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / 模型别名。

**结论**：只要容器环境里有 `ANTHROPIC_AUTH_TOKEN`（+ base url + 模型别名），且**不设**
`ANTHROPIC_API_KEY`（设了会让 SDK 走 x-api-key），即可走 ARK。**无需改鉴权代码**，只改 compose env。

⚠️ SDK 版本钉死 `0.2.112`（ARK 兼容上限，见 CLAUDE.md）。

---

## 5. 模型映射（ARK）

| SDK 槽位 | 环境变量 | 模型 |
|---|---|---|
| 主模型 | `ANTHROPIC_MODEL` | `glm-5.1` |
| sonnet 档 | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `glm-5.1` |
| opus 档 | `ANTHROPIC_DEFAULT_OPUS_MODEL` | `glm-5.1` |
| 子代理 | `CLAUDE_CODE_SUBAGENT_MODEL` | `glm-5.1` |
| haiku 档（后台廉价） | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `doubao-seed-2.0-lite` |

> ARK 可用模型：doubao-seed-2.0-code / doubao-seed-2.0-pro / doubao-seed-2.0-lite /
> doubao-seed-code / minimax-latest / glm-5.1 / deepseek-v4-flash / deepseek-v4-pro。
> 多模型切换（用户自选）= 后续 Phase。

---

## 6. 差异清单：对 `docker-compose.dokploy.yml` 的精确改动

> 现状是为 deeptoai.com + LE + 2 层预览配的，需改 6 处：

1. **App Host（硬编码）**：约 L349/L356/L368 的 `Host(`deeptoai.com`)` → `Host(`oxygenie.cc`)`
   （或参数化为 `${APP_HOSTNAME}`）。
2. **去 Let's Encrypt**：所有 `tls.certresolver=letsencrypt`（app web/websecure、ws、preview-auth）
   → 改为仅 `tls=true`，依赖 Traefik 默认证书（Origin CA）。
3. **预览改单层**：
   - L306 `PREVIEW_HOST_TEMPLATE` 默认 `{previewId}.preview.${APP_HOSTNAME}` → `{previewId}.${APP_HOSTNAME}`
   - L383 preview-auth `HostRegexp(`{preview:[a-z0-9-]+}.preview.${APP_HOSTNAME}`)` → 去掉 `.preview`
   - preview-controller（§见下）`PREVIEW_TRAEFIK_CERTRESOLVER` 清空；`PREVIEW_BASE_DOMAIN=oxygenie.cc`
4. **ARK 鉴权**（app 服务 env，约 L279-283）：
   - `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:?}` → 删除或改 `${ANTHROPIC_API_KEY:-}`（**不设值**）
   - 新增 `ANTHROPIC_AUTH_TOKEN: ${ANTHROPIC_AUTH_TOKEN:?}`
   - 新增 4 个模型别名：`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` /
     `ANTHROPIC_DEFAULT_OPUS_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL`
   - `ZHIPU_API_KEY: ${ZHIPU_API_KEY:?}` → `${ZHIPU_API_KEY:-}`（可选）
5. **preview-controller 服务**（约 L396-421）：`PREVIEW_TRAEFIK_CERTRESOLVER` 默认 `letsencrypt` →
   清空（用默认 Origin 证书）；确认 `PREVIEW_TRAEFIK_NETWORK`/`PREVIEW_DOCKER_NETWORK=dokploy-network`
   （已是）；`PREVIEW_BASE_DOMAIN=oxygenie.cc`。镜像 = GHCR（含 controller 硬化，见 §7）。
6. **VITE build args**：已在 `x-app-build` 锚点按 `${APP_HOSTNAME}` 参数化（Dokploy 自建时自动烤入）；
   只需设 `APP_HOSTNAME=oxygenie.cc`，无需手工传 `--build-arg`。

> ✅ 第 6 处之外的 1–5 已于 2026-06-05 改完并 `docker compose config` 校验通过
> （commit 见决策日志）。

---

## 7. preview-controller 硬化（已合入 `d19621c`，必须进 GHCR 镜像）

部署用的 GHCR 镜像**必须从 `codex/phasec-real-preview` 重建**，以包含本次三项修复
（见 `src/preview/controller.mjs`，commit `d19621c`，本地真预览引擎已验证）：

1. **serve 竞态** → detached `exec node`（守护进程托管，首跑可靠；原 `nohup &` 首跑会被 exec 拆除杀掉）。
2. **pid 追踪** → 静态服务器自写**容器内** pid 到 `PREVIEW_PID_FILE`（exec API 给的是宿主 pid，
   容器内 `kill` 用不了）；restart/idle-reap 才能正确命中。
3. **沙箱属主** → `CapDrop:['ALL']` 会连 `CAP_CHOWN` 一起去掉，导致启动期 chown 静默失败、
   非-root（1001）装依赖 EACCES。补 `CapAdd:['CHOWN']`（仅启动期 root 用）+ chown 工作目录根；
   install/build/serve 仍以 1001 无有效 caps 跑不可信构建。

> 验证记录：本地用真实 controller + docker 卷 + 1001 用户跑通 ensure→install→vite build→serve→
> fetch→restart→stop。

---

## 8. 镜像构建方式 —— Dokploy 自建（**已纠正**）

**`docker-compose.dokploy.yml` 的全部 app 服务（migrate/worker/app/preview-controller）都用
`<<: *app_build`（`build:` 锚点），即 Dokploy 克隆分支后在它自己的 amd64 服务器上构建。**
因此：

- **不需要**本地 `buildx` 跨架构构建，**不需要**推 GHCR、不需要 `--platform linux/amd64`。
- VITE build-args 已在 `x-app-build` 锚点里按 `${APP_HOSTNAME}` 等参数化
  （如 `VITE_WS_URL=wss://${APP_HOSTNAME}/ws/agent`）→ 只要在 Dokploy 设 `APP_HOSTNAME=oxygenie.cc`
  即自动烤入正确前端域名。
- Dokploy 端：Docker Compose 服务的 Git 源指向 `foreveryh/oxygenie` 分支 `codex/phasec-real-preview`，
  compose 路径 `docker-compose.dokploy.yml`；部署即构建。

> ⚠️ **与 CLAUDE.md 不一致**：CLAUDE.md「Dokploy 部署规则」写的是 GHCR + `pull_policy: always`
> + 本地 `buildx --platform linux/amd64`。但当前 `docker-compose.dokploy.yml`（Phase C，commit
> 0d05389）用的是 `*app_build`（Dokploy 自建）。本部署按**文件现状（自建）**走；CLAUDE.md 那段
> 待与 Owner 确认后更正或保留为备选。

---

## 9. 执行前待办（阻塞项）

- [ ] CF：SSL/TLS 模式切 **Full (Strict)**
- [x] CF：创建 API Token + **Origin CA 证书已签发**（2026-06-05，有效期至 2041，SAN
      `oxygenie.cc` + `*.oxygenie.cc`，issuer = CloudFlare Origin CA，与私钥匹配）
- [x] DB / MinIO / Meili / `BETTER_AUTH_SECRET` 随机密钥已生成
- [x] **ARK `ANTHROPIC_AUTH_TOKEN` 已提供 + 实测通过**（2026-06-05：`/api/coding/v1/messages`
      + Bearer，`glm-5.1` 与 `doubao-seed-2.0-lite` 均 HTTP200 应答 `OK`）
- [x] `doubao-seed-2.0-lite` 确认存在且可用（实测通过）
- [x] 按 §6 改 `docker-compose.dokploy.yml`（1–5 已改，`docker compose config` 校验通过）
- [x] 按 §6/§5 补 `infra/deploy/env.dokploy.example` 的 ARK/模型键
- [x] 镜像：Dokploy 自建（无需 GHCR，见 §8）
- [ ] **【动生产】** Dokploy 建 `oxygenie` 项目 + Docker Compose（Git 源 `codex/phasec-real-preview`，
      compose 路径 `docker-compose.dokploy.yml`）+ 注入 env（用 `secrets.env` 蓝本）+ 装 Origin 证书
- [ ] **【动生产】** 部署 → 冒烟 → **浏览器真预览路由 E2E** → 通过后合并 PR #107 到 main

---

## 9.1 本地密钥与证书位置（仓库外，勿提交）

> 放在 repo 外（CLAUDE.md 禁止动 repo `.env`，且密钥进 git 会泄露）。**这就是"以后去哪找"的答案**：

```
~/oxygenie-deploy/secrets.env                  # CF token + 随机密钥 + ARK 占位 + 域名（chmod 600）
~/oxygenie-deploy/certs/oxygenie.cc.origin.crt # Origin CA 证书（装进 Dokploy → Certificates）
~/oxygenie-deploy/certs/oxygenie.cc.origin.key # 对应私钥（装进 Dokploy）
~/oxygenie-deploy/certs/oxygenie.cc.{crt,key}  # 自签后备证书（CF Full 非 Strict 时用）
```

`secrets.env` 可作 Dokploy 环境变量导入蓝本。CF API Token 用完可在 CF 控制台撤销。

## 10. 相关文件

- `docker-compose.dokploy.yml` — 部署用 compose（待按 §6 改）
- `infra/deploy/env.dokploy.example` — 环境变量模板（待补 ARK/模型）
- `infra/deploy/DOKPLOY_DEPLOYMENT.md` / `DOKPLOY_ENV_CHECKLIST.md` — 既有部署指南
- `src/preview/controller.mjs` — 真预览引擎（已硬化）
- CLAUDE.md「Dokploy 部署规则」「环境变量」段 — 已同步 ARK auth-token 要点
