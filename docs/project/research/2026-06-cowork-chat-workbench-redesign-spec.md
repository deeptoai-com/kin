# 实施规格：Cowork-faithful 聊天 + Workbench 单源重做

> 日期：2026-06-04 ｜ 状态：**已定方向（owner 选 A）**，待**专门对话**按本规格实现
> 关联：`2026-06-workbench-artifact-ordering-fix-plan.md`（诊断 + IA）、`2026-06-real-preview-*`（真预览 = Phase C 沙盒，**不在本规格**）。
> 北极星：**完全对标 Claude Cowork**——左侧透明 agent 流、右侧栏**实时**进度/文件/上下文、渐进式披露、一次到位不留半成品。

---

## 0. 目标（验收即「优雅」的定义）
1. **右侧 Workbench 实时**：跑的过程中 Progress 计划逐条勾、Files 实时增长、Context/Sub-agents 实时更新（**无需刷新**）。— Cowork 标志。
2. **消息严格按真实顺序**；resume 后历史与新消息**不交错、不重复、不两套**。
3. **左侧 Cowork 式渲染**：过程（推理+工具步骤）实时显示→**turn 完成自动收起**为一行摘要（"Worked Xs · N steps ▸"）；主体只留**最终答案 + 至多一张交付物卡**。
4. 过程信息**完成即收起**（push 可折叠），导航/索引（Files/Progress/Context/Sub-agents）在右侧 **pull**。

---

## 1. 根因（为什么现在做不到，已核实）
- **两套消息存储未打通**：
  - 历史 = zustand `chat-session-store.messages`，**只在 resume/刷新时由 `loadHistoricalMessages` 填**（`route.tsx:249/401/1039`）。
  - 实时 = assistant-ui `useLocalRuntime(ClaudeAgentWSAdapter)`（`route.tsx:1038`），**不写进 store**。
  - 渲染是**两段**：历史 `historicalMessages.map`（`1460`）+ 实时 `<ThreadPrimitive.Messages>`（`1470`）。
- **Workbench 在 `AssistantRuntimeProvider`(`1400`) 之外**（渲染于 `570/842`）→ 结构上拿不到实时消息，只能读历史 store → **刷新才有**。
- **无事件序号**：worker→ws→UI 全靠 JS 到达顺序（`ws-server.mjs:745` 不加 seq；`ws-adapter.ts:761` 只 push）→ 乱序。
- `messages_loaded` 双处理（`ws-adapter.ts:524-531`，queue switch 无该分支）。

---

## 2. 目标架构：单一实时真相源
**`chat-session-store.messages` 成为唯一有序消息列表，左侧流 + 右侧 Workbench 都读它。**

推荐用 **assistant-ui 的 `useExternalStoreRuntime` 替换 `useLocalRuntime`**：让我们**自己持有消息数组（在 zustand）**，assistant-ui 从中渲染。这是 assistant-ui 官方「自管消息」模式，天然消除「双轨渲染 + Workbench 在 provider 外」两个病根。
- 实时 deltas 由 ws-adapter **写进 store**（不再只喂 runtime）。
- 历史 `loadHistoricalMessages` 也**合并进同一个列表**（按 message id 去重、按 seq 排序）。
- 左侧 Thread 渲染 = 这个列表；右侧 Workbench 的 `useSessionTodos/SubAgents/Files/Context`（已存在，读 store）**自动变实时**——`WorkbenchPanel` 摆位不再受 provider 限制（它读 store，不读 runtime）。

> 若评估后认为不换 `useExternalStoreRuntime` 成本更低：**退而求其次** = 保留 LocalRuntime 但把实时消息**镜像进 store**，并把左侧渲染也改为读 store（单源），Workbench 随之实时。但 externalStore 是更干净的终态，优先。

---

## 3. 事件顺序
- **worker 加单调 `seq`**（`ws-query-worker.mjs` 每个发出的事件 +1）。
- `ws-server.mjs` 透传 `seq`。
- store 合并时**按 seq 排序、按 message id 去重**；turn 内 parts（text / tool_use / tool_result）按 seq 维序。
- **删除 `messages_loaded` 双处理**（只走一条：写进 store）。

---

## 4. 渲染模型（Cowork IA：什么实时显示、什么完成收起）
| 内容 | 性质 | 处理中（live） | 完成后 | 位置 |
|---|---|---|---|---|
| 最终答案文本 | 交付物 | 流式 | **保留** | 左侧 turn 卡主体 |
| 生成的 App/文档/图（artifact） | 交付物 | 末尾浮现预览卡 | **保留**（每轮一张，已做 A3） | turn 卡顶 + 右侧 Files/Preview |
| 推理 thinking | 过程 | 弱化流式 | **收起**「Thought ▸」 | turn 卡内可折叠 |
| 工具步骤（Read/Write/Bash/Task/ToolSearch…） | 过程 | 实时一行状态 | **收起**「Worked Xs · N steps · 改 K 文件 ▸」 | turn 卡内可折叠组 |
| 计划/Todos | 过程+导航 | **实时逐条勾** | 折叠「计划 N/N ✓」 | 右侧 **Progress**（实时） |
| 子代理 | 过程 | 实时 | 折叠摘要 | 右侧 **Sub-agents**（实时） |
| Files（workspace 内文件） | 交付物索引 | **实时增长** | 保留 | 右侧 **Files**（实时） |
| Context（模型/连接器/用量） | 元信息 | 实时 | 保留 | 右侧 **Context**（实时） |

