# Projects × Chat 导航统一方案（ChatGPT 模型）

> 状态：**草案，待 Codex 审核**。作者：Claude（实施侧）。日期：2026-06-09。
> 关联：`2026-06-08-branch-on-reply-execution-report.md`（续聊即分支后端）、
> `2026-06-08-branch-live-verification-guide.md`、Projects P1 全套（L1–L8 已落地）。

---

## 0. TL;DR

当前 **Projects 界面**（`/agents/projects`）和 **Chat 界面**（`/agents/claude-chat`）是
**两套并行的富侧栏 + 主区**，被导航硬拼在一起。Owner 反馈"感觉冲突"，且实测出三个症状：
**(1) 没法在项目里聊天**（点会话就跳出项目、上下文丢失）、**(2) 三个会话列表互相重叠**、
**(3) 项目内会话链接打不开**（深链不带 sessionId）。

目标：**对齐 ChatGPT —— 一个富侧栏从头到尾不变，主区按 URL 换内容，三种 URL 编码上下文。**
本方案给出路由树、`ChatNav` 组件、分两阶段的迁移步骤，并在 §9 列出**请 Codex 重点裁定的取舍**。

---

## 1. 现状（问题）

### 1.1 路由树
```
/agents (route.tsx)            布局①: AppSidebar(图标全局导航, collapsible=icon, defaultOpen=false) + SiteHeader
├── /agents/claude-chat        ← 真·聊天界面(独立)。内嵌自己的 SessionList 侧栏 + 聊天线程
├── /agents/projects (route.tsx)  布局②: ProjectsRail(项目+最近) + <Outlet>
│   ├── /                      ProjectsIndex(占位"选个项目")
│   └── /$projectId            ProjectHome(聊天列表 tab / 来源 / 分享)  ← 只列会话，不聊天
├── /agents/capabilities, /documents, /charts, /mcp, /skills, /settings, /billing …
```

### 1.2 三条"富列表"各管一半（冗余的根源）
| 列表 | 出现位置 | 数据源 | 内容 |
|---|---|---|---|
| `ProjectsRail` | 仅 `/agents/projects/*` | `useProjects` + `?scope=loose` | 项目列表 + 最近(loose) |
| `ProjectHome` 的「聊天」tab | 仅 `/agents/projects/$projectId` | `listProjectSessions` | 该项目的会话 |
| claude-chat 内嵌 `SessionList` | 仅 `/agents/claude-chat` | `/api/agent-sessions`(**无 scope → loose+项目混在一起**) | 全部可见会话 |

→ 同一条项目会话同时出现在「ProjectHome tab」和「claude-chat SessionList」；
loose 会话同时出现在「ProjectsRail 最近」和「claude-chat SessionList」。**两个不同的富侧栏，各画一半。**

### 1.3 三个症状（Owner 实测）
1. **聊天时项目上下文丢失**：`/agents/projects/$projectId` 只列会话；点「新建对话」或某会话 →
   `navigate('/agents/claude-chat')` → **换到布局②之外的独立聊天界面**，侧栏从 ProjectsRail 变成
   SessionList，URL 不再含 projectId。等于"走出了项目"。
2. **会话列表重叠**（见 1.2）。
3. **项目内会话深链坏**：`ProjectHome` 的会话行是 `<Link to="/agents/claude-chat">`，**不带 sessionId**，
   点了不会打开那条会话（早前已记为待修）。`ProjectsRail` 的「最近」同样不带 sessionId。

### 1.4 为什么会这样（背景）
`projects/route.tsx` 注释写明：*"…the production chat route is **left untouched**"*。Projects 是当初为
**不动正在工作的聊天路由**而**另起的一层壳**，贴在旁边。合理的 MVP 去风险，代价就是现在的"两套并行"。

---

## 2. 目标模型（ChatGPT）

Owner 给的参照（ChatGPT，三类 URL）：
```
/c/{chatId}                              一般(loose)聊天
/g/g-p-{projectId}/c/{chatId}            项目内聊天
/g/g-p-{projectId}-{slug}/project        项目本身(主页)
```
ChatGPT 只有**一个富侧栏**（新聊天/搜索/GPT + 项目(可展开内联会话) + 最近），**一个主区**按 URL 换；
项目是聊天时一直在的上下文。**没有"第二条独立 rail 只在某个 URL 出现"。**

