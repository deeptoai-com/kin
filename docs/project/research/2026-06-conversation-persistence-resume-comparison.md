# 会话历史持久化 / 恢复：三家 Agent core 对比 + 我们的修复方向

> 日期：2026-06-02 ｜ 类型：研究 / 设计 note（缺陷分析 + 跨框架对比）
> 触发：本地发现 bug —— 在某对话里聊完，切到别的页面再回到聊天，**历史无法加载，呈现空白页**。
> 关联：`VISION.md`（产品定位：私有部署/Web 多用户）、`docs/project/prd/2026-06-mcp-capability-center-prd.md`（DB 编目方向）。

---

## 1. 缺陷本身（已用真机 + 服务器日志确认）

**症状**：返回某对话 → 主区域空白（"Start a conversation"），但侧栏仍高亮该会话、右下显示 `Session · <id>`（即"已选中但没内容"）。

**两层机制**：
1. **可见对话 = assistant-ui 的 thread runtime**（`src/components/claude-chat/chat-composer.tsx:182` 的 `useThread`），它**临时、随路由组件 remount 而清空**。离开聊天页再回来 → 组件 unmount→remount → thread 空 → 设计上**应靠 resume 重新拉回历史**。
2. **真正的 bug：resume 找不到 transcript**。服务器日志：
   ```
   [WS Server] Resuming session: c53c3ead-… -> SDK: a551fc7b-…
   [WS Server] Session file not found for: a551fc7b-…
   ```

**根因（精确）**：
- ws-server 在 `<claudeHome>/.claude/projects/*/<sdkSessionId>.jsonl` 查找（`ws-server.mjs:430/446/513`）。
- 但 transcript **真实存在**于**会话 workspace 内层**：`…/sessions/<id>/workspace/user-data/<user>/.claude/projects/<cwd-slug>/<sdkSessionId>.jsonl`。
- 因为 **`CLAUDE_SESSIONS_ROOT="./user-data"` 是相对路径**（`.env`），且 DB 里 `claude_home_path` 也存成相对（`user-data/<user>`），于是：
  - **worker** 进程 cwd = 会话 workspace（`ws-server.mjs:897` `WORKER_CWD=workspacePath`）→ SDK 把相对的 claudeHome 解析到 `workspace/user-data/<user>/.claude/…`（内层）；
  - **ws-server** 进程 cwd = 仓库根 → 在 `仓库根/user-data/<user>/.claude/…` 找 → **两个绝对位置永远对不上** → not found。

**归因**：**不是 UI/能力中心/SDK-pin 等本轮改动造成**（出问题的 transcript mtime 早于这些改动；这些改动不碰会话路径）。这是**相对路径 + 不同进程 cwd** 的老问题，**几乎只在本地 dev 暴露**（生产/Docker 用绝对的 `CLAUDE_SESSIONS_ROOT=/data/users`，worker 和 server 解析一致 → resume 正常）。

---

## 2. 关键架构前提：我们是"每对话一个 workspace"

确认（`ws-server.mjs:564-569`）：
```js
// Structure: /data/users/{userId}/sessions/{sessionId}/workspace/
function getSessionWorkspace(userId, sessionId) {
  return path.join(SESSIONS_ROOT, safeUserId, 'sessions', safeSessionId, 'workspace');
}
```
**每开一个对话 = 一个独立 workspace**，worker 以它为 cwd。这对**Web 多用户 + 私有部署**是对的（不可能让所有用户共享一个固定文件夹）。代价：**每个会话有各自的 cwd**，因此"会话目录"必须以**绝对路径持久化并一致复用**——这正是我们漏掉的（存了相对路径）。

---

## 3. 三家对比

