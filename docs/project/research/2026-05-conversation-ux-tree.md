# 对话 / 信息展示区 — 优化点结构树

> 日期：2026-05-31 · 目的：把"用户注意力最重的对话/输出区"能优化的交互点**结构化穷举**，
> 作为后续视觉/交互打磨的"套路地图"。**不要求全做**，先有结构再挑优先级。
> 每个节点尽量锚定真实代码（行号会漂移，用 grep 定位）。
>
> **★ = 注意力重灾区**（用户大部分时间在读 AI 输出，这些直接决定体感）。

## 0. 真实数据/渲染骨架（先对齐事实）

- 一条消息 = `ThreadMessage { role, content: ContentPart[] }`（`chat-session-store.ts`）。
- `ContentPart = TextPart | ReasoningPart | ToolCallPart`。
- AI 消息被 `buildAssistantTurn()`（`lib/turn-builder.ts`）组装成一个 **AssistantTurn**：
  - `activities: StepActivity[]`，`kind ∈ {reasoning(思考过程) | intermediate(中间过程) | tool(工具调用)}`，
    `status ∈ {running | completed | error | backgrounded}`；
  - `renderItems`：`activity` 或 `search-group`（连续搜索类工具聚合，带 `sources`）；
  - 最终答案文本（final answer）。
- 渲染：`assistant-turn-card.tsx`（时间线 dot / 状态图标 / running 标签 / 预览文本 / `ActivityDetailDrawer` 详情抽屉）、
  `streaming-markdown.tsx` + `markdown-components.tsx` + `code-block.tsx` + `linkify.ts`（最终答案排版）、
  `claude-status.tsx`（InlineStatus 思考/工具态）、`artifact-button.tsx`（触发右侧面板）、
  `inline-image-preview.tsx`、`context-badges.tsx`、`usage-card.tsx`、`permission-badge.tsx`。

---

## 0.5 这是一份「活的 checklist」——怎么用 & 怎么更新

**用途**：one-by-one 地 check 每个节点。check 的方式 = **对标参考产品**：读对方同类组件怎么实现，
和我们对比，判断"谁更好"，得出结论与动作。这样把"凭感觉打磨"变成"模块/组件级的工程化评审"。

**状态图例**（在每个节点前标记，随进度更新）：
`⬜ 未 check` · `🔄 进行中` · `✅ 已 check（下接一行**对标结论**：参考产品/文件 → 差距 → 决定）` · `⏭️ 暂不做`。

> 更新约定：每完成一个节点的对标，就把该节点标记改成 ✅，并在其下补一行
> `↳ 对标 <产品/文件>：<对方做法> ｜ 我方：<现状> ｜ 结论：<采纳/保留/改进点>`。
> 这份文件**长期留存、持续更新**，是对话区打磨的唯一事实来源。

### 对标产品映射（references/ 内，按节点群指定主对标）

| 节点群 | 主对标产品 · 关键文件 | 备选对标 |
|---|---|---|
| D1 Turn 整体 / D2 过程时间线 | **craft-agents-oss** `packages/ui/src/components/chat/TurnCard.tsx` + `turn-utils.ts`（我们本就 Craft-aligned，直接逐行比） | deep-agents-ui `ChatMessage.tsx` |
| D2.3 工具调用步骤卡 | **deep-agents-ui** `src/app/components/ToolCallBox.tsx` + craft `lib/tool-parsers.ts` | deer-flow `frontend/src`（research 步骤流） |
| D2.4 搜索分组/来源 | **deer-flow** `frontend/src`（深研来源呈现） | open-webui |
| D3.1 Markdown 排版 | **craft-agents-oss** `components/markdown/Markdown.tsx` + deep-agents-ui `MarkdownContent.tsx` | lobe-chat / LibreChat |
| D3.2 代码块 / diff / json | **craft-agents-oss** `markdown/MarkdownDiffBlock.tsx` `MarkdownJsonBlock.tsx` `MarkdownMermaidBlock.tsx` | open-webui |
| D3.3 流式渲染不破版 | **craft-agents-oss** `markdown/CollapsibleMarkdownContext.tsx` + 我方 `streaming-markdown.tsx` | lobe-chat |
| D4 消息操作条 | **craft-agents-oss** `chat/TurnCardActionsMenu.tsx` | open-webui / LibreChat |
| C1 用户气泡 | **craft-agents-oss** `chat/UserMessageBubble.tsx` | lobe-chat |
| E5 HITL 审批 | **deep-agents-ui** `src/app/components/ToolApprovalInterrupt.tsx` | — |
| A/B 布局·滚动·分组 | **lobe-chat** / **open-webui**（成熟会话流） | LibreChat |
| F1 排版/字体 · F2 密度 | Claude Design 截图（owner 提供）+ craft Markdown | lobe-chat |

