# PRD：多模型切换（Anthropic 协议 · 跨账号 · 配置→探活→可切 · 管理看板）

> 日期：2026-06-07（**rev.3 · 完整版 · 调研完成,据此实施**） ｜ 状态：定稿待实施
> 关联：**`research/2026-06-multi-model-context-pack.md`（实施资料包 = 代码锚点 + SDK 契约 + 参考digest + env 清单,实施直接照它）**、`research/2026-06-multi-model-support-research.md`（初版调研）、`prd/2026-06-skills-integration-prd.md`（同构:DB catalog + enablement + admin + BullMQ + seed-on-migrate）、`ROADMAP.md`、`VISION.md`、`CLAUDE.md`。
> 参考实现（借思路不抄码,详见资料包）：**CraftAgent**（`LlmConnection` + 配置/凭据分离 + 懒探活 + 每会话锁定）、**LobeChat**（admin 配置面板 + provider/model 表 + env↔DB 合并 + 手动 check + `${ENV}` 注入）、**LibreChat**（custom-endpoint Zod 校验 + `${ENV}` + 三档 model-list + 每消息记 model/endpoint）、**claude-agent-kit**（`query({options:{env}})` 按请求合并 env 的路由法）。

## 0. Owner 决策（2026-06-07 已拍板）

1. 探活 = **后端,默认 6h 一次(可配)**,不高频。
2. 发送时选了不健康模型 → **直接报错**(不静默回退)。
3. 配置:**密钥落 `.env`**;**admin 在看板看健康度**;且**多模型可在后台配置**(来源 + model ids + 检测可用)。
4. 选择粒度 = **每会话**。
5. 探活 = **直连 `/v1/messages`**。
6. **完整版实施**(非 MVP 裁剪):多模型可**被配置(后台)**,配置即"可选择"的前提。

> 据 #6 + #3,**完整版定调(本 rev 锁定,原 §13-D1 已决为"全")**:
> **定义(连接 + model ids)= DB 真相,admin 后台 CRUD**;**首次从 `.env` 种子引导**(seed-on-migrate,照搬 Skills);**密钥永远只在 `.env`,DB/前端/日志只存/只见 `tokenEnv` 名**。一句话流程:**配置(后台/.env 种子)→ 探活(6h 检测)→ 看板(健康可见)→ 用户每会话选 healthy → 按请求路由到对应连接运行。**

---

## 1. 背景与现状（代码审计已确认,锚点见资料包 §B）

- **模型今天是部署期单值**：`ws-server.mjs` 启动读 `ANTHROPIC_MODEL`(L107),spawn worker 时塞 `workerEnv.ANTHROPIC_MODEL`(L1106-1117);worker `query({ options:{ model } })`(`ws-query-worker.mjs` L689-732)。所有会话共用一个。
- **UI 死徽章**：`chat-composer.tsx` 的「GLM 5.0」纯展示。
- **已有可复用链路**:`skillSlug`/`permissionTier` 走通 **store(selectedTier)→ ws-adapter `chat`(L845-852)→ ws-server `handleChat`(L1027,case L1469-1484)→ worker**。model 照抄。
- **关键使能点**:worker 是**每请求新子进程**;ws-server 可**按请求设其 env**(或经 SDK `query({options:{env}})`,claude-agent-kit 同款)。这是跨账号路由的全部底层机制,**无需 0.3.x**。
- **协议约束**:驱动 **Claude Agent SDK(钉死 0.2.112,最后一个 bundled-JS 版)**,只说 **Anthropic Messages 协议** → 多模型 = **跨 Anthropic 兼容网关的多模型**;纯 OpenAI 厂商需自备 Anthropic 兼容代理(本期不做)。

---

## 2. 目标 / 非目标

**目标**
- G1 用户 composer **按会话选模型**,替代单一 `ANTHROPIC_MODEL`。
- G2 候选模型来自**多个连接(不同 baseUrl + token/账号)**,只要 Anthropic 协议。
- G3 **后台配置**:admin 在 `/admin/models` **CRUD 连接 + model ids**(DB),`.env` 提供种子 + 密钥。
- G4 **检测可用**:后端 **6h 周期探活**(可配 + 手动),判定每模型"能用"。
- G5 **看板**:admin 看每连接/模型的**健康 + 上次探活 + 失败原因 + 延迟**,可 enable/disable + 立即重测。
- G6 **菜单只列 enabled && healthy**;选不健康发送时报错。
- G7 切换对**主模型 + 子代理/后台档一致**(同连接 alias),不串账号。
- G8 **密钥不出 `.env`**(不入 DB/前端/日志/配置 JSON,只按 `tokenEnv` 名引用)。