| | 内核 | 历史存哪 | 按什么键恢复 | 依赖 cwd/路径? | 会中我们这个招吗 |
|---|---|---|---|---|---|
| **deer-flow (LangGraph)** | LangGraph 图 | **Checkpointer**（InMemory/SQLite/**Postgres**）+ 独立 event store | **`thread_id`**（DB 行 / 内存字典） | ❌ 完全无关 | **不会，结构免疫** |
| **CraftAgent** | **同款 Claude Agent SDK**（0.2.123） | 自维护 `…/sessions/{id}/session.jsonl`（真相源）+ SDK 自己的 `~/.claude/projects/<cwd-hash>/` | 自己的会话文件 + **绝对 `sdkCwd`** 显式传给 `query({cwd})` | ⚠️ 有，但已用绝对路径 + 校验兜住 | **不会，工程上绕开** |
| **OxyGenie（现状）** | Claude Agent SDK（0.2.112） | **只靠 SDK 的 transcript**（无自有消息存储） | resume → SDK 读 cwd 派生的 transcript | ❗**相对路径 + 双 cwd → 对不上** | **会（已发生）** |

### 3.1 LangGraph / deer-flow —— 历史不落在 cwd 路径上
- 用 LangGraph **checkpointer**，状态按 **`thread_id`** 存 DB；消息单独 event store（也按 thread_id）。
- 恢复 = `checkpointer.aget_tuple({"configurable":{"thread_id": …}})`，**纯 DB 按 id 查，与进程 cwd 无关**；SQLite 连接串启动时解析一次后复用。
- 文件：`backend/packages/harness/deerflow/runtime/checkpointer/async_provider.py`、`backend/app/gateway/routers/threads.py`。

### 3.2 CraftAgent —— 同一个 SDK，但靠两件事兜住（且有"本地固定文件夹"这个天然锚点）
- `package.json` 用 `@anthropic-ai/claude-agent-sdk`，底层同样有 `~/.claude/projects/<cwd-hash>/<session>.jsonl`。它没踩坑，因为：
  1. **自己维护一份 `session.jsonl`** 作为 UI 历史的真相源（`packages/shared/src/sessions/storage.ts`），不依赖 SDK transcript 能否被找到；
  2. **把 `sdkCwd` 以绝对路径存进会话头**，resume 时**显式**传给 `query({ cwd })`（`claude-agent.ts:1010`）；spawn 前校验目录存在，否则 fallback 恢复；用 `{{SESSION_PATH}}` 可移植 token 跨机。
- **重要差异（owner 指出）**：CraftAgent 是**本地客户端**，会**让用户选一个固定文件夹**作为工作目录 → 它的 cwd 是**单一、稳定的绝对路径**，"SDK 按 cwd 派生 transcript"这套天然稳。**我们没有这个锚点**——我们是 Web、多用户、**每对话一个临时 workspace**，cwd 因会话而异。所以 CraftAgent"免费"得到的稳定性，我们必须**自己工程化**：把每个会话的 workspace 以绝对路径持久化并一致复用（等价于 CraftAgent 存绝对 `sdkCwd`）。

---

## 4. 为什么偏偏我们中招（小结）
- 我们**没有自有消息真相源**——UI 历史完全靠"resume → SDK transcript → messages_loaded"。
- 会话路径用了**相对** `CLAUDE_SESSIONS_ROOT="./user-data"` → worker（cwd=workspace）与 ws-server（cwd=仓库根）解析到**不同绝对位置**。
- 没有 spawn 前校验 / fallback → 找不到就直接空白。
- 同款 SDK 的 CraftAgent 没事，证明**这不是 Claude Agent SDK 的锅，是我们集成方式的锅**。

---

## 5. 修复方向（两级）

### 治标（立即；主要修本地 dev）—— 路径绝对化
- `resolveSessionsRoot()`（`ws-server.mjs:79`）对 env 值 `path.resolve(...)` 成绝对路径；落库的 `claude_home_path` / workspace 一律存**绝对路径**；resume 时 worker 与 server 解析一致。
- 等价于 CraftAgent 的"存绝对 sdkCwd"。生产 `/data/users` 已是绝对，所以这主要修本地；但绝对化能**根治这一类 cwd 错配**。
- 注意：已存在的那条相对/内层 transcript 会"孤儿化"，需迁移或放弃旧记录（本地无所谓）。

### 治本（排进 Skills/MCP 之后）—— 自有消息存储（LangGraph 原则 + CraftAgent 实践）
- **把对话消息存进我们自己的 Postgres**（本来就有 DB），作为 **UI 历史的真相源**：历史重载 = **按 session id 查 DB**，与 cwd 完全无关（= LangGraph 的"按 thread_id 查"）。
- SDK transcript 退化为"仅 SDK resume 的输入"，再配**绝对 cwd + spawn 前校验 + fallback**（= CraftAgent 实践）。
- 与 PRD 的"DB 编目/DB 为真相、FS 为投影"方向一致：**会话/消息也应 DB 为真相**。
- 额外韧性：remount 后即使 SDK resume 出问题，UI 也能先从 DB 渲染历史，不再空白。

---

## 6. 一句话
- **LangGraph**：把历史按 id 存 DB → 天生没这问题。
- **CraftAgent**：同款 SDK，但有"本地固定文件夹"锚点 + 自有 jsonl + 绝对 sdkCwd → 工程上绕开。
- **OxyGenie**：Web 多用户、每对话临时 workspace，又把会话路径用了相对 + 只靠 SDK transcript → 中招。**修法 = 路径绝对化（治标）+ 自有 DB 消息存储（治本）。**