### Check 单元模板（每个节点照此填）

```
节点 Dx.y ✅
↳ 对标 <product/file:line>：<对方关键做法（数据结构/交互/视觉）>
   我方 <our file:line>：<现状做法>
   差距：<列差异点>
   结论：<采纳对方X / 保留我方Y / 新增Z>，落到 <issue/commit>
```

### 推进顺序（建议，呼应注意力优先级）
F1/F2 底座 → D3.1/D3.2/D3.3 答案区 → D1.1/D1.4 过程↔答案层级+折叠 → D2.3/D2.5/D2.6 过程时间线 → 其余。
**每 check 一个节点：读对标 → 填模板 → 真实对话截图验收 → 标 ✅。**

---

## ✅ 组件 Check 表单（coverage 账本 — 确保每个模块都被 check）

> 状态：`✅查`=已对标 check · `✅改`=已落地改动 · `🔄`=进行中 · `⬜`=未 check。
> 这张表是"覆盖率"的唯一事实来源；每 check 一个组件就更新对应行 + 在下方 Check 日志补细节。

| 组件 / 模块 | 文件 | 节点 | 状态 | 发现的问题 | 做了哪些改动 | 对标 |
|---|---|---|---|---|---|---|
| Turn 卡 + turn 组装 | `assistant-turn-card.tsx` · `lib/turn-builder.ts` | D1,D2,**D1.4** | ✅改 | 过程区完成后不折叠(永远展开、压住答案)；另无 TurnPhase awaiting-gap / 无 parent 嵌套 / 工具行缺耗时·图标 | **D1.4 已修**：完成且有答案时过程区自动折叠成一行、答案主导(running 仍展开、可手动点开)；TurnPhase/嵌套/工具行细节待办 | craft `TurnCard`/`turn-utils` |
| Markdown 正文 | `markdown-components.tsx` | D3.1,F3 | ✅改 | 硬编码 Craft hex，不跟暖色/暗色 | hex→语义 token（3 变体全量） | craft `Markdown.tsx` |
| 富代码块路由 | `markdown-components.tsx` | D3.2,D3.6 | 🔄 | 只有单一 CodeBlock，缺 diff/json/mermaid/html/image 预览 | 待办（分阶段） | craft `markdown/*Block` |
| 流式渲染 | `streaming-markdown.tsx` | D3.3 | ⬜ | partial markdown 不破版？ | — | craft `CollapsibleMarkdownContext` |
| 链接安全/样式 | `linkify.ts` | D3.4 | ⬜ | — | — | craft `linkify.ts` |
| 工具调用步骤卡 | `assistant-turn-card.tsx`(内) | D2.3,D2.7 | ✅改 | 状态色硬编码 red-500/green-500；无内联展开(仅抽屉)；无 interrupted；HITL 未内联 | **D2.7 已修**：新增 `--success` token，全局统一 running=primary/done=success/error=destructive(工具卡+工作台同一套)；内联展开/interrupted/HITL 待后续 | **deep-agents-ui `ToolCallBox`** + craft |
| 状态指示(思考/工具/流式) | `claude-status.tsx` | E1,F3 | ✅改 | 状态用 蓝/紫/琥珀/绿 彩虹 + 中性 Craft-hex 冻结 | 收敛到统一语义：active=primary/idle=muted/停止=destructive；中性 hex→token | craft `shouldShowThinkingIndicator` |
| 用户消息 | `route.tsx`(HistoricalMessage) | C | ⬜ | 气泡/对齐/附件 | — | craft `UserMessageBubble` |
| 消息操作条 | `route.tsx`(AssistantMessage) | D4 | ⬜ | 已有复制/赞踩/重生成，样式待审 | — | craft `TurnCardActionsMenu` |
| 权限/HITL | `permission-badge.tsx` | E5 | ⬜ | Wave 2 | — | deep-agents-ui `ToolApprovalInterrupt` |
| 用量/context | `usage-card.tsx` · `context-badges.tsx` | E6 | ⬜ | — | — | — |
| Artifacts 触发 | `artifact-button.tsx` · `artifacts-panel.tsx` | D3.6 | ✅查 | 审计：0 硬编码色，已合规 | 无需改 | craft 预览块 |
| 图片预览 | `inline-image-preview.tsx` | D3.5 | ✅查 | 审计：0 硬编码色，已合规 | 无需改 | — |
| Composer 输入框 | `chat-composer.tsx` | composer,F3 | ✅改 | 阴影不足；popover 下拉用 Craft-hex 冻结 | shadow-md+发丝边框+send 渐变；popover 中性 hex→token(bg-popover/border-border/muted) | Claude Design |
| 技能入口栏 | `a2composer-panel.tsx` | skills | ✅改 | ghost 不像 chip | →胶囊 chip+阴影 | Claude Design |
| 右侧工作台 | `workbench-panel.tsx` | 右栏 | ✅建 | Wave 0/1 新建 | Progress(Todo)+Sub-agents | Cowork |
| 全局 token/圆角 | `styles/app.css` · `ui/button.tsx` | F1,F8 | ✅改 | 圆角一刀切、按钮平 | radius 刻度 10px、tactile 按钮、衬线标题 | Claude Design |
| 会话列表项 | `session-item.tsx` | B,左栏 | ✅改 | 黑白叠加 hover + Craft-hex + green-600/red-500 | hover→muted/active→accent、ring→ring、品牌→primary、save→success、delete→destructive | lobe-chat |
| 会话信息面板 | `session-info-panel.tsx` | 右栏 | ⏭️ | **过度设计**：7 块信息(cwd/session-id/全量工具/MCP内部/子代理…)多为调试信息+emoji 噪声 | 暂缓 token 化，待简化决策 | — |
| 用量卡 | `usage-card.tsx` | E6 | ⏭️ | **过度设计**：原始 token/4 位成本/per-model 账本，应为简洁积分概念 | 暂缓 token 化，待简化决策 | Coze 计费透明 |
| 权限徽章 | `permission-badge.tsx` | E5,F3 | ✅改 | 6 模式+Bash 的 7 色语义彩虹 | 收敛 3 档：安全默认=success/中间模式=muted(标签区分)/Bypass 危险=destructive，安全信号保留 （⚠️ 底层 permission 正在优化，待其定稿后 UI 需重新矫正、勿过度投入）| deep-agents-ui(无直接对应模式徽章) |
| 代码块本体 | `code-block.tsx` | D3.2 | ✅改 | chrome 硬编码 hex + green-600；语法主题(Shiki)无关 | chrome→token(border/bg-muted/muted-foreground/success)，InlineCode 采纳 craft 克制版(bg-foreground/4%)，**Shiki github 主题保留** | craft `CodeBlock` |
| artifact 渲染器 | `artifact-markdown.tsx`(+json) | D3.6 | ✅改 | 仅 markdown(Craft-hex+品牌链接)/json(值类型语法色)有色；余 6 个干净 | markdown chrome→token、品牌→primary；json 语法色保留；其余渲染器本就干净 | craft 预览块 |
| MCP 状态 | `mcp-status-indicator.tsx` | E | ✅改 | 中性 hex + red-500 | →muted-foreground/destructive | — |
| 技能管理面板 | `skills-manager-panel.tsx` | E | ✅改 | 全 gray 中性+蓝色启用开关；本身不算过度设计 | gray→foreground/muted/border、bg-white→card、启用开关 blue→primary | lobe-chat 插件 |