### 2.1 映射到本项目
| ChatGPT | 本项目（提案） | 主区内容 | 侧栏状态 |
|---|---|---|---|
| `/c/{chatId}` | `/agents/c/$sessionId`（Phase 2；Phase 1 暂留 `/agents/claude-chat`） | loose 聊天线程 | 「最近」高亮 |
| `/g/g-p-{proj}/c/{chatId}` | `/agents/projects/$projectId/c/$sessionId` | 项目内聊天线程 | 该项目展开、会话高亮 |
| `/g/g-p-{proj}/project` | `/agents/projects/$projectId` | 项目主页(来源/指令/会话列表) | 该项目展开 |

**三种 URL 共用同一个 `ChatNav` 侧栏组件**，主区 `<Outlet>` 换。聊天时 URL 带着 `projectId` → 上下文不丢。

---

## 3. 提案路由树

```
/agents (route.tsx)                        AppSidebar(图标全局导航) — 不变
└── (聊天工作区，共用 ChatNav 富侧栏)
    ├── /agents/claude-chat                Phase 1: loose 聊天(读 ?session= / store)；Phase 2 → /agents/c/$sessionId
    └── /agents/projects (route.tsx)       布局: <ChatNav/> + <Outlet/>
        ├── /                              ProjectsIndex(可改为重定向到最近/第一个项目)
        └── /$projectId (route.tsx 改成布局: <Outlet/>)
            ├── /                          ProjectHome(主页：来源/指令/会话列表)
            └── /c/$sessionId              项目内聊天(主区渲染 ChatSurface，带 projectId 上下文)
```

**关键变化**：
- `$projectId.tsx`（现在直接渲染 ProjectHome）→ 改成 **layout（含 `<Outlet/>`）**，
  `index` = 项目主页，`c/$sessionId` = 项目内聊天。
- `ProjectsRail` → 升级成 **`ChatNav`**（见 §4），在 projects 布局里渲染；claude-chat 也用它（component 复用），
  保证 loose 聊天和项目里侧栏**完全一致**。
- 主区的"聊天界面"被两处复用（loose + 项目内），见 §5。

---

## 4. `ChatNav`（合并 `ProjectsRail` + claude-chat 的 `SessionList`）

一个组件，从上到下：
1. **新聊天**（loose）+ **搜索会话**（可 Phase 2）。
2. **项目** section：`+ 新项目` + 项目列表。**项目行可展开**，内联显示该项目的会话（ChatGPT 行为）；
   展开数据用 `listProjectSessions(projectId)`。点项目名 → 项目主页；点其下会话 → `…/$projectId/c/$sessionId`。
   - Phase 1 可先做"点项目进主页看会话"，**内联展开**作为 Phase 1.5 增量（降低首版风险）。
3. **最近** section：loose 会话（`?scope=loose`），点 → loose 聊天 URL。

**这样三个重叠列表收敛成一个**：项目会话只在其项目下（rail 展开 or 项目主页 tab，二选一，建议 rail 展开为主、
主页 tab 保留为"全部会话"详情），loose 会话只在「最近」。claude-chat 不再内嵌**独立**的全量 SessionList。

> 注：claude-chat 现有 SessionList 是"全部可见会话(loose+项目混)"，**与 ChatGPT 的分区(项目/最近)相悖**，
> 是冗余与混乱的主要来源，Phase 1 用 ChatNav 取而代之。

---

## 5. 主区聊天界面的复用（最大实现风险）

`/agents/claude-chat/route.tsx` 是**重组件**（~2100 行）：assistant-ui `useExternalStoreRuntime` +
WS 适配器(module-level 单例) + `chat-session-store`(zustand) + `HistoricalMessage` 渲染 + 附件/artifact/preview。

要在「loose 聊天」和「项目内聊天」两个 URL 复用它，两条路：

- **(R1) 抽出 `<ChatSurface sessionId? projectId?>` 组件**：把 RouteComponent 主体(除路由壳)抽成可复用组件，
  loose 路由和 `c/$sessionId` 路由各自渲染它，传入来自 URL 的 session/project。**最干净**，但抽取工作量大、易碰隐藏耦合。