**非目标(本期不做)**
- N1 失败自动 failover(SDK 有 `fallbackModel` 选项,Phase 4 接)。
- N2 OpenAI-only 协议转译(Phase 4 评估)。
- N3 从 provider `/models` 动态拉取模型列表(LibreChat `fetch:true`)——本期**手动列 model ids**(ARK 等网关 `/models` 不一定可靠,且要精选);留 Phase 4。
- N4 按能力门控(视觉模型才接图片)(Phase 4)。
- N5 per-message 模型记录(成本归集)——有 `modelUsage` 遥测垫底,v-next 接。

---

## 3. 数据模型

借 CraftAgent `LlmConnection`(连接) + 凭据分离。**定义在 DB(admin CRUD),密钥在 `.env`**。

### 3.1 `model_connection`（连接 = 端点 + 一份凭据 = 一个账号/网关；DB,无密钥）
```
id            text pk   # 稳定键,如 "ark-coding"
label         text      # 展示名
baseUrl       text      # 如 https://ark.cn-beijing.volces.com/api/coding(不带 /v1)
authStyle     text      # "bearer" | "x-api-key"
tokenEnv      text      # 持密钥的【环境变量名】,如 ARK_AUTH_TOKEN(值在 .env)
anthropicVersion text   # 默认 "2023-06-01"
customHeaders jsonb?    # 可选,网关路由头 → 设 ANTHROPIC_CUSTOM_HEADERS
aliasOpus/aliasSonnet/aliasHaiku/aliasSubagent text?  # 子代理/后台档模型(同账号)
sort int, createdAt, updatedAt
```

### 3.2 `model_definition`（模型 = 归属连接；DB,admin CRUD）
```
id            text pk   # 全局唯一,线上传输用,如 "ark/glm-5.1"
label         text
connectionId  text fk → model_connection.id
model         text      # 网关认的模型串,如 "glm-5.1"
tags          jsonb?    # ["coding","fast"] 仅 UI 提示
enabled       boolean default true
isDefault     boolean default false  # 全局默认(须 healthy,否则回退首个 healthy)
sort int, createdAt, updatedAt
```

### 3.3 `model_health`（探活产生；看板 + 菜单共读）
```
modelId text pk fk → model_definition.id
health  text       # "healthy" | "unhealthy" | "unknown"
lastProbeAt timestamp
probeError text?   # network|auth|model|timeout|http_4xx|http_5xx
latencyMs int?
```

> **种子(seed-on-migrate,照搬 Skills)**:`.env` 的 `OXY_MODELS_SEED`(JSON)首次写入 `model_connection`+`model_definition`(幂等,存在则跳过)。之后以 DB 为准,admin 改 DB。`.env` 仍是密钥与"开箱即用"来源。

---

## 4. 配置：在哪 / 怎么配（owner #3、#6）

### 4.1 `.env`（仓库内只改 `.env.example`）= 密钥 + 种子
```bash
# 密钥(按 tokenEnv 名;值仅此;绝不入 DB/前端/日志/JSON)
ARK_AUTH_TOKEN=...
ZHIPU_AUTH_TOKEN=...

# 可选 bootstrap 种子(首启写入 DB;之后 admin 在看板维护)
OXY_MODELS_SEED='{
  "default":"ark/glm-5.1",
  "connections":[
    {"id":"ark-coding","label":"火山 ARK","baseUrl":"https://ark.cn-beijing.volces.com/api/coding","authStyle":"bearer","tokenEnv":"ARK_AUTH_TOKEN","aliasHaiku":"doubao-seed-2.0-lite"},
    {"id":"zhipu","label":"智谱 GLM","baseUrl":"https://open.bigmodel.cn/api/anthropic","authStyle":"bearer","tokenEnv":"ZHIPU_AUTH_TOKEN"}
  ],
  "models":[
    {"id":"ark/glm-5.1","label":"GLM 5.1","connection":"ark-coding","model":"glm-5.1","isDefault":true,"tags":["general"]},
    {"id":"ark/doubao-code","label":"Doubao Code 2.0","connection":"ark-coding","model":"doubao-seed-2.0-code","tags":["coding"]},
    {"id":"zhipu/glm-5.1","label":"GLM 5.1(智谱)","connection":"zhipu","model":"glm-5.1","tags":["general"]}
  ]
}'
MODEL_PROBE_CRON="0 */6 * * *"     # 6h 探活(owner #1),BullMQ repeat,可配
```
- **`${ENV}` 原则(LibreChat)**:配置只存 `tokenEnv` 名;密钥按名在**后端**解析,**永不下发前端**。
- **Zod 严校验(LibreChat)**:种子/admin 写入都过 Zod;坏引用(未知 connection)、重复 id、缺字段 → 拒绝并报清晰错误。