### ⚠️ 过度设计观察（owner 决策项 — “想给用户太多”）
边 token 化边用「是否给用户太多」的尺子量，发现 2 个明确候选（已在表标 ⏭️ 暂缓抛光）：
1. **`session-info-panel`**：单面板塞 7 块信息，工作目录/Session ID/内置工具全量/MCP 内部状态/子代理名 = 开发者调试信息，占满终端用户注意力。建议：用户向(Skills/显示设置)留，调试向收进可折叠「技术细节」或右侧 Context tab。
2. **`usage-card`**：原始 token 分项 + 成本精确到 $0.0034 + per-model 账本 = 工程/计费视角；与锁定的 Coze「积分可见、消耗取决于任务量」不符。建议：用户只看简洁积分/用量，原始账本进开发者视图。
> DESIGN-SYSTEM 候选原则：**默认给用户「够用且克制」，调试/工程细节藏进二级（折叠/开发者模式），不要一屏全抛。**
| 容器/布局/滚动 | `route.tsx`(ChatSurface/Viewport) | A,B | ⬜ | 阅读宽度/滚动锚定/虚拟化未审 | — | lobe-chat / open-webui |

---

## A. 容器 / 布局层（conversation viewport）
- A1 ★ 阅读宽度与左右留白（最终答案的行宽是否在 ~65–80 字符舒适区；过宽伤可读）。
- A2 ★ 垂直节奏（turn 间距 / 段落间距 / 过程区与答案区的间隔层级）。
- A3 滚动行为：自动跟随流式、到底判定、滚动锚定（流式时不跳动）、**"回到底部"浮标**、新消息提示。
- A4 顶/底渐隐遮罩（内容滚到 composer 后有柔和边界，而非硬切）。
- A5 过程信息的"搬运边界"：哪些过程留在对话流、哪些进右侧工作台（Progress/Sub-agents/Files）——
  避免对话流被过程噪声淹没（护城河式信息架构）。
