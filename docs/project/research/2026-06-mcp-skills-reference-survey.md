# MCP & Skills 管理：参考产品调研（为后续功能预研）

> 日期：2026-06-02
> 目的：在我们着手做 **MCP 管理** 与 **Skills 管理** 之前，先调研 references 下成熟产品的实现（UI/UX + 数据模型 + 接线方式），沉淀可借鉴模式。
> 状态：调研笔记（非实施计划）。具体落地以 PRD/任务指派为准。
> 我们的技术栈：TanStack Start + React + Assistant-UI + shadcn/Radix + Tailwind v4。

---

## 一、MCP（Model Context Protocol）服务器管理

### 参考产品概览

| 维度 | LibreChat | Lobe-Chat | claude-agent-kit | claudecodeui |
|------|-----------|-----------|------------------|--------------|
| 主用途 | 聊天 + 工具执行 | 市场/发现 | Agent SDK | 编辑器集成 |
| UI 形态 | 弹窗式配置 | 市场浏览 | 侧栏面板 | provider 抽象 |
| 配置存储 | DB（经 API） | 本地 FS + 协议 URL | `.mcp.json` | `.mcp.json` + env |
| 传输支持 | stdio / SSE / WS / HTTP | stdio / HTTP | stdio / SSE / HTTP | stdio / HTTP / SSE |
| OAuth | ✅ 完整流程 | ❌（仅安装） | ❌ | ❌ |
| 状态管理 | Jotai + React Query | SWR + Zustand | — | — |
| 市场 | ❌ | ✅（LobeHub） | ❌ | ❌ |
| 依赖检查 | ❌ | ✅ | ❌ | ❌ |
| 状态轮询 | ✅（可配置） | ❌ | ❌ | ❌ |

### LibreChat —— 最完整的「聊天 + 工具执行」实现（与我们最贴近）

**UI（`client/src`）**
- `components/MCP/MCPConfigDialog.tsx` —— 配置弹窗，带状态徽章（connected / disconnected / connecting / error）+ OAuth 指示。
- `components/MCP/MCPServerStatusIcon.tsx` —— 连接状态图标。
- `components/MCP/CustomUserVarsSection.tsx` —— env 变量 / API key 表单。
- `components/MCP/ServerInitializationSection.tsx` —— 初始化/连接流程。
- `hooks/MCP/useMCPServerManager.ts` —— 核心编排 hook：OAuth 流程、轮询、服务器状态、取消。
- `store/mcp.ts` —— Jotai atoms + localStorage（每会话服务器选择 + 全局 pin）。
- `data-provider/mcp.ts` —— React Query（`useMCPToolsQuery`）。

**数据模型（`packages/api/src/mcp/types`）**
```ts
type MCPOptions = StdioOptions | WebSocketOptions | SSEOptions | StreamableHTTPOptions;
type StdioOptions = { command: string; args?: string[]; env?: Record<string,string> };
type SSE/StreamableHTTP = { url: string; headers?: Record<string,string> };
```
- 三层作用域：Shared App Servers（自启，全用户）/ Shared User Servers（按需，全用户）/ Private User Servers（每用户运行时添加）。

**接线（后端）**
- `mcp/MCPManager.ts`（单例，连接 + 工具执行）
- `mcp/MCPConnectionFactory.ts`（建连，可选 OAuth + 重试）
- `mcp/connection.ts`（EventEmitter 包装 `@modelcontextprotocol/sdk/client`，多传输）
- `mcp/registry/MCPServersRegistry.ts`（三级查找 app → user → private）
- `MCPOAuthHandler` + `OAuthReconnectionManager`（token 过期自动重连）

**值得抄的 UX**
- 彩色状态 pill（蓝=connecting / 橙=offline / 绿=active / 红=error）。
- env 模板回退语法 `${VAR_NAME:-default}`。
- 连接状态轮询（默认 5min TTL）。
- 每服务器 OAuth 状态 + 可取消。

