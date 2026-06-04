# Ask / Act 权限模型 + HITL 审批 — 设计子文档（Phase 3 Wave 2）

> 日期：2026-06-04 ｜ 状态：**设计待评审 → 评审过后实现**
> owner 拍板：**完全对标 Claude Cowork —— 只有 Ask / Act 两档,砍掉 Plan/explore**。
> 理由:OxyGenie 是**纯 web、不在客户本地、全沙盒**——只读 Plan 无用武之地;且符合我们既定哲学(**安全=沙盒,档位=交互偏好**)。

---

## 0. 北极星 / 两档定义（对标 Cowork）

| 档位 | Cowork 文案 | 含义 |
|---|---|---|
| **Ask**（🖐) | Ask before acting — Claude pauses so you can approve each action | 每个"动作类"工具调用前**暂停,等用户批准/拒绝**(HITL) |
| **Act**（⏩) | Act without asking — Claude works without pausing for approval | **自主执行**,不打断 |

- 两档**能力相同**(都能改文件/执行代码),只差**打不打断你**(交互轴,不是能力轴)。
- **安全边界 = 沙盒**(srt / DockerBackend),对两档一致。Ask 额外加一道**人工闸**。
- **默认 = Act**(与现状一致;最少打断)。

---

## 1. 模型变更（3 档 → 2 档）

现状(`src/lib/permission-tier.js`):`explore→plan` / `auto→acceptEdits` / `act→acceptEdits`(auto≡act,死占位;explore 只读但漏 python)。

改为:
- 枚举 `['ask', 'act']`,`DEFAULT = 'act'`。
- **删除** `explore`/`auto`/`plan` 映射、`tierWantsBash`/`wantsBash`(R4 概念,随 explore 一并废)。
- **SDK permissionMode**(⚠️ 已被 spike 修正,见 §0-spike):
  - **Ask = SDK `default` 模式** —— 经 spike 验证:default 下 SDK **对每个工具调用 `canUseTool` 并 await 异步返回**(等了 15s/次没超时),deny 真的拦住工具。canUseTool **就是** responder,所以 default 完全可用(之前"default 会 abort"是没有 responder 的旧结论)。
  - **Act = SDK `acceptEdits`** —— spike 验证:acceptEdits **不调 canUseTool**(自动放行编辑),靠沙盒兜底。
  - 副发现:acceptEdits 下连路径安全的 canUseTool 也被跳过 → Act 的路径防护实际靠**沙盒 cwd fencing**,不靠 canUseTool。(记一笔,沙盒是边界,可接受。)
- 新增 `interactionMode: 'ask' | 'act'` 贯穿 前端 → ws-server → worker(取代 `permissionTier`/`wantsBash`)。

---

## 2. HITL 审批往返架构（本轮核心）

### 2.1 拦截点 = `canUseTool`
worker 已有 `canUseTool`(现做路径安全)。改造成**组合闸**:
```
canUseTool(toolName, input):
  1) 路径/租户安全检查(始终)——不安全 → 硬 deny(与档位无关)
  2) Act 模式 → allow(沙盒兜底)
  3) Ask 模式:
       - 只读工具(Read/Grep/Glob/LS…)→ allow(不打断)
       - 动作类工具(Write/Edit/MultiEdit/NotebookEdit/Bash/mcp__bash__run/
         mcp__python__run/mcp__glm-image/…)→ 发 approval_request,**await 用户决定**
```

### 2.2 消息协议(新增)
- **worker → UI**(经 ws-server 透传,沿用现有帧通道 + `seq`):
  `{ type: 'approval_request', toolCallId, toolName, summary, input }`
- **UI → worker**(经 ws-server 回写 worker stdin):
  `{ type: 'approval_response', toolCallId, decision: 'allow' | 'deny' }`

### 2.3 worker stdin 协议改造(关键,最大改动点)
现状:worker 累积全部 stdin → `on('end')` 解析一次 → 跑;ws-server `write(request); end()`。
改为**行分隔、stdin 保持打开**:
- ws-server:`worker.stdin.write(JSON.stringify(request)+'\n')`,**不 end**(留通道发审批);需要发 `approval_response` 时再 `write(line)`;abort/清理时才 end。
- worker:逐行读 stdin。**第一行 = 初始 request**(启动 run);**后续行 = 控制消息**(`approval_response` → 解析 `toolCallId` → resolve 对应 pending promise;`abort` → 取消)。
- `waitForApproval(toolCallId)` = `Map<toolCallId, resolve>`;收到 response 行 → resolve。

### 2.4 ws-server 路由
- 透传 worker 的 `approval_request` 帧给前端(已有 stdout→WS 转发,加该帧类型即可)。
- 新增入站 `approval_response`(InboundMessage)→ 找到该 ws/session 的**活跃 worker** → 写进它的 stdin。需维护 `ws → activeWorker` 映射(spawn 时记,退出时清)。

