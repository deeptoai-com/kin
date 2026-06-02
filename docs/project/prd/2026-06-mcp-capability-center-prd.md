# PRD：MCP 管理（统一能力中心 · MCP tab）

> 日期：2026-06-02 ｜ 状态：草案待评审 ｜ Owner 决策依赖见 §11
> 关联：`docs/project/research/2026-06-skills-existing-architecture-and-redesign.md`（§九 SDK 升级影响）、`2026-06-mcp-skills-reference-survey.md`（参考产品）、`DESIGN-SYSTEM.md`（视觉/组件宪法）
> 一句话：**MCP 已建了约 70%（文件系统版），本 PRD 不是从零做，而是「收口到统一能力中心 + 接入 SDK 运行时状态 + DB 编目 + 补安全」。**

---

## 1. 背景与现状盘点（重要：不是 greenfield）

CLAUDE.md 写「MCP 当前状态：未配置」已**过时**。实际已存在一套**基于文件系统**的 MCP 子系统（与 Skills 同构）：

**已建（可复用）**
- **Store**：`src/mcp-store/<slug>/MCP.md`（YAML frontmatter + 正文），已内置 7 个：python / glm-image / markitdown-mcp / zhipu-search/vision/reader/zread。
- **三层来源（scope）**：`official`（源码）/ `system`（管理员全局，`_system/mcp/`）/ `user`（个人 `~/.claude/mcp/custom/`）——对齐 LibreChat 三层模型。
- **类型**：`McpConfig.type ∈ {sdk, stdio, sse, http}`（`src/claude/mcp/types.ts`）。
- **每用户状态**：`~/.claude/mcp/`：`enabled.json`（启用列表）、`credentials.json`（**明文**密钥）、`overrides.json`（per-MCP allowedTools 覆盖）。
- **env 模板**：`${VAR}` 解析，优先级 用户凭证 > `envFallback`(process.env) > 空（`resolveEnvTemplate`）。
- **运行时接线**：`resolveMcpServerConfigs({userId, userHome, sdkServers})` → `{mcpServers, allowedTools}`，在 `ws-query-worker.mjs` query() 启动时**一次性静态构建**；并与内置 SDK servers（python / glm-image / bash「沙盒就绪才挂」）合并。
- **Server Functions**：`src/server/function/mcp.server.ts`（list/enable/disable/detail/verify/addCustom/delete/credentials/toolOverride/**getMcpTools 实时工具发现**/fetchFromUrl/parseNpm…）。
- **前端**：独立页 `/agents/mcp`（`mcp-page` + grid/card/list-item/detail-dialog/add-custom-dialog/sidebar）。详情弹窗有 About / Configure（凭证表单 + allowedTools 勾选）/ Tools（实时发现）三 tab；添加支持 手填 / URL / npm / JSON-YAML 四种来源。

**未建 / 缺口（本 PRD 要补）**
1. **收口到统一能力中心**：现在是独立页，需并入「能力中心」的 MCP tab（已拍板：技能/MCP/已安装 分 tab）。
2. **SDK 运行时状态/管理未接**：未用 0.2.112 的 `mcpServerStatus()` / `toggleMcpServer()` / `reconnectMcpServer()` / `setMcpServers()` —— 当前只有「启用/禁用」静态态，没有「连接中/已连/错误」实时态、不能热重连。
3. **DB 编目缺失**：全文件系统，无法搜索/分页/审计；与「DB 编目」决策不符。
4. **安全缺口（P0，见 §8）**：**任意用户可注册任意 `stdio` 命令 → 多租户下等于 RCE**；凭证明文；URL 无 SSRF 校验；env 变量名无白名单。

---

## 2. 目标 / 非目标

**目标**
- G1 把 MCP 收口进**统一能力中心**的 MCP tab，与 Skills 一致的发现/管理体验。
- G2 接入 **SDK 0.2.112 运行时 API**：实时**状态徽章**（connecting/active/error/disabled）+ **热启停/重连**，不必重发对话。
- G3 **堵住 stdio RCE / SSRF / 明文凭证**等安全缺口（多租户安全基线）。
- G4 **DB 编目**：MCP 元数据 + 启用态 + 凭证（加密）+ 工具策略迁入 DB；FS 作为运行时投影。
- G5 保留并规范现有能力：三层 scope、env 模板、per-tool allowedTools、实时工具发现、自定义 MCP CRUD。