- A6 长对话性能：虚拟化 / 懒渲染（历史消息多时不卡）。

## B. 消息流层（message list）
- B1 ★ 用户消息 vs AI 消息的视觉区分（对齐 / 气泡 vs 无气泡 / 背景浓淡）。
- B2 turn 之间的分隔（留白 / 极淡分隔线 / 时间分组"今天/昨天"）。
- B3 连续同源消息的合并（同一 turn 内不重复头像/署名）。
- B4 锚点与定位（长答案生成时页面跳动控制；turn 可被右侧"它在干什么"点击定位）。

## C. 用户消息（user message）
- C1 气泡样式（圆角/背景/对齐，配合暖色 token）。
- C2 附件展示（图片/文件缩略，`message-attachments` / `inline-image-preview`）。
- C3 可编辑 / 重发 / 引用某段再问。
- C4 长输入折叠（超长粘贴内容默认折叠 + 展开）。

## D. AI 消息 = 一个 Turn（★ 重中之重）

### D1 Turn 整体
- D1.1 ★ **过程区 vs 最终答案的层级对比**：过程"轻"（小字/灰/紧凑/可折叠），答案"重"（正文字阶/舒适）。
  现状两者层级区分不够，是核心优化点。
- D1.2 turn 容器形态（卡片 vs 无卡片融入背景；Coze/Cowork 取舍）。
- D1.3 头像 / 署名 / 时间戳的克制呈现。
- D1.4 ★ **折叠策略**：过程区在 running 时展开、完成后自动折叠成一行摘要（"用了 3 个工具 · 12s"），
  点开看细节 —— 让注意力回到 final answer。

### D2 过程区 = StepActivity 时间线（turn-builder / assistant-turn-card）
- D2.1 reasoning 思考过程：展示/隐藏开关、灰度弱化、可展开（`showThinking` 已在 store）。
- D2.2 intermediate 中间文本：与思考/答案区分，避免和 final answer 混淆。
- D2.3 ★ tool 工具调用步骤卡：图标 + 工具名 + **参数摘要**(`formatArgsSummary`) + 状态 + **耗时** + 结果预览。
  现状是"关键组件不够细致"的主战场（边框/圆角/内距/状态色/hover/可展开）。
- D2.4 search-group 搜索分组：来源卡片、favicon、引用编号、来源去重。
- D2.5 ★ 时间线视觉：dot + 连线 + running 旋转（`TimelineDot`/`ActivityStatusIcon`），让"进行到哪"一眼可读。
- D2.6 ★ running 实时标签（`getRunningLabel`："正在搜索…/正在写 X…"）——降低等待焦虑。
- D2.7 状态语义色统一：running=强调色 / done=绿 / error=红 / backgrounded（现混用 text-red-500/green-500 等硬编码色，应归一到 token）。
- D2.8 ActivityDetailDrawer 详情抽屉：打开方式、内容排版（JSON/文本/图片）、关闭。
- D2.9 错误步骤的呈现（失败原因、重试入口）。