### 2.5 前端
- `ws-adapter`:收 `approval_request` 帧(像 `preview_state` 那样在持久 socket 上处理)→ 写进 store 的 `pendingApprovals`;发 `approval_response`(新增导出 `respondApproval(toolCallId, decision)`)。
- store:`pendingApprovals: ApprovalRequest[]` + add/remove。
- UI:审批卡(工具名 + 摘要 + **批准/拒绝** 按钮),在 thread 里或 composer 上方;点击 → `respondApproval` → 移除。
- 档位选择器(composer):3 项 → **2 项 Ask/Act**(图标 + Cowork 文案),发 `interactionMode`。

### 2.6 超时 / 中止 / 默认(安全)
- **暂停即暂停**:Ask 下 agent 阻塞在 canUseTool 等用户;不自动放行。
- **Stop/abort**:拒绝所有 pending(deny)+ 取消 run。
- **可选安全超时**(配置,默认大,如 10min)→ deny + 提示"审批超时"。
- **默认 deny**:任何异常/通道断 → deny(安全优先)。

---

## 3. 文件清单

| 文件 | 改动 |
|---|---|
| `src/lib/permission-tier.js` | 2 档(ask/act);删 explore/auto/plan/wantsBash;`interactionMode` |
| composer 档位选择器(`a2composer-panel.tsx` / `chat-composer.tsx`) | 3→2 档 UI + 发 `interactionMode` |
| `ws-server.mjs` | 映射 mode;stdin 保持打开;透传 `approval_request`;入站 `approval_response`→写 worker stdin;`ws→activeWorker` 映射 |
| `ws-query-worker.mjs` | 行分隔 stdin;HITL `canUseTool`(组合闸 + 审批 await);pending Map;needsApproval 名单 |
| `src/claude/adapters/ws-adapter.ts` | 收 `approval_request`→store;发 `approval_response`;`InboundMessage`/`OutboundMessage` 变体 |
| `chat-session-store.ts` | `pendingApprovals` slot + actions |
| 新增审批卡组件 | 批准/拒绝 UI |
| `src/claude/path-security.js`(若需) | 确认 canUseTool 组合不破坏现有路径安全 |

---

## 4. 迁移 / 取代

- **删 explore/auto/plan**;`permissionTier`/`wantsBash` → `interactionMode`。
- **R4(#69)由本次"删 explore"解决**(没有只读档可漏);**PR #108(wantsBash 补丁)已关闭、作废**。
- **python 越权洞作废**:无 explore;Ask/Act 下 python/bash 都在(沙盒兜 + Ask 逐步批准)。
- 旧的"3 档"残留(STATUS/文档/UI 文案)一并清理。

---

## 5. 验收

- 档位选择器只剩 **Ask / Act**(Cowork 文案/图标)。
- **Act**:发任务 → agent 自主跑(写文件/执行),不打断。
- **Ask**:发任务 → 每个动作类工具调用前**弹审批卡**;点**批准**→执行,点**拒绝**→跳过且 agent 知道被拒;只读工具不打断。
- **Stop**:拒绝所有 pending 并停止。
- 路径/租户安全在两档下都生效(不安全操作直接 deny,不进审批)。
- 不回退 S1/S2(单源、Workbench、turn 卡)。

---

## 6. 风险 / 注意

- **stdin 行协议改造**是最大风险点:worker 从"一次性读"改"长连行读",要处理半行缓冲、初始 request 与控制消息区分、stdin 不再 end 的清理(worker 退出/超时/abort)。
- **SDK `canUseTool` 是否支持 async + 长时间 await**:需确认 0.2.112 的 canUseTool 允许 await 用户(理论上 Promise 即可,但要验证不被内部超时打断)。**实现前先写个最小 spike 验证 canUseTool 能 await 数十秒并按返回值放行/拦截。**
- **resume/abort 交互**:Ask 暂停中 abort → 要干净取消(deny pending + 杀 worker)。
- **多 pending**:一轮里可能连续多个工具 → 串行审批(SDK 通常一次一个 canUseTool)还是并发,需按 SDK 行为定。
- **needsApproval 名单**:先按"动作类要批、只读放行"。名单后续可配置。

---

## 7. 实现前的 spike —— ✅ 已做,通过(2026-06-04)
`scripts/spike-canusetool.mjs`(已跑后删除)验证:
- **`default` 模式**:SDK 对每个工具调用 `canUseTool`,**await 异步返回 ~15s/次不超时**;返回 `{behavior:'deny'}` **真的拦住**工具(目标文件未创建)。**HITL 地基成立。**
- **`acceptEdits` 模式**:canUseTool **0 次调用**(自动放行编辑)→ 故 **Ask 必须用 `default`,Act 用 `acceptEdits`**。
- 观察:被拒后 agent 会换工具重试(Write 拒→改 Bash);每个动作都被独立 gate(符合"逐动作审批")。被拒不结束 run(会耗 turn);真实 Ask 下用户批准即正常推进。
- 结论:**按本文档实现,Ask=default + canUseTool(动作类→发 approval_request 并 await;只读→放行)。**
