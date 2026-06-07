# PRD：多模型切换（Anthropic 协议 · 跨账号 · 配置→探活→可切 · 管理看板）

> 日期：2026-06-07（rev.2，owner 决策已并入） ｜ 状态：草案待评审
> 关联：`research/2026-06-multi-model-support-research.md`（调研 + 现状代码审计）、`ROADMAP.md`（NEXT · 多模型）、`prd/2026-06-skills-integration-prd.md`（同构能力中心 + DB enablement 模式）、`VISION.md`、`CLAUDE.md`（SDK 钉死 0.2.112 / ARK）。
> 参考实现（借思路不抄码）：**CraftAgent**（`references/famous_ai-chat_projects/craft-agents-oss`，`LlmConnection` + 配置/凭据分离 + 懒探活 + 每会话锁定）、**Lobe Chat**（admin 配置面板 + provider/model 表 + 手动 health check + env 默认与 DB 覆盖合并）。

## 0. Owner 决策（2026-06-07，已拍板 → 本 rev 据此定稿）

1. **探活是后端功能,默认 6 小时一次(可配),不需要高频。**
2. **发送时选了不健康的模型 → 直接报错**(不静默回退)。
3. **配置落入 `.env`**(沿用密钥纪律);但 **admin 需要一个看板看到模型健康度**。
4. **选择粒度 = 每个会话**。
5. **探活方式 = 直连 `/v1/messages`**。
6. **多模型不只是"被选择",还要能"被配置(后台)"**:配置多个**模型来源**、配置**模型 model ids**、**检测可用** —— 这三件是"可选择"的前提。

> 一句话模型:**配置(来源 + model ids)→ 探活(检测可用)→ 看板(健康可见)→ 用户每会话选一个 healthy 的 → 按请求路由到对应连接运行。**

---

## 1. 背景与现状（代码审计已确认）

- **模型今天是部署期单值**：`ws-server.mjs` 启动读 `ANTHROPIC_MODEL`,spawn worker 时塞进子进程 env;worker `query({ options:{ model } })`。所有会话共用一个模型。
- **UI 是死徽章**：`chat-composer.tsx` 的「GLM 5.0」纯展示,无任何后端效果。
- **已有可复用链路**:`skillSlug` / `permissionTier` 已走通 **store → ws-adapter `chat` 消息 → ws-server `handleChat` → worker**。model 照抄。
- **关键使能点**:worker 是**每请求新子进程**,`ws-server` 可**按请求覆写** `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_URL` / `ANTHROPIC_AUTH_TOKEN`(或 `ANTHROPIC_API_KEY`)/ `ANTHROPIC_MODEL`。**这就是跨账号切换的全部底层机制**,无需 SDK 0.3.x。
- **协议约束**:驱动的是 **Claude Agent SDK(钉死 0.2.112)**,只说 **Anthropic Messages 协议** → "多模型"= **跨 Anthropic 兼容网关的多模型**;纯 OpenAI 厂商需自备 Anthropic 兼容代理(本期不做)。

---

## 2. 目标 / 非目标

**目标**
- G1 用户能在 composer **按会话选择本次运行的模型**,替代单一 `ANTHROPIC_MODEL`。
- G2 候选模型可来自**多个连接(不同 baseURL + 不同 token/账号)**,只要是 Anthropic 协议。
- G3 **配置(后台)**:可配置多个**模型来源**与每个来源下的 **model ids**(v1 经 `.env`,v2 经 DB admin)。
- G4 **检测可用**:后端 **6h 周期探活**(可配 + 可手动),判定每个模型"是否能用"。
- G5 **管理看板**:admin 能在看板看到所有连接/模型的**健康度 + 上次探活时间 + 失败原因**,并能 **enable/disable** 单个模型。
- G6 **菜单只列当前能用的(enabled && healthy)**;选了不健康的发送时报错。
- G7 切换对**主模型 + 子代理/后台档**一致生效(同连接 alias),不串账号。
- G8 **密钥不出仓库、不进前端、不进 DB**(只在 `.env`/`secrets.env`,按名引用)。

**非目标(本期不做)**
- N1 失败自动 failover / 负载均衡(Phase 4)。
- N2 OpenAI-only 厂商协议转译(Phase 4 评估)。
- N3 v1 不做"admin 在网页新增/删除**来源**"(来源仍走 `.env`);admin 只**看健康 + 改 enable**。**v2** 再上 DB 全量 CRUD(照搬 Skills 目录)。详见 §13-D1。
- N4 按能力门控(只让视觉模型接图片)(Phase 4)。
- N5 计费按模型精细归集(已有 `modelUsage` 遥测,后续配 per-message 记录)。

