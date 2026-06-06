# PRD：多模型切换（Anthropic 协议 · 跨账号 · 健康可用才可切）

> 日期：2026-06-07 ｜ 状态：草案待评审
> 关联：`research/2026-06-multi-model-support-research.md`（调研 + 现状代码审计）、`ROADMAP.md`（NEXT · 多模型）、`VISION.md`（私有部署 / 单组织 / 可信团队）、`CLAUDE.md`（SDK 钉死 0.2.112 / ARK 约束）。
> Owner 口径（2026-06-07）：**只要是支持 Anthropic 协议、且当前能用的模型，不管是不是来自同一个账号/网关，都要能在菜单里切。** 即 v1 直接支持**跨连接（跨账号/跨网关）**,不局限单网关;**能不能切由实时探活决定**。

---

## 1. 背景与现状（代码审计已确认）

- **模型今天是部署期单值**：`ws-server.mjs` 启动读 `ANTHROPIC_MODEL`,spawn worker 时塞进子进程 env;worker `query({ options:{ model } })`。所有会话共用一个模型。
- **UI 是死徽章**：`chat-composer.tsx` 的「GLM 5.0」纯展示,**无任何后端效果**,前端→worker 不传 model。
- **已有可复用链路**:`skillSlug` / `permissionTier` 已经走通 **store → ws-adapter `chat` 消息 → ws-server `handleChat` → worker**。model 照抄这条路。
- **关键使能点**:worker 是**每请求新子进程**,`ws-server` 可**按请求覆写**它的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_URL` / `ANTHROPIC_AUTH_TOKEN`(或 `ANTHROPIC_API_KEY`) / `ANTHROPIC_MODEL`。**这就是跨账号切换的全部底层机制**,无需 SDK 0.3.x。
- **协议约束**:我们驱动的是 **Claude Agent SDK(钉死 0.2.112)**,它只说 **Anthropic Messages 协议**。所以"多模型"= **跨 Anthropic 兼容网关的多模型**;纯 OpenAI 协议厂商需自备 Anthropic 兼容代理才能纳入(本期不做转译)。

---

## 2. 目标 / 非目标

**目标**
- G1 用户能在 composer 里**选择本次运行用哪个模型**,替代单一 `ANTHROPIC_MODEL`。
- G2 候选模型可来自**多个连接(不同 baseURL + 不同 token/账号)**,只要是 Anthropic 协议。
- G3 **菜单只显示"当前能用"的模型**——由**实时探活**(reachable + 鉴权通过 + 模型名被接受)决定是否可选。
- G4 切换对**主模型 + 子代理/后台档**一致生效(同连接的 alias 模型),避免子代理跑去别的账号。
- G5 **密钥不出仓库、不进前端**;配置可被团队 owner 维护。

**非目标(本期不做,留后续)**
- N1 失败自动 failover / 负载均衡(Phase 4)。
- N2 OpenAI-only 厂商的协议转译。
- N3 DB 化 + admin 网页编辑(v2,本期用配置文件)。
- N4 按能力门控(只让视觉模型接图片任务)(Phase 4)。
- N5 计费按模型精细归集(已有 `modelUsage` 遥测,后续配 per-message 记录)。

---

## 3. 数据模型(两层:连接 + 模型)

参考 LibreChat 的 spec→preset 两层,裁剪到我们的场景。

### 3.1 Connection(连接 = 一个 Anthropic 兼容端点 + 一份凭据 = 一个账号/网关)
```
id            # 稳定键,如 "ark-coding"
label         # 展示名,如 "火山 ARK (coding)"
baseUrl       # Anthropic 兼容基址,如 https://ark.cn-beijing.volces.com/api/coding
authStyle     # "bearer" (ARK) | "x-api-key" (原生 Anthropic)
tokenEnv      # 持有密钥的【环境变量名】,如 ARK_AUTH_TOKEN(值在 secrets.env,不写进本文件)
anthropicVersion?  # 默认 "2023-06-01"
aliases?      # 该连接的子代理/后台档默认模型(见 §7):{ sonnet, opus, haiku, subagent }
```
> 跨账号 = 配多个 Connection,各自 `baseUrl` + `tokenEnv`。

### 3.2 Model(模型 = 归属某个连接)
```
id            # 全局唯一,前端/线上传输用,如 "ark/glm-5.1"
label         # 展示名,如 "GLM 5.1"
connection    # 引用某个 Connection.id
model         # 网关认的模型串,如 "glm-5.1"
enabled       # 默认 true;false=隐藏不删
tags?         # ["coding","fast","cheap","vision"] 仅 UI 提示
aliases?      # 覆盖连接级 alias(可选)
```

### 3.3 运行期状态(不写进配置,由探活产生)
```
health        # "healthy" | "unhealthy" | "unknown"
lastProbeAt   # 上次探活时间
probeError?   # 不健康原因分类(network|auth|model|timeout|http_xxx)
```

---

## 4. 在哪配置 / 如何配置

### 4.1 在哪配置(决策:配置文件 + 环境变量密钥;v2 再上 DB)
- **模型/连接定义** → 一个**仓库外的 YAML 文件**,路径由 `MODELS_CONFIG_PATH` 指定:
  - Mac/Tunnel 部署:`~/oxygenie-deploy/models.yaml`
  - 容器部署:挂载到 `/data/config/models.yaml`
  - 仓库内提供模板 **`models.example.yaml`**(非密钥,可入库/可放配置仓)。
- **密钥** → **不写进 YAML**,YAML 只写**环境变量名**(`tokenEnv`);真实值放既有的 `~/oxygenie-deploy/secrets.env`(chmod 600,仓库外)。`ws-server` 启动时按名解析。
- **理由**:① 沿用既定"密钥出仓库"纪律;② YAML 非密钥,可审计/可版本化;③ 部署期可改、可挂载;④ 不引入 DB 迁移即可上线。**v2** 再做 DB 表 + admin UI(照搬 Skills 目录:DB=真相、`migrate` 种子、admin 增删)。

### 4.2 配置示例(`models.example.yaml`)
```yaml
defaultModel: "ark/glm-5.1"        # 必须最终解析为一个 healthy 的模型,否则回退到首个 healthy