### D3 最终答案 / Final Answer（★ 用户读得最久）
- D3.1 ★ Markdown 排版系统：标题/段落/列表/引用/表格的**字阶 + 行高 + 间距**（`markdown-components.tsx`）——
  中英文混排的可读性是第一要务。
- D3.2 ★ 代码块（`code-block.tsx`）：语法高亮主题、复制按钮、文件名/语言标签、行号、长代码折叠、**diff 高亮**、水平滚动。
- D3.3 ★ 流式渲染（`streaming-markdown.tsx`）：打字机顺滑度、**partial markdown 不破版**（半个表格/代码块不闪烁）、光标、节流。
- D3.4 内联元素：链接（`linkify.ts` 安全 + 样式）、内联代码、加粗、数学公式（KaTeX 已在）。
- D3.5 图片 / 媒体：`inline-image-preview` 的尺寸、点开大图、懒加载。
- D3.6 ★ Artifacts 触发：`artifact-button` → 右侧面板；正文里"卡片化"引用产物（图表/HTML/CSV/SVG/React）。
- D3.7 引用 / 脚注 / 来源标注（答案里嵌可点来源角标）。
- D3.8 长答案可读性：自动小标题锚点 / 目录 / 折叠超长 section / "展开全部"。
- D3.9 表格的横向滚动 + 斑马纹 + 紧凑/舒适切换。

### D4 消息级操作（action bar）
- D4.1 复制（整条 / 某代码块 / 某段）。
- D4.2 重新生成 / 继续 / 编辑后重发。
- D4.3 ★ 反馈：点赞/点踩（已有 ThumbsUp/Down）→ 视觉与落库。
- D4.4 引用此段再问、分享单条。
- D4.5 操作条出现策略：hover 浮现 vs 常驻（移动端必须常驻）。

## E. 状态 / 反馈层
- E1 ★ 思考中 / 工具中 / 流式中（`claude-status.tsx` InlineStatus + `AgentStatusType`）——
  态与态之间的过渡、文案、动效克制。
- E2 空态（已改衬线标题）、初始化（"Initializing session"）、排队（queueCount）。
- E3 被中断 / 停止（EscapeInterruptHandler）后的呈现与续跑入口。
- E4 错误态（网络/模型/工具失败）的统一卡片 + 重试。
- E5 HITL 权限审批在流里的呈现（Wave 2，`permission-badge` 扩展）。
- E6 token / 用量提示（`usage-card` / context-badges）在流里/底部的克制展示。

## F. 跨切面（cross-cutting，影响以上所有）
- F1 ★ 排版系统：字体方向（衬线标题 + 无衬线正文 + 中文字体）、字阶表、行高、字距、中英文混排间距。
- F2 ★ 密度刻度：过程区紧凑 / 答案区舒适 —— 两套节奏，别一刀切。
- F3 颜色语义：状态色 + 强调色克制，清掉硬编码（如 `text-red-500`）归一到 token。
- F4 动效：流式、展开/折叠、状态切换——顺滑且克制，支持 `prefers-reduced-motion`。
- F5 可访问性：对比度（WCAG）、键盘可达、屏读 aria、focus 环。
- F6 响应式：窄屏对话区与右侧工作台的降级（抽屉/底部 tab）。
- F7 暗色：过程区/代码块/状态色在暗色下的可读性。
- F8 一致性：圆角刻度（已收敛 6/8/10/14）、阴影、边框在以上所有组件统一。

---

## 注意力优先级（若要排序，建议这样切）

1. **D3 Final answer 可读性**（D3.1 排版 / D3.2 代码块 / D3.3 流式不破版）—— 读得最久。
2. **D1.1 + D1.4 过程/答案层级 + 过程折叠** —— 让注意力聚焦到答案，过程退为"可查"。
3. **D2.3 + D2.5 + D2.6 工具步骤卡 + 时间线 + running 标签** —— "它在干什么"一眼可读，降焦虑。
4. **A1/A2 阅读宽度与垂直节奏** + **F1 排版系统/字体** + **F2 密度** —— 全局底座。
5. 其余（操作条、来源标注、长答案目录、性能虚拟化）按需。