### Lobe-Chat —— 市场/发现导向
- UI：`src/app/[variants]/(main)/discover/(list)/mcp/`（市场，分类/排序/分页）；`features/PluginDevModal/MCPManifestForm/`（快速导入）；`store/discover/slices/mcp/`（SWR）。
- 数据模型：`packages/types/src/plugins/protocol.ts` —— `McpStdioConfig{type:'stdio',command,args,env}` / `McpHttpConfig{type:'http',url,headers}`。
- 深链安装（RFC 0001）：`lobehub://plugin/install?id=...&schema=base64url(McpSchema)`。
- 多部署路径检测（uv / npx / 手动）+ 依赖检查向导。

### claude-agent-kit —— 极简、编程式（**后端强制参考项目**）
- `examples/claude-code-web/src/server/mcp-config.ts`：`LoadedMcpConfig{ mcpServers, allowedTools }`，从 `.mcp.json` 读取 + env 展开（`${ENV:-fallback}`）。
- `.../components/left-sidebar/capabilities-panel.tsx`：可折叠面板，按类型展示 capabilities，显示 MCP 服务器数 + 每服务器工具列表，刷新按钮，每工具可见性开关。

### claudecodeui —— 配置文件 provider 模型
- `server/modules/providers/list/claude/claude-mcp.provider.ts`：多作用域 `project(.mcp.json)` → `user(~/.claude.json)` → `local`，标准 JSON schema 读写 + upsert。

### → 对 OxyGenie 的启示（MCP）
1. UI：LibreChat 的「弹窗配置 + 状态徽章」最适合聊天类应用，生产级。
2. 数据模型：统一 **stdio / http 二分** + 可选 auth；与我们后端必须参考的 claude-agent-kit 的 `.mcp.json` 形态一致。
3. 存储：聊天应用 → 用户选择存 DB/localStorage（LibreChat）；开发工具 → JSON 配置文件（agent-kit / claudecodeui）。我们偏前者。
4. env 变量：支持 `${VAR:-default}` 模板展开。
5. 市场/发现：可选但有价值（Lobe 模型），一期可不做。
6. 状态：优先事件驱动，避免无谓轮询开销。

---

## 二、Skills / Capabilities 管理

> 我们当前的 "Skills" = 组合框上方的技能栏（内容创作 / 内容整理 / 设计与呈现 / 策略与研究），目标是做 skills-manager-panel。
> 参考产品里没有完全等价的 "Skill"，最接近的是 lobe-chat 的 **agent plugins** 与 open-webui 的 **functions/prompts**。

### Lobe-Chat —— Agent + 插件市场模型
- UI：`features/AgentSetting/AgentSettingsContent.tsx`（分页设置：Meta/Prompt/Plugin/TTS…）；`features/AgentSetting/AgentPlugin/index.tsx`（每插件 enable/disable 开关、列表 avatar/title/desc/tag、活跃 + 废弃双列表）；`features/PluginStore/`（市场，分段 MCP|Plugin|Installed，两栏：左列表可拖拽可搜索 + 右详情）。
- 数据模型：`packages/database/src/schemas/agent.ts` —— `agents.plugins: jsonb<string[]>`（agent 启用的插件 id 数组）；`packages/types/src/tool/index.ts` —— `LobeTool{ identifier, manifest?, runtimeType:'mcp'|'default'|'markdown'|'standalone', settings?, customParams?, source:'builtin'|'customPlugin'|'plugin' }`。
- 调用：`store/agent/slices/chat/action.ts` 的 `togglePlugin(id, open?)` —— 插件以 id 存进 agent config；开聊时由 `installedPlugins` + manifest 解析。
- 值得抄：分页设置降负荷；活跃+废弃双列表优雅处理 breaking change；市场「发现→安装→启用」闭环；安装进度条。

