# Cowork 单源重做 — S1 评审报告 + S2/S3 交接简报

> 日期：2026-06-04 ｜ 角色：评审（非实现者） ｜ 状态：**S1 已实测通过并合并 `main`**
> 关联：`2026-06-cowork-chat-workbench-redesign-spec.md`（原始实施规格）、`docs/project/STATUS.md`（决策日志）
> 给谁看：**S1 的原实现者**（继续 S2/S3 的人）

---

## 0. TL;DR

- 你交付的 **S1（单源根基）方向与主体实现是对的**：`useExternalStoreRuntime` + `chat-session-store.messages` 单一有序真相源 + ws-adapter `runChat()` 写 store + `seq`。**Workbench 实时**这个最大收益拿到了。
- 评审（owner 真机实测）暴露了 **6 个问题**，我已逐个修复、每次重建+重启+owner 复测、最终**合并进 `main`**。下面列清楚“是什么/根因/怎么修/在哪”。
- **剩余 S2/S3 交还给你**。⚠️ **动手前务必先 `git pull --rebase origin main`**——S1 相关文件我都改过（见 §3），不同步会冲突（违反“同一文件不双人编辑”）。
- **Phase C（多文件 App 真预览）另有其人，本线不碰。**

---

## 1. 已合并的提交（`main`，按时间序）

| commit | 内容 |
|---|---|
| `ada1939` | feat(chat): S1 — single-source chat + realtime Workbench（**你的实现**） |
| `0b3b136` | fix: converter 只在 assistant 角色带 `status` |
| `e15b0d4` | fix: 取消成果物自动弹面板（仅点击开） |
| `dd78d85` | fix: 文本兜底卡 vs Write 卡去重（升级临时卡） |
| `f6bdf9b` | fix: 历史按轮合并 + React 预览守卫 |
| `5394c5d` | fix: 每轮一张交付物卡（删重复的 `ThreadArtifactCallout`） |
| `8bef75a` | merge 入 `main` ｜ `5718292` docs(status) |

---

## 2. 评审发现的问题（根因 + 修复）

### P1 — 发消息即崩 “status is only supported for assistant messages”
- **根因**：externalStore 的 `convertStoreMessage` 给**每条**消息都带了 `status`；assistant-ui 只允许 assistant 消息带 `status`，user 消息一带就抛。
- **修复**：转换器仅在 `role === 'assistant'` 时带 `status`。`route.tsx convertStoreMessage`。

### P2 — 成果物面板自动弹出，盖住右侧 Workbench
- **根因**：`use-artifact-detection.ts` 在**被动探测**时调用 `setActiveArtifact(...)` 自动打开面板（6 处）。成果物与 Workbench 共用右栏 → 自动开就看不到 Workbench。
- **修复**：删除全部被动 `setActiveArtifact` 调用（+ 现已无用的绑定/deps）。`createArtifact` 仍在 → 卡片照常出现，**仅用户点「打开成果物」才开**。

### P3 — 同一交付物出现两张卡（turn 内）
- **根因**：模型在文本里先吐 ```html``` 代码块（Write 工具还没完成）→ Method 2 文本兜底建了张**临时卡**（无 filePath → “HTML 成果物”）；随后 Write 完成 → Method 1 `getArtifactByFilePath` 未命中 → 又建一张文件卡。
- **修复**：Method 1 在无 filePath 命中时，若存在该 message 的**临时卡**就**就地升级**（补 sourceFilePath/content/fileName、清 isTemporary），不再新建。`use-artifact-detection.ts`。

### P4 — 刷新后整轮碎成一堆「步骤已完成」+ 多张重复卡 + 大空隙（**最关键**）
- **根因**：`loadHistoricalMessages` 把**每条 SDK 消息**转成**一条 store 消息**。但 Claude Agent SDK 一轮会发很多条 `assistant` 消息（每段文字/每个工具一条），`tool_result` 还单独走 `user` 消息 → 一轮被拆成 N 条 → N 张 turn 卡，每条各自做一次成果物探测 → 多张重复卡 + 大段间距。**而直播 `runChat()` 是累积进一条消息**，所以“直播一张卡、刷新一堆卡”——历史≠实时。
- **修复**：`loadHistoricalMessages` 改为**按轮合并**——把一轮的 assistant/工具消息累积进**一条** store 消息（`tool_result` 回填进对应 tool-call part，共用新抽出的 `resolveToolResult` helper），遇到真正的用户文本消息才收尾换轮。历史与实时**渲染完全一致**。`chat-session-store.ts`。

