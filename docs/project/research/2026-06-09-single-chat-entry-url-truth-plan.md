# 单一聊天入口 + URL 即真相 — 重构方案（Phase 2）

> 状态：**草案，待 Codex 审核**。日期：2026-06-09。
> 关联：`2026-06-09-projects-chat-nav-unification-plan.md`（Phase 1，已实施）。
> 这是 Phase 1 的**补完**，不是重写——Phase 1 已建好 `c/$sessionId` 路由、URL bootstrap、
> `ClaudeChatController` 参数化。本阶段把"URL 即真相"补到位，并**删除 `/agents/claude-chat`**。

---

## 0. TL;DR（Owner 定调）
- **只有一个聊天入口**；`/agents/claude-chat` 删除。
- 单聊 / 项目内聊天**同一个面**，靠 **URL 路径明确区分**。
- **每个会话都有 URL**；不再有"store 记着的、地址栏没 URL 的当前会话"。
- **URL 是唯一真相**，`chat-session-store` 退居"运行时缓存"（由 URL 派生，不再决定显示哪个会话）。

## 1. 现状的病灶（为什么要做）
- `/agents/`（index）`beforeLoad` 重定向到 `/agents/claude-chat`（**store 驱动、默认无 session URL**）。
- `/agents/claude-chat` 与 `/agents/projects` 是**两套并行的面**；claude-chat 的"当前会话"靠
  `getSessionId()`(store) 在 mount 时恢复，**地址栏不带 sessionId**。
- 由此衍生：新建跳 loose、无 URL 会话不可深链/分享、store↔URL 易脱节、刷新/崩溃后状态错乱。

## 2. 终态路由树
```
/agents (route.tsx)                         AppSidebar 图标全局导航（不变）
├── /agents/  (index)                       → 重定向到聊天工作区首页（不再去 claude-chat）
├── 〈聊天工作区，共用 ChatNav/ProjectsRail 富侧栏〉
│   ├── /agents/c/$sessionId                单聊（每条都有 URL）        ← 新增
│   ├── /agents/c              (index)       新单聊落点（创建后 → /c/$新id）← 新增
│   └── /agents/projects/$projectId         项目主页（已存在）
│       ├── /agents/projects/$projectId/c/$sessionId   项目内聊天（已存在）
│       └── /agents/projects/$projectId/c             项目内新建（已存在）
├── /agents/projects/ (index)               工作区首页：最近(loose) + 项目列表 + 新建
└── /agents/claude-chat                     ❌ 删除（最后一步；先 301→/agents/c 一个发布周期再删文件）
其余 /agents/{capabilities,documents,charts,mcp,skills,settings,billing} 不变。
```
> 侧栏归属：单聊 `/agents/c/*` 与项目 `/agents/projects/*` 需**共用同一富侧栏**。两条实现路（见 §6-Q1）：
> (a) 提一个聊天工作区**共享 layout** 包住两者；(b) **组件复用**——两处各渲染同一个 `ChatNav`。

## 3. 核心机制变化（URL 即真相）
**现状（hybrid）**：`currentSessionId`(React state) + store `sessionId` 是运行时真相；mount 时从
`getSessionId()` 恢复；URL `?session=` 只是 bootstrap 输入。

**终态（URL 真相）**：
- 控制器的"当前会话" = **URL 参数**（`/c/$sessionId` 或 `…/c/$sessionId`）。
- **删除 store 驱动的 mount-resume 默认路径**（`getSessionId()` 恢复上次会话）——
  无 URL session = "新建落点"(`/c` index)，而不是"恢复上次"。
- `onSessionInit(newId)` → `navigate` 到对应 URL（Phase 1 已做）→ 控制器从 URL 重新派生。
- store `sessionId` 变成**由 URL 派生写入**的缓存（供 WS adapter / resume 用），不再被 mount 读来决定显示谁。
- `reconnection-recovery` / `chatKey` 仍以"当前会话"为准，但当前会话**来自 URL**。

> 关键删除点：`claude-chat/route.tsx` 的 mount-resume effect 里 `const sessionId = getSessionId(); if (sessionId) resume…`
> 这一段（store 默认恢复）退役。Phase 1 已加的 `if (urlSessionId) return` 守卫，会演进成"无 urlSessionId 就不恢复、走新建"。