### Open-WebUI —— Functions + Prompts 作为可复用模板
- UI：`src/routes/(app)/admin/functions/+page.svelte` + `lib/components/admin/Functions.svelte`（列表：搜索、类型筛选、created-by-me/shared-with-me、is_active 开关、Edit/Delete/Export/Valves）；create/edit 页为代码优先表单；Prompts 用 slash-command（`/name`）。
- 数据模型：`backend/open_webui/models/functions.py` —— `Function{ id, user_id, name, type, content(代码), meta(JSON:{description,manifest}), valves(JSON 配置), is_active, is_global }`；`prompts.py` —— `Prompt{ command(PK), title, content, access_control }`。
- 调用：`getFunctions/getPrompts` 按需拉取；`toggleFunctionById` 翻转 is_active；prompt 以 command 引用。
- 值得抄：meta（描述/参数）与 content（实现）分离；**Valves 模式**（结构化配置参数渲染成 modal 表单）；JSON 导入导出共享；is_global 全局开关；access_control 公开/私有/分组。

### Skills 对比

| 维度 | Lobe-Chat（plugins） | Open-WebUI（functions/prompts） |
|------|----------------------|--------------------------------|
| 数据模型 | agent 持 `plugins: string[]` | Function/Prompt 表（name, content, meta, valves） |
| 主键 | plugin identifier | Function: id；Prompt: command |
| 元数据 | LobeChatPluginManifest | FunctionMeta（description, manifest） |
| 配置 | customParams + runtimeType | Valves（JSON → 表单） |
| 作用域 | 每 agent 分配 | 每用户全局 + is_active |
| 权限 | 继承 agent | 显式 public/private/group |
| 调用 | agent 解析 plugins → manifest | 按需拉取 + is_active |
| 发现 UI | 市场（MCP/Plugin/Installed 两栏详情） | admin 列表（搜索/筛选/类型） |

### → 对 OxyGenie 的启示（Skills）
建议的数据形态（草案）：
```ts
interface Skill {
  id: string;
  name: string;                 // "内容创作"
  description: string;
  category: 'content-creation' | 'content-curation' | 'design-presentation' | 'strategy-research';
  icon?: string;                // emoji / icon ref
  instructions: string;         // 注入 system prompt 的技能行为
  tools?: string[];             // 可选关联工具
  isActive: boolean;            // 每会话启停
  author?: string;              // builtin vs custom
  tags?: string[];
  createdAt: number;
}
```
- UI（推荐 Lobe 风格的混合）：技能栏快速 toggle；点「管理」打开 skills-manager-panel（卡片网格：icon/name/desc/toggle/edit/delete）；「添加」走市场或自定义表单。
- 存储：会话 config 存 `{ skillIds: string[] }`（仿 lobe agent.plugins）。
- 调用：开聊时把启用技能的 instructions 拼进 system prompt；支持每技能参数化（Valves 模式）。

---

## 三、关键文件路径速查（深挖入口）

**MCP**
- LibreChat 后端：`packages/api/src/mcp/MCPManager.ts`、`MCPConnectionFactory.ts`、`connection.ts`、`registry/MCPServersRegistry.ts`
- LibreChat 前端：`client/src/hooks/MCP/useMCPServerManager.ts`、`client/src/components/MCP/MCPConfigDialog.tsx`、`client/src/store/mcp.ts`
- Lobe 协议：`packages/types/src/plugins/protocol.ts`、`apps/desktop/src/main/controllers/McpInstallCtr.ts`
- claude-agent-kit：`examples/claude-code-web/src/server/mcp-config.ts`、`.../components/left-sidebar/capabilities-panel.tsx`
- claudecodeui：`server/modules/providers/list/claude/claude-mcp.provider.ts`

**Skills**
- Lobe：`packages/database/src/schemas/agent.ts`、`src/features/AgentSetting/AgentPlugin/index.tsx`、`src/features/PluginStore/`、`packages/types/src/tool/index.ts`、`src/store/tool/slices/plugin/initialState.ts`、`src/store/agent/slices/chat/action.ts`
- Open-WebUI：`backend/open_webui/models/functions.py`、`models/prompts.py`、`src/lib/components/admin/Functions.svelte`、`src/lib/apis/functions/index.ts`