- **(R2) 单一聊天组件 + URL 驱动**：保留一个聊天组件，靠 URL/参数告诉它"加载哪个 session、属于哪个 project"，
  两个路由都渲染同一个组件实例（或通过共享 layout）。**改动小**，但要把现在的 `getSessionId()`(store) 入口
  改成"URL 优先"。

**倾向 R1**（长期更正），但需 Codex 评估抽取成本/隐藏耦合。见 §9-Q3。

---

## 6. 会话变成 URL 可寻址（核心机制改动）

**现状**：claude-chat 挂载时从 **store** 取 `getSessionId()` 决定加载哪个会话；切换会话靠
`performSessionSwitch(sdkSessionId)` 改 store；新会话靠 `onSessionInit` 回填 store。**URL 里没有 sessionId。**
这正是深链坏、上下文丢的根因。

**提案**：让 URL 成为 source of truth。
- `/agents/projects/$projectId/c/$sessionId`：路由参数 `sessionId`(用 sdkSessionId 或 db id，二选一，建议 **sdkSessionId**
  与现有 resume 一致) → 挂载/参数变化时 `resumeSession(sessionId)`，并设 project 上下文 = `$projectId`。
- loose：`/agents/c/$sessionId`(Phase 2) 或 `claude-chat?session=`(Phase 1)。
- 新建会话：`onSessionInit(newId)` 后 **`navigate` 到对应 URL**（loose → `/c/$newId`；项目内 → `…/$projectId/c/$newId`），
  取代现在"只改 store"。`pendingProjectId` arm 机制可被"URL 里就带着 projectId"取代（更简单）。

**风险**：resume/streaming/session-switch/重连恢复 逻辑精细（store + WS 单例 + assistant-ui runtime），
URL 驱动要小心不破坏现有流。见 §9-Q2。可考虑**渐进**：先让 URL 参数存在并驱动初次加载，store 仍是运行时载体（hybrid）。

---

## 7. 保留 / 合并 / 删除（文件级）

| 动作 | 对象 | 说明 |
|---|---|---|
| **新增** | `src/components/.../chat-nav.tsx` | 合并 ProjectsRail + SessionList 的统一富侧栏 |
| **新增** | `routes/agents/projects/$projectId/route.tsx`(布局) + `index.tsx`(主页) + `c.$sessionId.tsx`(项目聊天) | 由现 `$projectId.tsx` 拆分 |
| **改造** | `projects/route.tsx` | `ProjectsRail` → `ChatNav` |
| **改造** | `claude-chat/route.tsx` | 用 `ChatNav` 取代内嵌 SessionList；session 改 URL 驱动(或 hybrid)；新建后 navigate |
| **改造** | `ProjectHome` / `ProjectsRail` 的会话链接 | 全部带上 `sessionId`(深链修复) |
| **保留** | `AppSidebar`(图标全局导航) | 正交，不在本次冲突范围；能力中心/文档/Dashboards/Admin 继续放这 |
| **保留** | 后端：`listProjectSessions`(已加 owner)、`?scope=loose`、绑定/分支全套 | 无需改 |
| **可删** | claude-chat 内嵌 `SessionList` 用法（组件本身可留作他用或删） | 被 ChatNav 取代 |

**不动**：WS 协议、ws-server、worker、续聊即分支后端、L7/L8 的发起人/逐条头像（都正交，继续生效）。

---

## 8. 迁移分两阶段

### Phase 1 —— 消除三症状（建议先做）
1. 写 `ChatNav`（项目列表 + 最近；项目行点击进主页；**内联展开留到 1.5**）。
2. `$projectId.tsx` 拆成 layout + index(主页) + `c/$sessionId`(项目聊天)。
3. 主区聊天复用：选 R1 或 R2（见 §5/§9-Q3）。
4. session URL 驱动（或 hybrid，见 §9-Q2）：项目聊天 `…/$projectId/c/$sessionId` 能直达；新建后 navigate。
5. `projects/route.tsx` 用 `ChatNav`；claude-chat 用 `ChatNav` 取代内嵌 SessionList。
6. 修所有会话深链带 sessionId。
**验收**：在项目里点会话 → 同页主区打开、侧栏仍是该项目、URL 含 projectId+sessionId；刷新可直达；三个列表收敛。