connections:
  - id: ark-coding
    label: "火山 ARK (coding)"
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding"
    authStyle: bearer
    tokenEnv: ARK_AUTH_TOKEN        # 值在 secrets.env
    aliases: { haiku: "doubao-seed-2.0-lite" }   # 后台廉价档同账号

  - id: zhipu-anthropic             # 另一个账号/网关示例
    label: "智谱 GLM (anthropic)"
    baseUrl: "https://open.bigmodel.cn/api/anthropic"
    authStyle: bearer
    tokenEnv: ZHIPU_AUTH_TOKEN

models:
  - { id: "ark/glm-5.1",            label: "GLM 5.1",       connection: ark-coding,     model: "glm-5.1",            tags: [general] }
  - { id: "ark/doubao-code-2.0",    label: "Doubao Code 2.0", connection: ark-coding,   model: "doubao-seed-2.0-code", tags: [coding] }
  - { id: "zhipu/glm-5.1",          label: "GLM 5.1 (智谱直连)", connection: zhipu-anthropic, model: "glm-5.1",       tags: [general], enabled: true }
```

### 4.3 加载与刷新
- `ws-server` 启动:读 YAML → 解析 `tokenEnv` → 建内存 registry → 探活(§5)。
- 刷新:① 启动时;② 管理动作/信号触发"重载 + 重探"(无需整体重启);③ 探活按 TTL 周期复查。v2 改 DB 后即时生效。

---

## 5. 如何测试(健康/可用性探活 —— "能用"的定义)

**探活 = 用与 SDK 完全一致的 Anthropic 协议,向该模型的连接发一个最小请求。**

- 请求:`POST {connection.baseUrl}/v1/messages`
  - headers:`anthropic-version: {anthropicVersion}`;鉴权按 `authStyle`:`Authorization: Bearer <token>`(bearer)或 `x-api-key: <token>`(x-api-key)
  - body:`{ "model": <model>, "max_tokens": 1, "messages": [{"role":"user","content":"ping"}] }`
- 判定:
  - **HTTP 200 + 合法 message** → `healthy`(同时验证了:端点可达 + 凭据有效 + 模型名被接受 = 真正"能用")。
  - 401/403 → `unhealthy(auth)`;404/400(模型/路径)→ `unhealthy(model)`;DNS/连接 → `unhealthy(network)`;超时 → `unhealthy(timeout)`;**429** → 视为 `healthy`(限流但可用,记 warn,不挡菜单)。
- 时机:启动全量探一遍;结果带 **TTL 缓存**(建议 5–10 min);周期复探 + 提供**手动"测试"**(单模型 / 全量)。
- 与 changedoc 区分:那条用的是 ARK 的 **OpenAI 协议 `/api/coding/v3`**;**本探活必须走 Anthropic 的 `/v1/messages`**(SDK 实际路径),不可混用。
- 实现位置:`ws-server` 服务端(密钥不出后端);探活结果只把 `health/label/id` 暴露给前端,**绝不下发 token**。

> 待确认(§11):探活是否再加一档"轻量但更真"的方式(用 SDK 跑一次极短 query)。默认采用直连 `/v1/messages`,够用且便宜。

---

## 6. 什么状态下显示在可切换菜单里(状态机)

每个模型对前端的可见性/可选性:

| enabled | health(在 TTL 内) | 菜单表现 |
|---|---|---|
| false | — | **不显示** |
| true | `healthy` | **显示 + 可选** ✅ |
| true | `unknown`(探活中/未探) | 显示为"检测中…",**不可选**,变 healthy 后转可选 |
| true | `unhealthy` | **置灰显示 + 标注原因**(默认),`hideUnhealthy=true` 时隐藏 |

- **可切换 = enabled && healthy && 在 TTL 内**。
- **默认模型**必须 healthy;否则自动回退到**首个 healthy** 模型,并发一条 warn(线上 + 前端提示)。
- 置灰显示不健康项(默认)是为了让 owner 一眼看到"为什么不能选"(如 token 失效)。可配 `hideUnhealthy` 改为纯隐藏。

---

## 7. 选择 → 运行(端到端流程)

1. **前端**:`chat-session-store` 增 `selectedModelId`(默认=配置 defaultModel,须 healthy)。composer 下拉读 registry(server fn / WS)写入 store;运行中禁用。
2. **发送**:`ws-adapter` 的 `chat` `InboundMessage` 增 `model?: string`,发送时带 `model: selectedModelId`(照抄 skillSlug/permissionTier)。
3. **ws-server `handleChat`**:
   - 解析 `model` → 找到 Model → 其 Connection;
   - **校验** enabled && healthy(过期则即时补探一次);非法/不健康 → 决策见 §11(默认:拒绝并回前端清晰错误,不静默换模型);
   - 构造 `workerEnv`:覆写 `ANTHROPIC_BASE_URL`+`ANTHROPIC_API_URL`=connection.baseUrl;按 `authStyle` 写 `ANTHROPIC_AUTH_TOKEN` **或** `ANTHROPIC_API_KEY`(并清掉另一个,避免 SDK 走错鉴权);`ANTHROPIC_MODEL`=model.model;`ANTHROPIC_DEFAULT_*` / `CLAUDE_CODE_SUBAGENT_MODEL`=alias(模型级覆盖连接级,缺省保留部署默认)。
4. **worker**:`query({ options:{ model } })` 已就绪,确保拿到解析后的 model。日志 `[Worker] Model: <id>` 便于核验。

**子代理一致性(G4)**:跨账号时,若不设 alias,子代理/后台档会打到部署期的旧连接(别的账号)。故 Connection/Model 带 alias,`ws-server` 按请求一并设置。

**持久化**:v1 先 store-only。建议同时给 `agent_session` 加 `model` 列(resume 复用 + 菜单回显);per-message 记录(成本归集)留 v2,配既有 `modelUsage` 遥测。

---

## 8. UX

- composer 把死徽章换成**真下拉**:按 Connection 分组,每项带 health 圆点(绿/灰)、tags;不健康项置灰 + hover 显示原因;运行中禁用。
- 顶部/会话信息处回显"当前模型"。
- (可选)设置页一个只读的"模型与连接健康"面板 + "全部重测"按钮。

---

## 9. 安全与约束

- 威胁模型 = 可信团队(VISION)。菜单对组织内用户可见、可切——可接受。
- **token 永不下发前端**;探活 + workerEnv 全在后端;前端只见 id/label/health/tags。
- 密钥在 `secrets.env`(仓库外);YAML 只存 env 变量名 = "per-capability key 拆分"的雏形。
- 维持 `ENABLE_STRUCTURED_OUTPUTS=false`;切换模型不得重新触发 StructuredOutput Stop-hook 路径。
- 钉死 SDK 0.2.112;不引入 0.3.x-only 特性。

---

## 10. 测试计划

- **单元**:YAML 解析 + 校验(缺字段/坏引用/未知 connection)、状态机(enabled×health→可见/可选)、selection 校验(未知/不健康/禁用 model 的处理)、workerEnv 构造(bearer vs x-api-key 互斥、alias 覆盖)。
- **集成**:对一个真实 ARK 模型探活 → healthy;worker env 路由 → `query()` 实跑;故意用坏 token → unhealthy(auth) 且不可选。
- **手动**:UI 切到 A 模型发消息 → worker 日志 `Model: A`;切到不同连接的 B → 日志显示新 baseURL 生效(脱敏);把某连接 token 改坏 → 该连接下模型置灰不可选。
- **跨账号验收**:配两个连接(ARK + 智谱),两者各自 healthy,切换后分别用各自账号跑通。

---

## 11. 验收标准(v1)

- AC1 配置 `models.yaml`(≥2 个连接、≥3 个模型)后,启动探活,**菜单只列出 healthy 的模型**。
- AC2 切换模型 → 该次运行**确实用所选模型/连接**(worker 日志可证),含跨账号。
- AC3 把某模型 token 置坏 → 它在菜单**置灰且不可选**,原因可见;其他模型不受影响。
- AC4 默认模型不健康时**自动回退首个 healthy** 并提示。
- AC5 token **不出现在任何前端响应/日志**(脱敏校验)。
- AC6 子代理/后台档跟随所选连接(不串账号)。

---

## 12. 分阶段

| 阶段 | 范围 | 估算 |
|---|---|---|
| **v1(本期)** | 文件配置(跨连接/跨账号)+ 探活门控菜单 + 选择链路 + 按请求 workerEnv 路由(含 alias)+ 真 picker。store-only 选择。 | M |
| **v2** | `agent_session.model` 持久化 + per-message 模型记录;DB 化 registry + admin 增删/测试(照搬 Skills 目录)。 | M |
| **Phase 4** | 失败 failover/路由、per-capability key 进一步拆分、按能力门控、OpenAI-only 转译代理评估。 | M–L |

---

## 13. 待 Owner 确认的决策点

1. **不健康/非法 model 在发送时**:拒绝 + 报错(默认,推荐) vs 静默回退默认模型?
2. **不健康项在菜单**:置灰显示原因(默认) vs 直接隐藏(`hideUnhealthy`)?
3. **探活 TTL + 频率**(默认 5–10 min + 启动全量 + 手动重测)是否合适?
4. **配置文件落点**:Mac=`~/oxygenie-deploy/models.yaml`、容器=`/data/config/models.yaml` 挂载,确认?
5. **选择粒度**:每会话(store/持久到 session,推荐) vs 全局一个当前模型?
6. **探活方式**:直连 `/v1/messages`(默认,便宜) vs 额外用 SDK 跑极短 query(更真,更贵)?

---

## 14. 关联实现清单(v1,落地时展开)

- `models.example.yaml`(新,仓库内模板) + `MODELS_CONFIG_PATH` 约定。
- `src/config/model-registry.*`(新):加载/校验 YAML + 解析 env + registry + `resolveModel(id)` + `getSelectableModels()`。
- 探活模块(新,服务端):`probeModel()` + TTL 缓存 + 周期/手动重测。
- `ws-server.mjs` `handleChat`:接收 + 校验 `model`、构造按请求 `workerEnv`(baseURL/auth/model/alias)。
- `ws-query-worker.mjs`:确认解析后的 model 入 `query()`。
- `src/claude/adapters/ws-adapter.ts`:`chat` 增 `model?`、发送时带上;一个 `listModels`/`probeStatus` 通道(server fn 或 WS)。
- `src/lib/chat-session-store.ts`:`selectedModelId` + setter。
- `src/components/claude-chat/chat-composer.tsx`:死徽章 → 分组下拉(health 圆点、禁用态)。
- (可选)`agent_session.model` 列 + 迁移(可留 v2)。