> 套路：先定 **F1 排版 + F2 密度**（底座）→ 再做 **D3 答案区** → 再做 **D2 过程区/时间线** →
> 最后 **D1 折叠策略 + D4 操作条**。每步真实对话截图验收。

---

## Check 日志（按节点累积，最新在上）

### D1 / D2 — Turn 结构 & 过程时间线 ✅ (2026-05-31)
↳ 对标 **craft-agents-oss** `packages/ui/src/components/chat/turn-utils.ts` + `TurnCard.tsx`
  （我方 `src/lib/turn-builder.ts` + `src/components/claude-chat/assistant-turn-card.tsx`，本就 Craft-aligned）

对方关键做法：
- **TurnPhase 状态机** `pending→tool_active→awaiting→streaming`，`deriveTurnPhase()`/`shouldShowThinkingIndicator()`
  显式处理"工具完成 → final answer 之间的 GAP"（注释：否则卡片在工具完成后会闪掉/消失）。
- **`groupActivitiesByParent` / `ActivityGroup` / `expandedActivityGroups: Set<string>`**：按 parent 做**嵌套分组**
  （= 我们推迟的子 agent 嵌套树，craft 有现成范式）。
- 工具行更细：`toolDuration`（耗时）+ `formatTokens`（token）+ per-tool `toolDisplayMeta`（含 base64 图标）+ `formatToolInput` 简洁摘要；turn 级抽取 `todos`。
- 多一个 `type: 'status'`（如 'compacting'）活动类型。

我方现状：
- 3 类活动 `reasoning | intermediate | tool`，**无 TurnPhase / 无 awaiting 相位**（疑似流式中卡片跳动根因，待验）。
- **无 parent 嵌套分组**；但**有 `search-group`** 把搜索类工具聚合成来源卡片（craft 未见同等特化，我方可能更好）。
- 有 `elapsedSeconds`/`formatArgsSummary`/`ActivityDetailDrawer`，但未展示耗时/token/per-tool 图标。

结论（候选动作，待 owner 圈选）：
- 采纳 **TurnPhase awaiting-gap**（高 ROI，治流式卡片跳动）。
- 采纳 **groupActivitiesByParent** → 落地 D2 子 agent 嵌套树（替代当前扁平列表）。
- 采纳 **per-tool 耗时/图标/精简摘要**（治 D2.3"工具卡不细致"）。
- **保留并强化** `search-group` 来源卡片。
- 可选：加 `status`（compacting）活动类型。

### D3.1 / D3.2 — Markdown 排版 & 富代码块 ✅ (2026-05-31)
↳ 对标 **craft-agents-oss** `packages/ui/src/components/markdown/Markdown.tsx`
  （我方 `src/components/claude-chat/markdown-components.tsx`，本就改编自它）

发现 ①（**bug 级 / 必修**）：craft 用语义 token（`text-accent` 链接、`text-muted-foreground`、`border`、
`border-border/50`、`border-muted-foreground/30`），**我方却替换成硬编码 hex**（`#6b6a68`/`#e5e4df`/
`#3a3938`/`#9a9893` = Craft 旧palette）。→ final answer 正文/表格/引用/分隔线**不跟随暖色主题、暗色失真**。
结论：**全量替换为我们的语义 token**（同时清 F3 硬编码色）。低成本高收益，建议优先做。
注：我方该文件有 3 套变体（compact/中/full），硬编码集中在中+full 两套，需一并改。

发现 ②（**能力差距 / 可选大升级**）：craft 按围栏语言路由到专用渲染器——
`diff→MarkdownDiffBlock`、`json→MarkdownJsonBlock`、`mermaid→MarkdownMermaidBlock`、`datatable`、
`spreadsheet`、`html/pdf/image→预览`、`latex`、`doc`，并用 `wrapBlock(position)` 包裹（配合
`CollapsibleMarkdownContext` 做流式/折叠稳定）。**我方只有单一 `CodeBlock`**。
结论：分阶段引入富块（先 diff/json/mermaid，再 html/image 预览，与右侧 artifacts 面板打通）；
`wrapBlock`+Collapsible 思路用于 D3.3 流式不破版。craft 的块渲染器可直接参考移植。

