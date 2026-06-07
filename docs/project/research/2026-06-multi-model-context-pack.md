# 多模型切换 — 实施资料包（Context Pack）

> 日期：2026-06-07 ｜ 配套 **`prd/2026-06-multi-model-switching-prd.md`（rev.3 完整版）**。
> 目的：把"实施这一个功能所需的全部上下文"汇成一份——背景、术语、**精确代码锚点**、**SDK 0.2.112 env/model 契约**、参考项目 digest、env 清单、**分 PR 实施序**、风险与验证。实施时**照此直接动手,无需再调研**。

---

## §A 背景与术语

- **产品定位**：自托管 / 单组织 / 多用户(可信团队);威胁模型 = 半可信同事,非匿名攻击者(见 `VISION.md`/`CLAUDE.md`)。→ 菜单对组织内可见可切 OK;CRUD/enable 限 admin;密钥卫生是重点。
- **运行时**：只用 **Claude Agent SDK,钉死 `0.2.112`**(最后一个 bundled-JS 版;0.2.113+ 换原生二进制,与 ARK 不兼容)。
- **协议边界**：SDK 只说 **Anthropic Messages 协议** → "多模型" = **跨 Anthropic 兼容网关**的多模型。OpenAI-only 厂商需自备 Anthropic 兼容代理(本期 N2 不做)。
- **术语**：
  - **Connection(连接)** = 一个 Anthropic 兼容端点 + 一份凭据 = 一个账号/网关(baseUrl + authStyle + tokenEnv)。
  - **Model(模型)** = 归属某连接的可选项(model 串 + enabled + tags)。
  - **探活(probe)** = 用 `/v1/messages` 最小请求判定"能用"。
  - **可切 = enabled(DB) && healthy(探活)**。

---

## §B 代码锚点（精确 file:line,实施直接定位）

> 仓库根：`/Users/peng/Dev/Projects/active/ClaudeAgentChat/oxygenie-phasec`

### ws-server.mjs
- `handleChat(ws, prompt, resumeSessionId, options={})` 签名 **L1027**;解构 `{ silentInit, skillSlug, permissionTier }` **L1028** ← 加 `model`。
- **workerEnv 构造块 L1106-1117**(`const workerEnv = { ...process.env }` … `if (config.model) workerEnv.ANTHROPIC_MODEL = config.model`)← **重写为按请求 `buildWorkerEnv(model)`**。
- 入站 `case 'chat'` **L1469-1484**(`handleChat(ws, message.content, message.sessionId, { skillSlug, permissionTier })`)← 加 `model: message.model`。
- `recordUsage()` / `modelUsage` **L356-395**(per-message 成本归集的接入点,v-next)。
- 心跳 `setInterval(..., HEARTBEAT_INTERVAL_MS)` **L1822-1868**(周期任务样板;但探活用 BullMQ,不用这里)。

### ws-query-worker.mjs
- `config = { model: process.env.ANTHROPIC_MODEL, cwd }` **L23-26**。
- `query({ prompt, options:{ cwd, model: config.model, ... } })` **L689-732**。
- `skillSlug` 解构 **L242-250**、消费 **L684-687**(per-request 选项样板)。

### src/claude/adapters/ws-adapter.ts
- `InboundMessage` 联合,`chat` 成员 **L109-119** ← 加 `model?: string`。
- 发送 `send({ type:'chat', …, skillSlug, permissionTier })` **L845-852** ← 加 `model: selectedModelId`。
- `let currentSessionId` **L364**。
- 现有 sender 模式(`startPreview`/`sharePreview` 等)可仿照加 `listModels`/`probeStatus`(或用 server fn,见下)。

### src/lib/chat-session-store.ts
- `selectedTier?: InteractionMode` **L180-183**;`setSelectedTier` **L422-424**;默认 `selectedTier:'act'` **L420** ← **照此加 `selectedModelId` + `setSelectedModelId`**。
- `PreviewState` 类型 **L114-126**(会话态类型样板)。

### src/components/claude-chat/chat-composer.tsx
- 死徽章「GLM 5.0」 **~L468** ← 换真下拉。
- 权限档选择器:`useChatSessionStore(s=>s.selectedTier)` **~L196**、`PermissionTierSelector` import **~L47**、组件 `./permission-tier-selector`(UX 样板,照此做 model picker)。

### DB / Drizzle
- Schema 目录 `src/db/schema/`。
- **`src/db/schema/skill-catalog.schema.ts`**:`skillCatalog` **L37-80**、`skillEnablement` **L110-118**(DB catalog + enablement 样板,照此建 model 三表)。
- `src/db/schema/agent-session.schema.ts`:列 **L16-45**、类型导出 **L58-59** ← 加 `model: text('model')` 列。
- 迁移目录 `drizzle/`(`0000_…` → `0019_…`);**seed-on-migrate** 看 Skills 的种子写法(curated seed 接 `migrate`,幂等)。

