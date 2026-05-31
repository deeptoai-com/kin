# 权限模式设计 — 三档模型（Explore / 默认 / 执行）

> 日期：2026-05-31 · 作者：agent · 状态：小改已落地（PR #62），完整 Ask/HITL 属 Phase 3 Wave 2
> 关联：`PHASE3-PLAN.md` ③ HITL · 痛点来源：标准模式工具调用直接 AbortError

## 1. 背景与痛点（已验证）

Claude Agent SDK 0.1.76 的 `PermissionMode` 真实取值（查类型定义）：
`'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk'`
—— **没有 `auto`**（用户截图里的 "Auto mode" 是 Claude Code 客户端封装，非 SDK 原生）。

真实运行验证（探针打 Ark，每档跑一次"写文件"任务）：

| SDK 模式 | 文件写成 | 结果 | 说明 |
|---|---|---|---|
| `default` | ❌ | `error_during_execution` | **每个工具都要"问"，我们无 HITL 响应者 → 中止**（= 用户看到的 AbortError） |
| `acceptEdits` | ✅ | `success` | 文件编辑自动放行，**canUseTool 守卫仍生效** |
| `bypassPermissions` | ✅ | `success` | 全放行，但 SDK **不调 canUseTool → 守卫失效**（Risk #2） |

**根因**：worker 曾把 `sdkPermissionMode` 写死成 `default`，导致标准模式必然 abort。

## 2. 已落地的小改（PR #62）

worker 现在把模式映射到**非交互**的 SDK 模式（保证不 abort、且守卫在）：
- `plan` → SDK `plan`（只读）
- 其它一切 → SDK `acceptEdits`（编辑自动放行，canUseTool 仍跑，Bash 仍由 disallowedTools 管）
- `bypass` + `CLAUDE_DANGEROUS_DISABLE_GUARD=true` → 原生 `bypassPermissions`（仅调试）

效果：**标准使用不再 AbortError**（smoke-agent 真机 PASS）。这是三档模型的底座。

## 3. 三档产品模型（面向用户，隐藏 SDK 细节）

| 用户档 | 图标隐喻 | 行为 | 映射 SDK | 状态 |
|---|---|---|---|---|
| **Explore（探索）** | 🔍 / 望远镜 | 只读、出计划、不改文件 | `plan` | ✅ 现成 |
| **默认（Auto/智能）** | ⚡ / 默认 | 文件编辑自动放行，危险操作受守卫拦截；**不打断** | `acceptEdits` + canUseTool | ✅ 已是默认（PR #62） |
| **执行（Act）** | 🚀 | 放手干（含 Bash，若开放） | `bypassPermissions`（带守卫的非交互变体） | ✅ 现成 |

> 注意：把第二档命名为"默认/Auto/智能"而非"Ask"——因为它现在是**非交互自动放行**，不是真的"问"。
> 真正的"Ask（每步问你批准）"= 下面的 Wave 2。

## 4. Wave 2：真正的 "Ask" 模式（HITL 往返）

当前三档都是**非交互**的（要么自动放行要么只读）。真正的"危险操作前问用户批准/拒绝/编辑"需要：
- worker `canUseTool` 命中危险工具时**不直接 deny**，而是发一个 `permission_request` 帧给 ws-server → 前端;
- 前端弹审批 UI（approve / reject / edit），用户响应经 WS 回传 worker;
- worker 据响应继续 `query()`（SDK 的 `canUseTool` 回调本就支持异步返回 allow/deny）。
- 这会动 worker/ws-server 协议 → **单向门，实施前单独出小设计稿给负责人审**（PHASE3-PLAN §0 纪律）。

落地后，第二档可细分或新增"Ask"为第四态；或把"默认"做成"Auto = 智能判断，危险才 Ask"（最接近 Claude Code 的 Auto 体验）。

## 5. 多租户安全边界（守住护城河）

- **默认档(acceptEdits)仍跑 canUseTool** → path-security 跨租户/路径防护不丢（与 bypass 的关键区别）。
- **执行档**：默认仍走带守卫的非交互变体；只有显式 `CLAUDE_DANGEROUS_DISABLE_GUARD=true` 才真正裸 bypass（调试用，生产勿开）。
- **Bash**：默认禁用（`resolveDisallowedTools` 返回 `['Bash']`），除非显式开放。三档都受此约束。

## 6. 前端 UI（对接 Phase 3 设计语言）

- 输入框旁放模式切换（对标 Coze 底部的 Auto 下拉 / Claude Code 的 Mode 菜单）：**Explore / 默认 / 执行** 三选一。
- 默认选中"默认"。Explore 态可视觉上提示"只读"。
- 危险操作（Wave 2 后）触发审批卡片，嵌入对话流或右侧工作台。

## 7. 待负责人确认

1. 三档命名（Explore / 默认 / 执行）认可吗？还是要中文/英文别的叫法？
2. **默认档命名**：叫"默认 / Auto / 智能 / 标准"哪个？（行为是 acceptEdits 非交互）
3. Wave 2 的真 Ask（HITL）何时做、是否新增为第四档 vs 融进"默认"做成智能 Auto？