## 4. Phase 1 已具备（这是补完不是重写）
- ✅ `ClaudeChatController({permissionInfo, urlSessionId, projectId, showInternalSessionList})` 已参数化、可复用。
- ✅ URL bootstrap effect（`urlSessionId` 驱动 + ref/store 守卫，Codex 审过）。
- ✅ `onSessionInit` → navigate 镜像 URL（项目/ loose 两路）。
- ✅ 项目 `c/$sessionId`、`c`(新建) 路由 + 深链。
- ✅ `createSession(urlProjectId ?? pendingProjectId)` 创建时绑定。
**补完的 delta**：单聊 `/agents/c/*` 路由、默认落点改造、删 store-default-resume、删 claude-chat。

## 5. 迁移步骤（增量，claude-chat 最后删）
1. **加单聊路由** `/agents/c/$sessionId` + `/agents/c`(新建)，渲染 `ClaudeChatController`（urlSessionId、无 projectId、关内部 SessionList、带富侧栏）。镜像项目 `c` 那套（Codex 已审过的模式）。低风险。
2. **侧栏共用**：按 §6-Q1 选 (a)/(b) 让单聊与项目共用一个富侧栏。
3. **默认落点改造**：`/agents/` 不再 →claude-chat；→ 聊天工作区首页（最近+项目+新建）。"新建单聊"按钮 → `/agents/c`。
4. **删 store-default-resume**：把 mount-resume 的 `getSessionId()` 恢复退役；无 URL session = 新建落点。**最危险一步（§6-Q2）。**
5. **所有 loose 入口改 URL**：ProjectsRail「新建/最近」、SessionList 等都指向 `/agents/c[/ $id]`。
6. **`/agents/claude-chat` 退役**：先 `beforeLoad` 301 → `/agents/c`（保书签/回归），一个周期后删文件。**最后一步。**
7. 重命名（Owner 说"改名字"）：富侧栏/工作区文案与路由命名收口（如 ProjectsRail→ChatNav）。

## 6. 给 Codex 的裁定（Review Asks）
- **Q1（侧栏共用）**：单聊 `/agents/c/*` 与项目 `/agents/projects/*` 共用富侧栏，用**共享 layout**(提一层包住两者，可能要动 `/agents` 路由树) 还是 **组件复用**(两 layout 各渲染 ChatNav，不重排树)？哪个更稳、更合 TanStack？
- **Q2（删 store-default-resume 的风险）**：去掉"mount 时从 store 恢复上次会话"后——
  - "无 URL session = 新建" 会不会破坏：返回/前进、刷新某 `/c/$id`、reconnection-recovery、`chatKey`、artifact hydrate？
  - 老用户 localStorage 里残留的 sessionId 怎么处理（忽略？一次性迁移成 `/c/$id`？）
  - 这一步要不要**单独成一个可回滚的提交**，前面 1–3 先上、4 单独验？
- **Q3（默认落点）**：`/agents/` 重定向到"工作区首页"还是"直接开一个新单聊 `/agents/c`"？ChatGPT 是开新聊天页。哪个更顺？
- **Q4（claude-chat 退役方式）**：先 301 一个周期再删，还是直接删 + 全量改跳转？有没有外部书签/深链依赖 `/agents/claude-chat` 的？
- **Q5（"每个会话都有 URL"的边界）**：分支 D2、resume、reconnect 后是否都保证地址栏有 `…/c/$id`？有没有还会落到"无 URL"状态的路径？
- **Q6（命名）**：富侧栏/路由要不要从 "projects" 收口成 "chat 工作区"语义？范围多大（仅文案 vs 路由段重命名）？

## 7. 兼容/回归 checklist
- [ ] 单聊：开/刷新/分享 `/agents/c/$id` 都直达；新建 → `/agents/c/$新id`。
- [ ] 项目：Phase 1 那套全不回归（深链、分支、L7/L8 发起人/逐条头像）。
- [ ] 无 URL session 的旧路径全部消除（搜 `getSessionId()` 的恢复用法）。
- [ ] `/agents/claude-chat` 退役不破坏任何跳转；301 期内可访问。
- [ ] reconnection / 崩溃后：URL 仍是真相，刷新即恢复正确会话。
- [ ] i18n / feature flag / typecheck / lint / 单测 不回归。
- [ ] 不碰后端/WS/worker/分支链路；单一 SDK；ARK 0.2.112。

---
### 附：给 Codex 的一句话
这是 Phase 1 没做的"URL 即真相 + 单入口"补完，**删 `/agents/claude-chat`**。最危险是 **Q2（退役 store-default-resume）**——
请重点判它的风险与是否单独成可回滚提交。Q1（侧栏共用方式）次之。其余给个倾向即可。