### Server Functions（admin 模式）
- `src/server/function/skills.server.ts`:`requireUser` **L61-70**、`requireAdmin` **L76-101**(查 `user.systemRole==='admin'`)← 照此建 `models.server.ts`。
- 路由:`src/routes/admin/`(已有 `skills/ users/ organizations/ a2composer/ index.tsx route.tsx`)← 加 `models/`。

### BullMQ / 定时任务（探活的家）
- `src/jobs/queues.ts`:`systemQueue = new Queue(queueName, { connection(IORedis REDIS_URL), prefix })`。
- `src/worker/index.ts`:`new Worker(queueName, async job => switch(job.name){…})` **L18-33**;**bootstrap 调度** `const opts={ repeat:{ pattern: cron }, jobId:'daily-credit-refill' }; await queue.add(...)` **~L46-55**(用 `getRepeatableJobs()` 去重)← **照此加 `probe-models`**:`repeat:{ pattern: MODEL_PROBE_CRON }`, `jobId:'probe-models'`;job handler 调探活模块。

---

## §C SDK 0.2.112 — env / model 契约（权威,来自官方文档 + 类型核对）

**`query({ prompt, options })` 选项**:`model?`、`fallbackModel?`、**`env?: Record<string,string|undefined>`**(传给 CLI 子进程,默认 `process.env`)、`resume`、`permissionMode`、`maxTurns`、`outputFormat`… **没有 `apiKey`/`baseUrl`/`authToken`/`customHeaders` 选项**(仅只读输出 `apiKeySource`)。→ **鉴权/baseURL 必须走 env**。

**provider 路由 env(子进程读取)**:
- `ANTHROPIC_BASE_URL` —— 所有请求根地址(替代 api.anthropic.com)。**只用这个**;`ANTHROPIC_API_URL` **未文档化**,不依赖(现有代码顺带设了,保留无妨)。
- `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`(网关/ARK)。
- `ANTHROPIC_API_KEY` → `x-api-key`(原生)。
- **精度优先级:`AUTH_TOKEN` 优先于 `API_KEY`**(设了 AUTH_TOKEN 就用 Bearer;只有未设 AUTH_TOKEN 时才用 x-api-key)。**→ 二者只设其一,另一个从子进程 env 显式删除**(并存有歧义、个别代理会同时发两个头)。
- `ANTHROPIC_CUSTOM_HEADERS` —— 每请求附加头(网关路由,可选)。
- `ANTHROPIC_MODEL` —— 会话级模型覆盖(= `--model`/`options.model`,作用于该进程)。

**alias / 子代理 env(仅在 `ANTHROPIC_BASE_URL` 指向网关时生效;直连 api.anthropic.com 时惰性)**:
- `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL`(haiku=后台/廉价档)。
- `CLAUDE_CODE_SUBAGENT_MODEL`(覆盖所有子代理模型;`inherit`=用常规解析)。
- `ANTHROPIC_SMALL_FAST_MODEL` 已弃用 → 用 `_HAIKU_MODEL`。
- **跨账号必须按连接设这些**,否则子代理/后台档打到部署默认账号。缺省策略:未配 alias → 全部回退该连接主模型。

**每进程覆盖 = 合法且受支持**:`options.env` 可传完整自定义 env map;CLI 启动读这些;不同终端用各自 `--model` 即官方做法。我们 spawn 每请求新子进程 → 给它独立 env(BASE_URL + 单个 auth + MODEL + alias)即可路由到任意网关/模型。**实施选 (a) 设子进程 env(现状 workerEnv 块)**,与现有 `ANTHROPIC_MODEL` 注入一致、最小改动。

**健康探活请求**:`POST {BASE_URL}/v1/messages`,headers `content-type: application/json` + `anthropic-version: 2023-06-01` + 单一 auth 头;body `{model, max_tokens:1, messages:[{role:"user",content:"ping"}]}`。
- 码:**200=healthy**;401/403=`auth`;**404(原生)/部分网关 400 指向模型=`model`**(⚠️ ARK 用哪个码,实测确认);connection/DNS=`network`;超时=`timeout`;**429=healthy(限流)**。

> 来源:Agent SDK overview / model-config / llm-gateway / authentication / Messages API / errors(均 code.claude.com & platform.claude.com)。0.2.112 无本地 tarball,字段以 0.1.59 类型核对 + 官方文档佐证(同 bundled-JS 契约);若要字节级确认:`npm pack @anthropic-ai/claude-agent-sdk@0.2.112` 看 `sdk.d.ts`。

---

## §D 参考项目 digest（借思路,不抄码）