发现 ③（细节）：craft 标题克制（h1/h2 `text-[16px]`、h3 `text-[15px]`，近正文）。我方 text-lg/base 接近，OK；
链接 craft 用 `text-accent`、我方 `text-primary`（都已 token 化，保留我方）。

候选动作：A. 立即修①（token 化，治主题/暗色）→ **✅ 已落地**（`markdown-components.tsx` 3 变体硬编码 hex
全量换语义 token；真实对话验收：表格暖色发丝线/引用暖灰/代码块 bg-muted/列表 marker 暖灰，跟随主题）；
B. 分阶段抄② diff/json/mermaid 富块 → 待 owner 圈选。

### D2.3 / D2.7 — 工具调用步骤卡 ✅ (2026-05-31)
↳ 对标 **deep-agents-ui** `src/app/components/ToolCallBox.tsx`（+ 上轮 craft 工具行）
  （我方 `src/components/claude-chat/assistant-turn-card.tsx`：StepActivity 'tool' 行 + `ActivityDetailDrawer`）

对方关键做法（deep-agents-ui）：
- 全语义 token：`text-foreground/text-muted-foreground/text-destructive`、`bg-accent`、`bg-muted/30`、`border-border`、`rounded-lg/sm`。
- 状态图标驱动：completed(CircleCheckBig)/error(AlertCircle destructive)/pending(Loader2 spin)/**interrupted(StopCircle 橙)**/default(Terminal)。
- **就地内联展开**：展开后显示小标题 `Arguments`（每个 arg 可单独折叠，mono）+ `Result`（mono pre，bg-muted）。
- **内联 HITL**：有 actionRequest 时把 `ToolApprovalInterrupt` 渲染进工具盒内（= 我们 Wave 2 E5 范式）。

我方现状：
- **状态色硬编码** `text-red-500`/`text-green-500`/`bg-red-400`（running 用 `--assistant-accent` token，OK）→ D2.7 需归一到 `text-destructive`/语义。
- 交互是"时间线行 → 点开独立 `ActivityDetailDrawer`"（重详情好，快速一瞥差）；无 interrupted 状态；HITL 未内联。
- 有 `formatArgsSummary` 摘要、`elapsedSeconds`（但未展示耗时/per-tool 图标 — 见 craft 发现）。

结论（候选动作，待 owner 圈选）：
- **快赢**：D2.7 状态色归一（清 red-500/green-500 → 语义 token），与 D3.1 同性质，低成本。
- 工具卡精修：在时间线行内**加内联快速展开**（结构化 Arguments/Result，参考 deep-agents-ui），重详情仍留 Drawer；
  加 craft 的 per-tool 耗时/图标/精简摘要。
- 加 `interrupted` 状态；Wave 2 HITL 采用 deep-agents-ui 的内联审批范式。

### D2.7 — 状态色全局统一 ✅改 (2026-05-31)
新增语义 token `--success`(暖 sage 绿，app.css 亮/暗 + @theme)。统一全脸状态语义：**running=primary(陶土) / done=success(绿) / error=destructive / 中性=muted**。
落地：`assistant-turn-card`(ActivityStatusIcon/TimelineDot：red-500→destructive、green-500→success) + `workbench-panel`(todo done checkbox、sub-agent done：原 primary→success)。
依据 DESIGN-SYSTEM §1.2（"需要成功绿时统一加 --success token，不散落 green-500"）。真实对话验收：时间线 "Write·hi.py" 显示 success 绿 ✓、running 陶土 spinner。

### 全局色彩债务（2026-05-31 审计 + 批量收敛进行中）
全局 grep 出对话区大量组件冻结了 Craft 硬编码 hex / 裸调色板色（Frankenstein 根源）。已按"始终在屏"优先级成批 token 化：
**✅改**：`markdown-components`(D3.1)、`assistant-turn-card`+`workbench-panel`(D2.7 状态色+新增 --success)、`claude-status`(状态彩虹→统一)、`chat-composer`(popover)、`session-item`。
**⬜ 待续**：`session-info-panel`(64)、`usage-card`(65)、`permission-badge`(38 语义色需谨慎)、`code-block`(20 含语法主题)、`artifact-*`、`mcp-status-indicator`、`skills-manager-panel`、各 overlay。
原则：纯中性 hex→token(border/muted/foreground/popover)；状态语义→§1.2(primary/success/destructive)；语法高亮主题等"刻意特殊色"保留并标注。