---

## 3. 数据模型（连接 / 模型 / 运行期健康）

借 CraftAgent 的 `LlmConnection`(连接) + LibreChat 的 spec→preset 两层。

### 3.1 Connection（连接 = 一个 Anthropic 兼容端点 + 一份凭据 = 一个账号/网关）
```
id            # 稳定键,如 "ark-coding"
label         # 展示名
baseUrl       # 如 https://ark.cn-beijing.volces.com/api/coding
authStyle     # "bearer"(ARK) | "x-api-key"(原生 Anthropic)
tokenEnv      # 持密钥的【环境变量名】,如 ARK_AUTH_TOKEN(值在 .env,不入配置 JSON/DB/前端)
anthropicVersion?  # 默认 "2023-06-01"
aliases?      # 子代理/后台档默认模型 { sonnet, opus, haiku, subagent }
```
> 跨账号 = 多个 Connection,各自 `baseUrl` + `tokenEnv`。**凭据与配置分离**(CraftAgent 实践):配置可读/可日志,密钥单独按名取。

### 3.2 Model（模型 = 归属某连接）
```
id            # 全局唯一,前端/线上传输用,如 "ark/glm-5.1"
label         # 展示名
connection    # 引用 Connection.id
model         # 网关认的模型串,如 "glm-5.1"
tags?         # ["coding","fast","cheap","vision"] 仅 UI 提示
aliases?      # 覆盖连接级 alias(可选)
```
> `enabled` 不放静态配置,而在 **DB `model_enablement`**(admin 可在看板即时改,无需改 `.env`/重启)。默认启用。

### 3.3 运行期健康（由探活产生,落 DB `model_health`,看板 + 菜单共读）
```
modelId, health("healthy"|"unhealthy"|"unknown"), lastProbeAt, probeError?(network|auth|model|timeout|http_xxx), latencyMs?
```

---

## 4. 在哪配置 / 如何配置（owner 决策 #3、#6）

### 4.1 来源 + model ids → `.env`（仓库内只更新 `.env.example`）
配置即 `.env` 的几个变量(非密钥部分是 JSON,密钥是独立变量,按 `tokenEnv` 引用):