要点：左侧主体永远只留「答案 + 交付物卡」；过程一律收进**一个**可折叠组，turn 一结束自动折叠（用 `result`/done 事件作为「turn 完成」信号）。**历史渲染必须走同一套**（当前历史渲染散成一堆「步骤已完成」就是因为没走同一渲染路径——单源后天然统一）。

---

## 5. 具体改动清单（文件 → 职责）
| 文件 | 改动 |
|---|---|
| `ws-query-worker.mjs` | 每个发出的事件加单调 `seq`。 |
| `ws-server.mjs` | 透传 `seq`；移除 `messages_loaded` 转发进 queue 的死路径。 |
| `src/claude/adapters/ws-adapter.ts` | 实时 deltas **写进 `chat-session-store`**（externalStore 模式的 onNew/onUpdate）；带 seq；不再只喂 LocalRuntime。 |
| `src/lib/chat-session-store.ts` | `messages` = 单一有序列表；合并 live+历史（按 id 去重、按 seq 排）；turn 完成标记（供折叠）。 |
| `src/routes/agents/claude-chat/route.tsx` | 换 `useExternalStoreRuntime`；**删双段渲染**（1460 历史 + 1470 runtime → 单源）；Workbench 摆位无所谓（读 store）。 |
| `src/components/claude-chat/assistant-turn-card.tsx` | Cowork 式 turn 卡：步骤分组 + 完成折叠 + 摘要行；历史/实时同一组件。 |
| `src/lib/hooks/use-session-workbench.ts` | **不用改**（已读 store；单源后自动实时）。 |
| `src/components/claude-chat/workbench-panel.tsx` | 基本不用改（Files/Context 已接，Phase B）。 |
| `src/lib/hooks/use-artifact-detection.ts` | 取消被动探测时 `setActiveArtifact` 自动弹面板（仅点击时开）；A3 去重已完成。 |

**结构化输出泄漏**（"Stop hook feedback: You MUST call the StructuredOutput tool"）：经查这是 **Claude Agent SDK 的 `outputFormat` 强制机制**（非本仓库代码），由 `ENABLE_STRUCTURED_OUTPUTS=true` 触发，会**多跑一轮 + 漏进对话**。处理：① 临时 `ENABLE_STRUCTURED_OUTPUTS=false`（最简，建议在真预览/artifact 重做前先关）；或 ② 在 adapter/store 过滤该 stop-hook 消息不渲染。**根治随 artifact/结构化输出策略一起定**（与 Phase C/SDK 线相关）。

---

## 6. 分步（建议 PR 序，每步真机实测）
1. **S1 单源根基**：`useExternalStoreRuntime` + store 单一有序列表 + ws-adapter 写 store + seq + 删双渲染。→ 顺序对 + **Workbench 实时**（最大收益，含你报的 bug）。
2. **S2 Cowork turn 渲染**：turn 卡分组 + 完成折叠 + 摘要；历史/实时同组件。
3. **S3 收尾**：artifact 不自动弹面板；结构化输出泄漏处理（或 env 关）。

> S1 是地基且最重，单独 PR、配合「重启→测→反馈」闭环逐步验证。

---

## 7. 验收
- 跑任务时**右侧栏实时**（Progress 逐条勾 / Files 实时增长 / Context 实时），**全程不刷新**。
- 消息顺序正确；resume 后不交错/不重复。
- 左侧每轮 = 答案 +（可选）一张交付物卡 + 一个折叠「运行过程」；过程完成即收起；**历史与实时观感一致**。
- 不再有自动弹出的成果物面板、不再漏出 StructuredOutput 内部消息。

## 8. 留给执行者的决策点
1. `useExternalStoreRuntime` 替换 vs LocalRuntime+镜像——优先前者，落地前快速验证 assistant-ui 版本 API。
2. `ENABLE_STRUCTURED_OUTPUTS` 是否在本轮直接关（建议关，等 artifact/Phase C 再定）。
3. assistant-ui 的 Thread/Composer 原语保留多少（输入、isRunning、滚动等可继续用，仅消息**列表来源**改为 store）。
4. 真预览（多文件 App 跑起来）是 **Phase C 沙盒**，**不在本规格**——本规格只解决「聊天流 + Workbench 的数据源与渲染」。
</content>