### P5 — 打开成果物报 “Something went wrong”
- **根因**：`ARTIFACT_EXTENSIONS` 把 `.js/.ts` 归为 `react`，`artifacts-panel` 对 `react` 用 Sandpack **react 模板执行**。你那 `app.js` 是原生 DOM 脚本（`getElementById(...).addEventListener`），被当成 React 入口挂载 → `Cannot read properties of null` → Sandpack “Something went wrong”。
- **修复**：`artifact-react.tsx` 加守卫——内容不像自包含 React 组件（无 `import react`/`export default`/`return <`）就**只读代码展示**，只有真正的组件才进 Sandpack。（叠加 P4 后，本例主交付物变成 `index.html`，走 HTML 预览，本就不会触发。）

### P6 — 仍是两张卡（全局重复）
- **根因**：有**两个**成果物卡组件渲染同一个 artifact：① 旧的全局 `ThreadArtifactCallout`（`useThread` 扫最近 assistant 消息，带文件名 → “index.html”）；② 每条消息内联的 `ArtifactButton`（只传了 `type` → 泛化“HTML 成果物”）。
- **修复**：删 `ThreadArtifactCallout`（`useLocalRuntime` 时代遗留，单源后多余）；保留 turn 内联卡并补传 `title/fileName/filePath/isTemporary`，显示真实文件名。`route.tsx`。

---

## 3. 我改过的文件（你 rebase 后接着写要注意）

- `src/routes/agents/claude-chat/route.tsx`（P1/P6）
- `src/claude/adapters/ws-adapter.ts`（S1 本体，未在评审中改逻辑）
- `src/lib/chat-session-store.ts`（P4：新增 `resolveToolResult` + 重写 `loadHistoricalMessages`）
- `src/lib/hooks/use-artifact-detection.ts`（P2/P3）
- `src/components/claude-chat/artifact-react.tsx`（P5）

**先 `git pull --rebase origin main`，再开 S2/S3 分支。**

---

## 4. 交还给你的工作：S2 / S3

### S2 — Cowork turn 卡渲染收尾（锦上添花）
落点：`src/components/claude-chat/assistant-turn-card.tsx` + `src/lib/turn-builder.ts`
1. **折叠头摘要**：现在折叠头是 `<Tag>{renderItems.length}</Tag> + previewText`（≈“N · 步骤已完成”）。改成 Cowork 式 **「Worked Xs · N steps · 改 K 文件 ▸」**。耗时/步数/改动文件数在 `buildAssistantTurn` 里算（tool-call parts 的 `elapsedSeconds`、Write/Edit 计数），头部渲染在 `assistant-turn-card.tsx:583-599`。
2. **thinking/intermediate 去重**：评审时见到同一段 reasoning 文本重复出现两行（“I need to create a todo list webpage…” ×2）。在 `buildAssistantTurn` 合并/去重连续重复的 reasoning/intermediate activity。
3. 历史/实时同组件（P4 合并后天然成立，verify 即可）。

### S3 — 结构化输出泄漏处理
- **现象**：会话里漏出 “Stop hook feedback: You MUST call the StructuredOutput tool” 内部消息，且多跑一轮。
- **根因**：Claude Agent SDK 的 `outputFormat` 强制机制，由 `ENABLE_STRUCTURED_OUTPUTS=true` 触发（非本仓库代码）。
- **现状**：目前**启动时 `ENABLE_STRUCTURED_OUTPUTS=false` 规避**（不要写进 `.env`，按规则只在启动命令覆盖）。
- **根治选项**：① 维持关闭，等 artifact/结构化输出策略整体定（与 Phase C 线相关）；或 ② 在 `ws-adapter.ts`/store 过滤该 stop-hook 文本不渲染。建议与 owner 确认 artifact 策略后再定。

### 可选清理（非阻塞）
- `ARTIFACT_EXTENSIONS` 仍把 `.js/.ts` 归为 `react`。P5 守卫已兜住，但更干净的做法是引入独立的 `code` 成果物类型（只读高亮），把“可执行预览”收敛到真正可跑的类型。需与 owner 对齐后再做。

---

## 5. 验收（S2/S3）

- 折叠头是「Worked Xs · N steps（· 改 K 文件）」摘要；展开仍可见每步；**完成自动折叠**。
- 无重复 thinking 行；历史与实时观感一致。
- 不再漏出 StructuredOutput 内部消息。
- 回归：S1 验收项不退化（Workbench 实时 / 顺序 / 每轮一张交付物卡 / 打开不崩）。

---

## 6. 边界（明确不在本线）

- **真预览（多文件 App 跑起来）= Phase C 沙盒，另有其人。** 现在打开 `index.html` 是单文件静态预览，不联动外部 css/js——既定 v1 边界，不是 bug。