```bash
# —— 多模型配置(非密钥;可被看板读取/展示) ——
OXY_MODEL_DEFAULT="ark/glm-5.1"      # 默认模型 id(须最终解析为 healthy,否则回退首个 healthy)
OXY_MODEL_CONNECTIONS='[
  {"id":"ark-coding","label":"火山 ARK","baseUrl":"https://ark.cn-beijing.volces.com/api/coding","authStyle":"bearer","tokenEnv":"ARK_AUTH_TOKEN","aliases":{"haiku":"doubao-seed-2.0-lite"}},
  {"id":"zhipu","label":"智谱 GLM","baseUrl":"https://open.bigmodel.cn/api/anthropic","authStyle":"bearer","tokenEnv":"ZHIPU_AUTH_TOKEN"}
]'
OXY_MODELS='[
  {"id":"ark/glm-5.1","label":"GLM 5.1","connection":"ark-coding","model":"glm-5.1","tags":["general"]},
  {"id":"ark/doubao-code","label":"Doubao Code 2.0","connection":"ark-coding","model":"doubao-seed-2.0-code","tags":["coding"]},
  {"id":"zhipu/glm-5.1","label":"GLM 5.1(智谱直连)","connection":"zhipu","model":"glm-5.1","tags":["general"]}
]'
MODEL_PROBE_INTERVAL_MS=21600000     # 探活周期,默认 6h(owner #1)

# —— 密钥(按 tokenEnv 名;值仅此处,绝不入 JSON/DB/前端) ——
ARK_AUTH_TOKEN=...
ZHIPU_AUTH_TOKEN=...
```
> 说明:连接/模型定义放 **非密钥 JSON 变量**(可安全送看板);token 只在独立变量,服务端按 `tokenEnv` 取。`.env` 是单一配置入口(owner #3)。**仓库内只改 `.env.example`,不改真实 `.env`。**

### 4.2 admin 可改的部分 → DB（看板,无需重启）
- **`model_enablement`**(admin 改):某 model 的 `enabled`。
- **`model_health`**(探活写):健康度 + 时间 + 原因。
- 这两张表让"配置 model ids 的**开关**"和"健康可见"在看板即时生效,而**来源/凭据仍在 `.env`**(v1 不在网页改来源,见 §13-D1)。

### 4.3 加载与合并
`ws-server` + web app 启动:读 `.env` 的 JSON → 解析连接/模型 → 与 DB `model_enablement` 合并(env 定义 + DB 开关)→ 与 DB `model_health` 合并(展示/门控)。**env 决定"有什么",DB 决定"开没开 + 健不健康"**(对齐 Lobe 的 env-默认 + DB-覆盖思路,但密钥永不入 DB)。

---

## 5. 如何测试（探活 —— owner #1、#5）

**探活 = 用与 SDK 一致的 Anthropic 协议,向该模型的连接发最小请求。**

- 请求:`POST {connection.baseUrl}/v1/messages`,headers `anthropic-version` + 按 `authStyle` 的 `Authorization: Bearer`/`x-api-key`,body `{model, max_tokens:1, messages:[{role:"user",content:"ping"}]}`。
- 判定:**200 + 合法 message → healthy**(端点可达 + 凭据有效 + 模型名被接受 = 真"能用");401/403→`unhealthy(auth)`;400/404→`unhealthy(model)`;DNS/连接→`network`;超时→`timeout`;**429→视为 healthy**(限流但可用)。
- **周期 = 6h,可配**(`MODEL_PROBE_INTERVAL_MS`,owner #1);**后端**跑(ws-server 定时器,或 BullMQ 可重复任务——已具 Redis/BullMQ),结果写 `model_health`。另提供 **admin 手动"立即重测"**(单个/全部)。
- 与 changedoc 区分:changedoc 用 ARK 的 **OpenAI 协议 `/api/coding/v3`**;**探活走 Anthropic `/v1/messages`**(SDK 真实路径)。
- 密钥只在后端用,**看板/前端只见 health/label/id**,绝不下发 token。

---

## 6. 什么状态下显示在可切换菜单里（owner #2、#6）

| enabled(DB) | health(最近一次探活) | 用户菜单 |
|---|---|---|
| false | — | **不显示** |
| true | `healthy` | **显示 + 可选** ✅ |
| true | `unknown`(从未探/探活中) | "检测中…",不可选 |
| true | `unhealthy` | **置灰 + 原因**(默认);`hideUnhealthy=true` 时隐藏 |

- **可选 = enabled && healthy**。
- **默认模型**须 healthy,否则回退首个 healthy 并提示。
- **发送时再校验一次**:若所选 model 已变 unhealthy/disabled → **直接报错**(owner #2),前端提示换一个(不静默改模型)。

---

## 7. 管理看板（admin · owner #3、#5、#6）

- 入口:`/admin/models`(照搬 `/admin/skills` 的 admin 模式)。
- 展示:按 Connection 分组列出模型 → 每行 **健康圆点 + 上次探活时间 + 失败原因 + 延迟**;连接级显示 baseUrl/authStyle(**不显示 token**)。
- 操作:**enable/disable** 单模型(写 `model_enablement`);**立即重测**(单个/全部,触发 §5 探活)。
- v1 只读"来源/凭据"(改来源去 `.env`);**v2** 加来源/model id 的网页 CRUD(DB,密钥仍 env 引用)。
- 数据走 server fn(`listModelsAdmin` / `setModelEnabled` / `reprobeModel`),遵守项目"Server Functions 优先、禁 REST"。

---

## 8. 选择 → 运行（端到端 · owner #4 每会话）

1. **前端**:`chat-session-store` 增 `selectedModelId`(默认=`OXY_MODEL_DEFAULT`,须 healthy);composer 下拉读"可选模型"(server fn/WS),写 store;运行中禁用。**每会话**保留选择(store + 持久到 `agent_session.model`,resume 回显)。
2. **发送**:`ws-adapter` 的 `chat` `InboundMessage` 增 `model?: string`,带 `model: selectedModelId`(照抄 skillSlug/permissionTier)。
3. **ws-server `handleChat`**:
   - 解析 model → Connection;**校验 enabled && healthy**;不满足 → **报错回前端**(owner #2)。
   - 构造 `workerEnv`:`ANTHROPIC_BASE_URL`+`ANTHROPIC_API_URL`=baseUrl;按 `authStyle` 写 `ANTHROPIC_AUTH_TOKEN` **或** `ANTHROPIC_API_KEY`(**互斥,清掉另一个**);`ANTHROPIC_MODEL`=model;`ANTHROPIC_DEFAULT_*`/`CLAUDE_CODE_SUBAGENT_MODEL`=alias。
4. **worker**:`query({ options:{ model } })` 已就绪;日志 `[Worker] Model: <id>` 便于核验。

**子代理一致性(G7)**:跨账号必须按请求设 alias,否则子代理/后台档打到部署默认连接(别的账号)。

---

## 9. 安全与约束

- 威胁模型 = 可信团队;菜单对组织内用户可见可切——可接受。enable/重测等**看板操作限 admin**。
- **token 永不入 JSON 配置 / DB / 前端 / 日志**;只在 `.env`,后端按 `tokenEnv` 取。
- 维持 `ENABLE_STRUCTURED_OUTPUTS=false`;切换不得重触发 StructuredOutput Stop-hook。
- 钉死 SDK 0.2.112;不引入 0.3.x-only 特性。

---

## 10. 测试计划

- **单元**:JSON 配置解析/校验(坏引用/未知 connection/重复 id)、env+DB 合并(enabled)、菜单状态机、selection 校验(disabled/unhealthy → 报错)、`workerEnv` 构造(bearer↔x-api-key 互斥 + alias)。
- **集成**:真实 ARK 模型探活→healthy 写 DB;坏 token→unhealthy(auth);worker env 路由→`query()` 实跑;手动重测刷新看板。
- **手动/验收**:见 §11。

---

## 11. 验收标准（v1）

- AC1 `.env` 配 ≥2 连接、≥3 模型;启动 + 6h 探活后,**菜单只列 enabled && healthy**;看板显示全部 + 健康/时间/原因。
- AC2 切换模型 → 该次运行**确实用所选模型/连接**(worker 日志可证),含**跨账号**。
- AC3 把某模型 token 置坏 → 下一次探活后它在菜单**消失/置灰**、看板标 `unhealthy(auth)`;其他不受影响。
- AC4 选了不健康模型发送 → **报错**(不静默换)。
- AC5 admin 在看板 disable 某模型 → 用户菜单即时不可选(无需重启)。
- AC6 默认模型不健康 → 回退首个 healthy 并提示。
- AC7 token **不出现在看板/前端/日志**(脱敏校验)。
- AC8 子代理/后台档跟随所选连接(不串账号)。

---

## 12. 分阶段

| 阶段 | 范围 | 估算 |
|---|---|---|
| **v1(本期)** | `.env` 配置(连接+model ids)+ 6h 后端探活 → `model_health` + `model_enablement` 两表 + **admin 看板**(健康/重测/enable)+ 选择链路(每会话)+ 按请求 workerEnv 路由(含 alias)+ composer 真 picker + 发送时报错。 | M–L |
| **v2** | 看板**网页 CRUD 来源/model id**(DB 化定义,密钥仍 env 引用)+ per-message 模型记录(成本归集)。 | M |
| **Phase 4** | failover/路由、按能力门控、OpenAI-only 转译代理评估、per-capability key 进一步拆分。 | M–L |

---

## 13. 待 Owner 确认（其余决策点)

> §0 的 6 项已拍板并入正文。剩下 1 个需确认:

- **D1（v1 admin 范围）**:v1 看板 = **只读来源 + 健康 + enable/重测**(来源/model-id 定义仍走 `.env`);"网页新增/删除来源与 model id"放 v2。**确认?** 还是希望 v1 就能在网页加来源(则需把定义也 DB 化、本期范围加大)?
- (次要)`hideUnhealthy` 默认 = 置灰显示原因(false),确认沿用?

---

## 14. 关联实现清单（v1）

- `.env.example`:`OXY_MODEL_DEFAULT` / `OXY_MODEL_CONNECTIONS` / `OXY_MODELS` / `MODEL_PROBE_INTERVAL_MS` + 各 `*_AUTH_TOKEN` 占位。
- `src/config/model-registry.*`(新):解析 env JSON + 按 `tokenEnv` 取密钥 + `resolveModel(id)` + 与 DB 合并 + `getSelectableModels()`。
- DB:迁移加 `model_health`、`model_enablement` 两表(照搬 Skills `skill_enablement` 写法)。
- 探活模块(新,后端):`probeModel()`(直连 `/v1/messages`)+ 6h 定时器/BullMQ + 写 `model_health` + 手动重测。
- `ws-server.mjs` `handleChat`:收 + 校验 `model`、构造按请求 `workerEnv`(baseURL/auth/model/alias);不健康→报错。
- `ws-query-worker.mjs`:确认解析后的 model 入 `query()`。
- `src/claude/adapters/ws-adapter.ts`:`chat` 增 `model?`;`listModels`/`probeStatus` 通道。
- `src/lib/chat-session-store.ts`:`selectedModelId` + setter(每会话)。
- `src/components/claude-chat/chat-composer.tsx`:死徽章 → 分组下拉(health 圆点、禁用态)。
- `src/routes/agents`(或 admin 区)新增 `/admin/models` 看板 + server fns(`listModelsAdmin`/`setModelEnabled`/`reprobeModel`)。
- `agent_session.model` 列 + 迁移(每会话持久,owner #4)。