### 4.2 DB = 运行期真相,admin 后台 CRUD
- `/admin/models` 可**增删改**连接与 model id、改 `enabled`/`isDefault`、设 `tokenEnv`/baseUrl/authStyle/alias。
- **新增连接的密钥**:UI 只填 `tokenEnv` 名;**值要由有服务器权限者写进 `.env`**(单组织可信团队可接受;符合"密钥出仓库/不入 DB")。UI 即时提示"该 tokenEnv 当前是否已解析到值"。
- env(种子)+ DB 合并:**DB 决定有什么/开没开;env 提供密钥 + 首启种子**(对齐 Lobe env-默认↔DB-覆盖,但密钥永在 env)。

---

## 5. 探活（owner #1、#5；6h 后端）

**探活 = 与 SDK 一致的 Anthropic 协议最小请求。**
- `POST {connection.baseUrl}/v1/messages`,headers:`content-type: application/json` + `anthropic-version: {anthropicVersion}` + 按 `authStyle` 的 **`Authorization: Bearer`** 或 **`x-api-key`**(二选一)+ 可选 `customHeaders`;body `{model, max_tokens:1, messages:[{role:"user",content:"ping"}]}`。
- 判定:**200 → healthy**(可达 + 鉴权 + 模型被接受 = 真"能用");401/403 → `auth`;**404(原生 Anthropic)/400(部分网关)指向模型 → `model`**(⚠️ ARK 实测确认用哪个码);DNS/连接 → `network`;超时 → `timeout`;**429 → 视为 healthy**(限流可用)。
- **周期 = `MODEL_PROBE_CRON`(默认 6h)**,跑在 **`src/worker` BullMQ repeat job**(同 `daily-credit-refill` 写法:`repeat:{pattern}`+稳定 `jobId`)→ 写 `model_health`。另 **admin 手动"立即重测"**(单/全)。
- 走 **`/v1/messages`**(SDK 真实路径),区别于 changedoc 的 ARK **OpenAI `/api/coding/v3`**。
- **仅后端**用密钥;看板/前端只见 health/label/id,**绝不下发 token**。

---

## 6. 菜单可见/可切（owner #2、#6）

| enabled(DB) | health(最近探活) | 用户菜单 |
|---|---|---|
| false | — | 不显示 |
| true | `healthy` | **显示 + 可选** ✅ |
| true | `unknown`(未探/探活中) | "检测中…",不可选 |
| true | `unhealthy` | **置灰 + 原因**(默认);`hideUnhealthy=true` 隐藏 |