### Phase 2 —— 往纯 ChatGPT 收
- loose 聊天 URL → `/agents/c/$sessionId`（弃 `/agents/claude-chat` 或 301）。
- ChatNav 项目行**内联展开会话**（ChatGPT 视觉）。
- 「搜索会话」。
- 评估图标条是否进一步简化/与 ChatNav 合并（workbench 取舍，见 §9-Q4）。

---

## 9. 请 Codex 重点裁定的取舍（Review Asks）

- **Q1（范围）**：先 Phase 1 全量、还是更小切片（如只做 `c/$sessionId` + 深链修复，ChatNav 合并放后）？哪个切片
  既能消症状又最小化对"已验证聊天核心"的扰动？
- **Q2（URL vs store）**：session 改 **URL 驱动**(R 干净) vs **hybrid**(URL 仅驱动初次加载、store 仍是运行时载体)。
  考虑 resume/streaming/重连/`onSessionInit`/`performSessionSwitch` 的精细耦合 —— 哪个风险/收益更优？是否有
  会破坏现有流的坑（如 SSR loader 期就 resume、双重加载、chatKey）？
- **Q3（复用方式）**：主区聊天用 **R1 抽 `<ChatSurface>`**(长期正) vs **R2 单组件 URL 驱动**(改动小)。
  route.tsx ~2100 行，抽取是否会碰 module-level WS 单例 / assistant-ui runtime / artifact·preview 的隐藏耦合？
- **Q4（workbench 取舍）**：我们比 ChatGPT 多「能力中心/文档/Dashboards/Admin」。保留图标条作全局导航(Slack/Linear 式)
  够不够简洁？还是该把它们折进一个侧栏的次级区？（不影响 Phase 1，但定调）
- **Q5（项目主页 vs rail 展开 的会话列表去重）**：项目会话最终落在「rail 内联展开」还是「项目主页 tab」？
  两者都留会不会又造重叠？建议主路径走哪个？
- **Q6（sessionId 用 sdkSessionId 还是 db id 入 URL）**：现有 resume 用 sdkSessionId；db id 更稳定但要多一跳解析。URL 里放哪个？
- **Q7（TanStack 细节）**：`$projectId` 拆成 layout+index+child 的最佳写法（`route.tsx` + `index.tsx` + `c.$sessionId.tsx`）；
  loose 与项目聊天**共用 ChatNav** 用"component 复用(两个 layout 各渲染)"还是"提一个共享 layout 包住两者"更合官方推荐？

---

## 10. 非目标 / 不在本次范围
- 不动续聊即分支后端、WS、worker、L7/L8 已落地的发起人/逐条头像。
- 不动认证/权限解析器（`canAccessSession` 等）。
- 不引入第二套 Agent SDK / AI SDK（违反 CLAUDE.md 北极星）。

## 11. 兼容性 checklist（实施时逐条过）
- [ ] 旧 URL `/agents/claude-chat`（无参）仍可用（不破坏外部书签/现有跳转）。
- [ ] 刷新项目聊天 URL 可直达（SSR + resume 不双加载）。
- [ ] 新建会话(loose/项目内)后 URL 正确、侧栏正确高亮。
- [ ] 续聊即分支：在项目聊天里非 owner 回复 → 分支 D2 仍在同项目、URL 切到新 sessionId、banner/分割符/逐条头像不回归。
- [ ] `?scope=loose`「最近」不含项目会话；项目会话只在其项目下。
- [ ] i18n(intlayer) 文案补齐；feature flag `projects` 仍 gating。
- [ ] typecheck / lint / 单测 125 不回归。

---

### 附：给 Codex 的一句话
这是**导航/路由架构**重构（不碰聊天内核逻辑、不碰后端）。请按 §9 的 Q1–Q7 给出你的取舍判断与风险点，
尤其 **Q2(URL vs store)** 和 **Q3(抽 ChatSurface vs URL 驱动单组件)** —— 这两个决定整体风险与改动面。