### code-block / permission-badge 研究+精修 ✅改 (2026-05-31)
- **code-block** 对标 craft `CodeBlock.tsx`：两者同源，但 craft 用语义 token、我方冻结了 hex。结论=把 full-mode chrome
  (容器/头部/语言标签/复制键/copied✓) token 化；InlineCode 采纳 craft 克制版(`bg-foreground/[0.04]` 无边框)。
  语法高亮来自 Shiki `github-light/dark`，与 chrome 无关、保留不动。
- **permission-badge**：references 无直接对应的"权限模式徽章"(deep-agents-ui 是审批 interrupt/HITL，craft 是 AcceptPlan)。
  研究结论=按宪法 §1.2 + 安全语义收敛 7 色彩虹→3 档：default(Standard)=success(安全绿)、plan/dontAsk/acceptEdits/delegate=muted
  (中性，靠标签区分)、bypassPermissions(±Bash)=destructive(危险红，**关键安全信号保留**)；Bash 状态 green/red→success/destructive。
  注：6 个权限模式 + 详细 popover 安全说明信息量偏大，**可能轻度过度设计**(模式数与 popover 详尽度)，但涉及后端权限语义与安全沟通，暂保留，记此备查。

### artifact-markdown / artifact-json / skills-manager 研究+精修 ✅改 (2026-05-31)
- **artifact-*** 审计：仅 artifact-markdown(38) 与 artifact-json(9) 有硬编码色；csv/html/image/svg/react/panel 本就干净。
  artifact-markdown 是 artifacts 面板的独立 md 渲染器(react-syntax-highlighter oneDark/oneLight)，chrome/文字/品牌链接 hex 全 token 化(语法主题保留)。
  artifact-json 的 amber/green/blue 是 JSON 值类型语法配色(同代码高亮的"刻意特殊色")，按宪法 **保留**。
- **skills-manager-panel**：技能启停管理面板(177 行)，**不算过度设计**；gray 中性 + 蓝色启用开关 → 全 token 化(开关 on=primary)。

### route.tsx 对话页 chrome + 余组件审计 ✅ (2026-05-31)
- route.tsx 消息区"查看文件改动"按钮等 Craft-hex 中性 chrome → token(border/bg-muted/muted-foreground)。
- **审计确认本就干净(0 硬编码色，已合规)**：`streaming-markdown`、`context-badges`、`inline-image-preview`、
  `artifacts-panel`、`skill-chip`、`artifact-button` 及 artifact-csv/html/image/svg/react 渲染器 → 标 ✅查。
- **对话脸面(always-on-screen)的色彩统一基本完成**。剩余色债务集中在**二级预览 overlay**
  (`overlay/fullscreen|multi-diff|terminal|json|diff|code-preview`)：混中性 hex + 语义色(diff 增删、错误红、文件类型)，
  需逐个判断(diff 增删→success/destructive？文件类型色保留？)，放专门一批做。⬜
- 仍属结构/行为(非纯色)的 ⬜：用户气泡(C,对标 craft UserMessageBubble)、消息操作条(D4,对标 TurnCardActionsMenu)、
  streaming 不破版(D3.3,对标 CollapsibleMarkdownContext)、linkify(D3.4)。

### D1.4 — 过程区完成即折叠（注意力回到答案）✅改 (2026-05-31)
↳ 我方 `assistant-turn-card.tsx`：原 useEffect 只在 running 时 setExpanded(true)，完成后状态停在展开 → 过程步骤一直占屏、压住 final answer。
  修复：`else if (!isRunning && hasResponse) setIsExpanded(false)` —— running 看实时进度、done 收成一行摘要、答案主导；用户仍可手动点开看过程。
  对标 craft TurnCard 的 expand 策略(它也是完成后收起 + 可展开)。验证：真实工具任务完成瞬间 eval 确认 expandedTimelines=0(过程已折叠)且答案存在；build ✓。
  这是 D1.4「让注意力回到 final answer」的核心结构改动，呼应注意力优先级 #2。