**非目标（本期不做）**
- 公开**市场/评分/作者/付费**（lobe/Coze 式）——后续，先用「搜索 + 分类 + 启用」。
- **审批工作流**（system MCP 上架审批）——后续。
- **0.3.x 专属**：后台连接默认（`status:'pending'`）、`reloadSkills` —— 被 ARK 天花板挡住（见架构文档 §九），不在本期。
- 凭证**轮换/过期/HSM**——本期只做「加密存储 + UI 脱敏」，轮换后置。

---

## 3. 关键决策（与既有决策对齐）

| # | 决策 | 依据 |
|---|------|------|
| D1 | MCP 与 Skills **统一发现/UI 层（分 tab），但运行时模型分离** | Owner 拍板「统一能力中心」；SDK 证实：MCP=SDK 托管连接，Skills=FS 扫描（架构文档 §9.3/§9.5） |
| D2 | MCP **运行时连接交给 SDK 托管**，我们只做 UI/配置/DB/安全；用 `mcpServerStatus`/`toggle`/`reconnect` | 0.2.112 已含完整运行时 API（架构文档 §9.3） |
| D3 | **DB = 真相**（编目/启用/凭证密文/工具策略）；**FS = 运行时投影**（`resolveMcpServerConfigs` 从 DB 读，必要时物化） | 「DB 编目」决策；与 Skills 投影模型一致 |
| D4 | **stdio 默认仅 `system`/admin scope**；普通用户只能加 `http/sse` 远程服务器（多租户安全默认） | §8 安全；可由部署开关放宽（见 §11 开放问题） |
| D5 | 凭证**加密存储**（不再明文 JSON），UI 按 `sensitive` 脱敏 | §8 安全 |

---

## 4. 用户故事

- US1 作为用户，我在「能力中心 → MCP」看到官方/系统/我的 MCP，可搜索、按分类筛选、看每个的**实时连接状态**。
- US2 我能一键**启用/禁用**某 MCP，并**立即生效**（热 toggle，不必重开对话）；失败时能**重连**并看到错误原因。
- US3 我能为需要密钥的 MCP **填凭证**（密码框脱敏），并**勾选允许哪些工具**（per-tool 策略）。
- US4 我能添加**远程（http/sse）自定义 MCP**（手填 / URL / JSON-YAML）；URL 经安全校验。
- US5 作为管理员，我能添加 **system scope** 的 MCP（含 stdio）供全员使用。
- US6 我能在详情里看到该 MCP **实时发现的工具列表**与说明。

## 5. 信息架构 / UX（MCP tab）

- 入口：能力中心顶部 tab `技能 | MCP | 已安装`；MCP tab 复用现有 `mcp-page` 组件，迁移其布局进 tab 容器。
- 列表：卡片（icon / name / 分类 / 来源徽章 official|system|user / **状态徽章** / 启用开关 / ⋮）。分组「已启用 / 推荐」。搜索 + 分类筛选。
- **状态徽章**（仿 LibreChat 彩色 pill，用语义 token）：`active=success` / `connecting=primary` / `error=destructive` / `disabled=muted`。
- 详情弹窗（沿用 About / Configure / Tools 三 tab）：
  - About：MCP.md 正文 + 配置 JSON（脱敏）；
  - Configure：凭证表单（`sensitive` 用密码框 + 「显示」切换）+ allowedTools 勾选；含**重连/测试连接**按钮（`verifyMcpServerFn` → 升级为 `reconnectMcpServer` + `mcpServerStatus`）；
  - Tools：实时发现的工具表（`getMcpTools`），标注被 allowedTools 过滤掉的项。
- 添加自定义：保留 手填 / URL / JSON-YAML；**stdio 选项按 scope/部署策略灰显或限管理员**（见 D4/§8）；npm 来源（产出 `npx` stdio）同样受 stdio 策略约束。
- 调用：composer「/」引用沿用现状（本 PRD 不改 composer）。

## 6. 数据模型（DB 编目 + FS 投影）