| 项目 | 路径 | 借什么 | 跳过 |
|---|---|---|---|
| **CraftAgent** | `references/famous_ai-chat_projects/craft-agents-oss` | `LlmConnection`(slug/providerType/authType/baseUrl/models[]);**配置与凭据分离**(凭据另存,绝不并列);**懒探活**(on-add/on-run,返回 `{success,warning}`);**每会话锁定**模型(首条消息后锁);mini/summary 模型按 keyword 选(haiku) | 其多 providerType/OAuth/Bedrock 映射 |
| **LobeChat** | `references/famous_ai-chat_projects/lobe-chat` | admin provider/model 表 + 面板;**`${ENV}` 注入**;**env-默认↔DB-覆盖合并**(DB 胜,但**密钥可留 env**);手动 "Check" 测试;per-model enable | 50+ SDK driver、DB 加密 keyVaults(我们密钥留 env)、运行时 `/models` 拉取 |
| **LibreChat** | `references/famous_ai-chat_projects/LibreChat` | custom-endpoint **Zod 严校验**(坏配置启动即报);`${ENV_VAR}` 解析(load 时,不下发前端);**三档 model-list**(hardcoded/`fetch:true`/fallback);**每消息记 `model`+`endpoint`**(审计);Anthropic 端点 headers(anthropic-version/beta) | 全量 50 端点类型、`fetch:true` 自动拉(本期 N3) |
| **claude-agent-kit** | `references/useful_frameworks/claude-agent-kit` | **`query({options:{env}})` 按请求合并 env** 的路由法(`{...baseEnv, ...customEnv}` 设 ANTHROPIC_API_KEY/BASE_URL/MODEL);session 不绑 auth → 换 env 即换账号 | 无多模型(单模型/实例);`models[]` 仅 UI 未接 |

**净结论**:连接/凭据分离(CraftAgent)+ DB 定义 + admin 面板 + env↔DB 合并(Lobe)+ Zod/`${ENV}`(LibreChat)+ 按请求 env 路由(claude-agent-kit)+ **我们自加 6h 探活**(三者都只有手动 check,无周期探活)。

---

## §E 分 PR 实施序（每步独立 PR、可单测、admin-merge）

1. **DB + registry**:`src/db/schema/model.schema.ts`(三表)+ 迁移 + seed-on-migrate(`OXY_MODELS_SEED`)+ `src/config/model-registry.*`(env 解析 + Zod + DB 合并 + `resolveModel`/`getSelectableModels`/`buildWorkerEnv`)。单测:解析/校验/合并/env 构造。
2. **探活**:`model-probe.*`(直连 `/v1/messages` + 码分类)+ `src/worker` 加 `probe-models` repeat(`MODEL_PROBE_CRON`)写 `model_health` + 手动入队。单测:码分类(mock fetch)。
3. **选择链路**:`ws-adapter`(`chat` 加 `model?` + 发送)+ `chat-session-store`(`selectedModelId`)+ `ws-server.handleChat`(收 + 校验 + `buildWorkerEnv` 路由 + 不健康报错)+ worker 确认入参。单测:selection 校验 + env 互斥/alias。
4. **picker**:`chat-composer` 死徽章 → 分组下拉(health 圆点 + 禁用态),读 server fn `getSelectableModels`。
5. **admin 看板**:`src/routes/admin/models/` + `models.server.ts`(requireAdmin CRUD + reprobe)。
6. **每会话持久**:`agent_session.model` 列 + 迁移;resume 回显;handleChat resume 时取持久 model。

> 顺序保证:1→2 先把"配置+健康"打底;3 让"能切并真路由";4 给 UI;5 给 admin 配置;6 收尾持久。1-3 即"能用",4-6 即"完整 + 好用"。

---

## §F env 清单（落 `.env.example`,真实值进部署 env;❌ 不改真实 .env）

```bash
# 密钥(按 tokenEnv 名;绝不入 DB/前端/日志)
ARK_AUTH_TOKEN=
ZHIPU_AUTH_TOKEN=
# 种子(首启写 DB;之后 admin 维护)—— 见 PRD §4.1 的 OXY_MODELS_SEED JSON
OXY_MODELS_SEED=
# 探活周期(BullMQ repeat;默认 6h)
MODEL_PROBE_CRON="0 */6 * * *"
```
> 兼容:现有单值 `ANTHROPIC_MODEL`/`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 仍作"无种子时的默认单连接"回退,保证未配多模型的部署不回归。

---

## §G 风险 / 验证

- **R1 ARK 未知模型返回码**:原生 Anthropic=404,网关可能 400 → 探活码分类要把"指向模型的 400/404"都判 `model`;**实测 ARK 一次确认**。
- **R2 alias 串账号**:跨连接不设 alias,子代理/后台档打到部署默认账号 → 必须按连接设 `_DEFAULT_*`/`SUBAGENT`(§C)。
- **R3 双 auth 头**:AUTH_TOKEN+API_KEY 并存歧义 → 构造 env 时**显式删另一个**。
- **R4 密钥泄露面**:看板/前端/日志/server fn 返回**只含 health/label/id/tokenEnv 名**,绝不含 token 值;加脱敏单测(AC7)。
- **R5 默认模型不健康**:回退首个 healthy + 提示(AC6),避免开局无可用模型。
- **R6 SDK 字段未对 0.2.112 字节核对**:风险低(0.1.59 同契约 + 官方文档),需要时 `npm pack` 验证。
- **验证主线**:配 2 连接(ARK + 智谱)→ 探活两者 healthy → 跨账号切换各自跑通(worker 日志 `Model:`)→ 置坏一个 token,下次探活该连接置灰(AC1-AC3,AC8-AC9)。