- **可选 = enabled && healthy**。默认模型须 healthy,否则回退首个 healthy 并提示。
- **发送时再校验**:所选 model 已 unhealthy/disabled → **直接报错**(owner #2),前端提示换一个,**不静默改**。

---

## 7. 管理看板（admin · owner #3、#5、#6）

- 入口 `/admin/models`(照搬 `/admin/skills` + `requireAdmin`,`skills.server.ts` L76-101)。
- 列表按连接分组:模型行显示**健康圆点 + 上次探活 + 失败原因 + 延迟**;连接显示 baseUrl/authStyle/`tokenEnv`(**不显示 token 值**,只显示"已解析/未解析")。
- 操作:**CRUD 连接/模型**、改 `enabled`/`isDefault`、**立即重测**(单/全)。
- server fn(禁 REST,项目铁律):`listModelsAdmin` / `upsertConnection` / `deleteConnection` / `upsertModel` / `deleteModel` / `setModelEnabled` / `setDefaultModel` / `reprobeModel(s)`,全部 `requireAdmin`。

---

## 8. 选择 → 运行（端到端 · owner #4 每会话；env 契约见资料包 §C）

1. **前端**:`chat-session-store` 增 `selectedModelId`(默认=`isDefault` 且 healthy);composer 下拉读"可选模型"(server fn),写 store,运行中禁用。**每会话**:store + 持久 `agent_session.model`(resume 回显)。
2. **发送**:`ws-adapter` `chat` `InboundMessage` 增 `model?`,带 `model: selectedModelId`(照抄 skillSlug,L845-852)。
3. **ws-server `handleChat`**(L1027；workerEnv 块 L1106-1117):
   - 解析 model → connection;**校验 enabled && healthy**(过期即时补探一次);不满足 → **报错回前端**(owner #2)。
   - 构造按请求 env:
     - `ANTHROPIC_BASE_URL = connection.baseUrl`(**只用 BASE_URL**;`ANTHROPIC_API_URL` 未文档化,保留现状但不依赖)。
     - 鉴权**互斥**:`bearer`→设 `ANTHROPIC_AUTH_TOKEN`、**删 `ANTHROPIC_API_KEY`**;`x-api-key`→设 `ANTHROPIC_API_KEY`、**删 `ANTHROPIC_AUTH_TOKEN`**(SDK:AUTH_TOKEN 优先,二者并存有歧义)。
     - `ANTHROPIC_MODEL = model.model`。
     - alias(网关下才生效):`ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL` + `CLAUDE_CODE_SUBAGENT_MODEL` ← connection 的 alias(缺省回退该连接主模型,**避免子代理/后台档串到别的账号**)。
     - 可选 `ANTHROPIC_CUSTOM_HEADERS = connection.customHeaders`。
4. **worker**:`query({ options:{ model } })` 已就绪(L689);确保解析后的 model 入参。日志 `[Worker] Model: <id>` 核验。

> 实现可二选一:**(a)** 继续设 worker 子进程 env(现状 workerEnv 块,最小改动);**(b)** 经 SDK `query({options:{env}})`(claude-agent-kit 同款)。**选 (a)**——与现有 `ANTHROPIC_MODEL` 注入一致、改动最小。

---

## 9. 安全与约束

- 威胁模型 = 可信团队;菜单组织内可见可切。**CRUD/enable/重测限 admin**。
- **token 永不入 DB/前端/日志/配置 JSON**;只在 `.env`,后端按 `tokenEnv` 取;新增连接的密钥需服务器侧写 `.env`。
- 维持 `ENABLE_STRUCTURED_OUTPUTS=false`;切换不得重触发 StructuredOutput Stop-hook。
- 钉死 SDK 0.2.112;不引入 0.3.x-only;`query()` 无 apiKey/baseUrl 选项 → 一律走 env。

---

## 10. 测试计划

- **单元**:种子/admin 写入 Zod 校验(坏引用/重复 id/缺字段);env+DB 合并;菜单状态机;selection 校验(disabled/unhealthy→报错);**env 构造**(bearer↔x-api-key 互斥 + 删另一个 + alias + customHeaders);探活码分类(200/401/404/429/超时)。
- **集成**:真实 ARK 模型探活→healthy 写 DB;坏 token→`auth`;worker env 路由→`query()` 实跑;手动重测刷看板;admin CRUD round-trip。
- **手动/验收**:见 §11。

---

## 11. 验收标准（完整版）

- AC1 种子 ≥2 连接、≥3 模型;6h(或手动)探活后,**菜单只列 enabled && healthy**;看板显示全部 + 健康/时间/原因/延迟。
- AC2 切换 → 该次运行**确实用所选模型/连接**(worker 日志),含**跨账号**。
- AC3 某模型 token 置坏 → 下次探活后菜单消失/置灰、看板标 `auth`;其他不受影响。
- AC4 选不健康模型发送 → **报错**(不静默换)。
- AC5 admin 看板 disable/CRUD → 用户菜单即时反映(无需重启)。
- AC6 默认模型不健康 → 回退首个 healthy + 提示。
- AC7 token **不出现在看板/前端/日志/网络响应**(脱敏校验)。
- AC8 子代理/后台档跟随所选连接(不串账号;alias 生效)。
- AC9 admin 新增连接 + 在 `.env` 配好其 `tokenEnv` → 该连接模型探活 healthy → 可选。

---

## 12. 分阶段（本期 = 完整版）

| 阶段 | 范围 | 估算 |
|---|---|---|
| **本期(完整版)** | DB 三表(connection/definition/health)+ seed-on-migrate + `${ENV}`/Zod 校验 + 6h BullMQ 探活 + `/admin/models` CRUD+看板 + 选择链路(每会话 + `agent_session.model`)+ 按请求 env 路由(BASE_URL/互斥 auth/MODEL/alias/customHeaders)+ composer 真 picker + 发送时报错。 | L(分多 PR) |
| **v-next** | per-message 模型记录(成本)+ provider `/models` 动态拉取(`fetch`)。 | M |
| **Phase 4** | `fallbackModel` failover/路由、按能力门控、OpenAI-only 转译代理、per-capability key 拆分。 | M–L |

**实施 PR 切分(建议序,详见资料包 §E)**:① DB 三表 + 迁移 + seed + registry(env 解析 + DB 合并 + Zod);② 探活模块 + 6h BullMQ job + 手动重测;③ ws 选择链路(adapter/store/handleChat env 路由/worker)+ 发送时报错;④ composer picker;⑤ `/admin/models` 看板 + CRUD server fns;⑥ `agent_session.model` 持久 + resume 回显。每步独立 PR、可单测、admin-merge。

---

## 13. 待 Owner 确认（仅剩次要项）

- D1 ~~v1 admin 范围~~ → **已决:完整版 = admin DB CRUD(本 rev 锁定)**。
- D2 `hideUnhealthy` 默认 = 置灰显示原因(false),确认沿用?
- D3 新增连接密钥需服务器侧写 `.env`(不在 UI 存密钥)——确认接受?(替代:DB 加密存 key,与"密钥出仓库"冲突,**不推荐**。)

---

## 14. 实现清单（完整版,精确锚点见资料包 §B）

- `.env.example`:`OXY_MODELS_SEED` / `MODEL_PROBE_CRON` + 各 `*_AUTH_TOKEN` 占位。
- `src/db/schema/model.schema.ts`(新):`model_connection` / `model_definition` / `model_health`(照 `skill-catalog.schema.ts`)。
- `drizzle/`:新迁移;`migrate`/seed 接 `OXY_MODELS_SEED`(照 Skills seed-on-migrate)。
- `src/config/model-registry.*`(新):解析 env 种子 + Zod + 与 DB 合并 + `resolveModel(id)`+`getSelectableModels()`+`buildWorkerEnv(model)`。
- `src/.../model-probe.*`(新,后端):`probeModel()`(直连 `/v1/messages`)+ 码分类。
- `src/jobs/queues.ts`+`src/worker/index.ts`:加 `probe-models` repeat job(`MODEL_PROBE_CRON`)+ 手动入队。
- `ws-server.mjs`:`handleChat`(L1027)收 + 校验 `model`;**重写 workerEnv 块(L1106-1117)**为按请求 `buildWorkerEnv`(BASE_URL/互斥 auth/MODEL/alias/customHeaders);不健康→报错。
- `ws-query-worker.mjs`(L23-26、L689):确认解析后 model 入 `query()`。
- `src/claude/adapters/ws-adapter.ts`(L109-119、L845-852):`chat` 增 `model?`;`listModels`/`probeStatus` 通道。
- `src/lib/chat-session-store.ts`(仿 selectedTier L180-183/422-424):`selectedModelId`+setter(每会话)。
- `src/components/claude-chat/chat-composer.tsx`(死徽章 ~L468;仿 tier selector):分组下拉 + health 圆点 + 禁用态。
- `src/routes/admin/models/`(新,照 `src/routes/admin/skills`)+ `src/server/function/models.server.ts`(照 `skills.server.ts` requireAdmin)。
- `src/db/schema/agent-session.schema.ts`(L16-45):加 `model text` 列 + 迁移。