新增 Drizzle 表（命名贴合现有 schema 习惯，最终以实现为准）：

```text
mcp_catalog            -- MCP 定义（official 由 seeder 灌入；system/user 来自添加）
  id, slug, name, description, category, icon_url,
  scope            enum('official','system','user'),
  owner_user_id    nullable（user scope 才有；system/official 为空）,
  config_json      jsonb  -- McpConfig（type/command/args/env(模板)/url/headers）
  credential_defs  jsonb  -- CredentialField[]
  allowed_tools    jsonb  -- string[] | null（定义级默认）
  default_enabled  bool,
  source           enum('builtin','system','user','url','npm'),
  content_hash     text,  created_at, updated_at
  UNIQUE(scope, owner_user_id, slug)

mcp_enablement         -- 谁启用了哪个
  user_id, mcp_id, enabled bool, updated_at   PK(user_id, mcp_id)

mcp_credential         -- 每用户每 MCP 的密钥（加密）
  user_id, mcp_id, key, value_encrypted, updated_at   PK(user_id, mcp_id, key)

mcp_tool_override      -- 每用户每 MCP 的 allowedTools 覆盖
  user_id, mcp_id, allowed_tools jsonb, updated_at   PK(user_id, mcp_id)
```

- **凭证加密**：`value_encrypted` 用对称加密（密钥来自 env `MCP_CRED_ENC_KEY`，仅服务端）。读出时在 `resolveMcpServerConfigs` 内解密注入，**绝不下发到前端明文**（前端只拿「已配置/未配置 + 脱敏掩码」）。
- **运行时投影**：`resolveMcpServerConfigs` 改为**从 DB 读取**（catalog + enablement + 解密 credential + override），再做 `${VAR}` 模板解析，产出 `{mcpServers, allowedTools}`。内置 SDK servers（python/glm-image/bash）逻辑不变。
- **迁移脚本**：现有 `src/mcp-store/*`（official）→ seeder 灌 `mcp_catalog`；`~/.claude/mcp/{enabled,credentials,overrides}.json` + `custom/*` → 对应表（凭证加密导入）。迁移期 DB 缺失时回落读 FS，保证不中断。

## 7. 架构 / 运行时接线

```
能力中心(MCP tab) ──server fn── mcp.server.ts ──┐
                                                │ 读/写
                                          DB (catalog/enablement/cred/override)
                                                │
ws-query-worker：resolveMcpServerConfigs(DB) → {mcpServers, allowedTools}
   └─ query({ mcpServers, allowedTools, ... })           ← 启动时静态构建（保留）
   └─ 运行时：mcpServerStatus()/toggleMcpServer()/reconnectMcpServer()  ← 新增（G2）
        └─ 状态经 WS 事件回传前端 → 状态徽章 / 重连按钮
```

- **静态构建保留**：会话启动时仍用 `resolveMcpServerConfigs` 给 query() 初始 `mcpServers`。
- **运行时管理新增**：在 worker 暴露控制通道，把 `mcpServerStatus()` 周期/事件态经 ws-server 回传前端；前端 toggle/重连 → 调 `toggleMcpServer`/`reconnectMcpServer`。（注意：0.2.112 无「后台连接默认」，需我们驱动状态查询。）
- `allowedTools` 门控：现状是传给 SDK；本期补充「Tools tab 标注被过滤项」，并确认 SDK 侧确实按 allowedTools 限制（验收项）。

## 8. 安全设计（P0，本 PRD 的重头）