---

## 12. Codex 总裁定（2026-06-09）— **Phase 1 锁定契约**

走**保守切片**：Phase 1 **不做"纯 URL source of truth"，不大抽 `<ChatSurface>`，不碰后端/WS/worker**。
= **统一导航 + 项目聊天深链 + hybrid URL bootstrap**。URL 负责"可寻址/上下文/高亮"，
**store + WS adapter 的 `currentSessionId` 继续是运行时真相**。

**Phase 1 做（且仅做）：**
1. 新 `ChatNav`，替代 `/agents/projects` 的 `ProjectsRail` 和 `/agents/claude-chat` 内嵌 `SessionList`。
2. 增加 `/agents/projects/$projectId/c/$sessionId`；项目会话链接全部带 sessionId。
3. loose 先保留 `/agents/claude-chat?session=$sessionId`（Phase 2 再迁 `/agents/c/$sessionId`）。
4. 项目内聊天主区**复用现有聊天控制器**，**不重写** streaming/resume/onSessionInit。
- **不做**：rail 内联展开、搜索、全局共享 layout、纯 URL 状态机、后端改动。

**Q2 = hybrid。** URL 只驱动初次加载 + 显式导航；运行时仍以 store+WS `currentSessionId` 为准。铁律：
- URL param effect **只在 client mount 后**执行（**SSR loader 里 resume 是红线**，loader 只取 permission/default-skills 这类无 WS 数据）。
- 有 URL session 时，**跳过**现有"mount 时从 `getSessionId()` 恢复旧会话"的默认路径 → 避免双加载。
- session URL 变化时**复用 `performSessionSwitch()`**，不另写 resume。
- `onSessionInit(newId)` 后**只更新 store + `navigate` 到对应 URL**；URL effect 要**识别"已经是当前 session"** → 不再 clear+resume。
- `chatKey` **只在真正切换 session 时 bump**；`session_init` / `messages_loaded` 不 bump。
- streaming 中 URL 变化**不触发 remount/clear**；分支 D2 的 `session_init` = store 切换 + URL 镜像。

**Q3 = R2.5。** 把现有 `claude-chat/route.tsx` 的 RouteComponent 包成**可复用的"聊天控制器组件"**，
**不深抽内核**。会话生命周期（`onMessagesLoaded`/mount resume/`onSessionInit`/重连恢复/`performSessionSwitch`/
`pendingProjectId`/artifact hydrate/`chatKey`/assistant-ui runtime）**留在外层控制器原样**。
两个 route wrapper 只传 `urlSessionId / projectId / showInternalSessionList=false`。

**Q4** 保留 `/agents` AppSidebar 图标条（全局导航）；`ChatNav` = 聊天工作区导航。双层导航(Slack/Linear 式)合理。
**Q5** 长期主路径 = rail 内联展开；项目主页保留为详情页。**Phase 1 项目主页会话列表必须全部深链到 `/$projectId/c/$sessionId`**，
避免"项目主页列表 + chat 内全量 SessionList + rail 最近"三套并存。
**Q6 = sdkSessionId**（现有 resume/WS/分支/SessionList 全以它跑；db id/slug 留待 Phase 2）。
**Q7** 目录式：`projects/$projectId/route.tsx`(layout) + `index.tsx`(ProjectHome) + `c/$sessionId.tsx`(项目聊天)；
loose 与项目聊天**组件复用 ChatNav（两个 layout 各渲染）**，不为抽共享 layout 重排 `/agents` 树。

**最高风险点（实施验收必须逐条防）：**
- [ ] URL effect 与现有 mount resume **双触发** → clearMessages+resume 跑两次。
- [ ] `onSessionInit(D2)` 后 navigate 又触发 `performSessionSwitch(D2)` → **把正在 streaming 的分支线程清掉**。
- [ ] 包装时把 `onMessagesLoaded/onSessionInit` 注册成**两个实例** → 重复加载/重复切换。
- [ ] **不要**废掉已验证的 `createSession(projectId)` 创建时绑定 → Phase 1 沿用。
- [ ] **SSR loader 里 resume = 红线**。