| 风险 | 现状 | 处置 |
|------|------|------|
| **stdio 任意命令执行（RCE）** | 任意用户可加 `{type:'stdio',command,args}` 无校验，多租户=RCE | **默认仅 system/admin scope 允许 stdio**；普通用户只能 http/sse。部署开关 `MCP_ALLOW_USER_STDIO`（默认 false）。stdio 命令走**允许列表**（`npx`/`uvx`/`python` 等）+ 在沙盒内执行（复用 per-session sandbox / bash-sandbox 能力） |
| **SSRF（http/sse URL）** | `url` 无 scheme/目标校验，可打内网/元数据 | URL 校验：仅 `https?:`；**拒绝私网/环回/`169.254.169.254`/`*.internal`**；禁跨主机重定向；可选出站允许域名表 |
| **凭证明文** | `credentials.json` 明文 | DB 加密存储（D5）；前端只见掩码；日志脱敏 |
| **env 变量名无白名单** | 用户可注入/覆盖任意 env（如 `ANTHROPIC_API_KEY`） | env **键名白名单 / 前缀约束**；禁止覆盖 `ANTHROPIC_*`/`PATH`/`HOME` 等敏感键 |
| **工具门控** | allowedTools 传给 SDK，未验证强制 | 验收：确认 SDK 按 allowedTools 拒未授权工具；UI 标注被过滤项 |
| **审计** | 无 | 记录 enable/disable/cred 变更/stdio 注册（最小审计；完整审计后置） |

## 9. 分期

- **P0（安全 + 收口）**：①stdio scope 限制 + 命令允许列表 + 沙盒；②URL SSRF 校验；③env 白名单；④凭证加密（DB 或先加密文件）；⑤MCP 收口进能力中心 MCP tab。**这一期不依赖上游任何东西，且解除多租户上线的安全阻塞。**
- **P1（SDK 运行时状态）**：接 `mcpServerStatus`/`toggle`/`reconnect`，状态徽章 + 热启停 + 重连 + 错误展示。
- **P2（DB 编目）**：catalog/enablement/cred/override 迁入 DB + seeder + 迁移脚本；`resolveMcpServerConfigs` 改读 DB。
- **P3（可选/后续）**：市场/评分、审批工作流、凭证轮换、出站域名策略中心化。

> 备注：P0 安全是**上线前阻塞项**（多租户）。若当前仅自托管单租户，可调整优先级（见 §11）。

## 10. 验收标准 / 成功指标

- 功能：能力中心 MCP tab 可列表/搜索/启用/禁用/配置凭证/勾选工具/查看实时工具；状态徽章随真实连接态变化；启停热生效。
- 安全：普通用户**无法**注册 stdio（除非部署开关开启）；http/sse URL 私网/元数据被拒；凭证落库密文、前端无明文；敏感 env 键被拒。
- 兼容：现有 7 个官方 MCP + 已启用用户配置**零丢失**迁移；内置 SDK servers（python/glm-image/bash）行为不变。
- 质量门：lint 0 error、unit 通过、build 通过、ARK 上 chat + MCP 调用端到端正常。

## 11. 开放问题（需 Owner 拍板）

1. **租户模型**：OxyGenie 是**多租户托管（含不可信用户）**还是**自托管单组织**？→ 直接决定 stdio 默认策略（D4）。默认按「多租户」从严；若自托管可放宽 `MCP_ALLOW_USER_STDIO=true`。
2. **凭证加密载体**：先做「加密文件」还是直接「DB 密文」？（影响 P0 与 P2 的边界）
3. **stdio 沙盒**：复用现有 per-session sandbox / bash-sandbox 执行 stdio MCP，还是先仅限 system scope 不沙盒？
4. **MCP tab 与现有 `/agents/mcp` 路由**：tab 内嵌后，旧路由保留重定向还是下线？

## 12. 现有代码改动清单（复用 vs 改）

- **复用**：`types.ts`、`metadata.js`、`mcp-store/*`、`mcp-page`/卡片/详情/添加 等组件、`getMcpTools` 实时发现、`resolveEnvTemplate`、scope 模型。
- **改**：
  - `mcp.server.ts`：加 stdio scope/命令校验、URL SSRF 校验、env 白名单；凭证读写改加密；（P2）改读 DB。
  - `manager.js`：`resolveMcpServerConfigs` 数据源 FS→DB（P2）；凭证解密注入。
  - `ws-query-worker.mjs` / `ws-server.mjs`：新增运行时状态通道（`mcpServerStatus`/`toggle`/`reconnect`）（P1）。
  - 能力中心容器：把 `mcp-page` 收进 MCP tab（P0）。
  - `add-custom-mcp-dialog.tsx`：stdio 按策略灰显/限管理员（P0）。
  - 新增：DB schema + seeder + 迁移脚本（P2）。
- **不改**：composer 调用方式、内置 SDK servers 实现。
