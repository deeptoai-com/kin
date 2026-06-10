# 执行报告：续聊即分支(branch-on-reply)后端集成 — 待 Codex Double-Check

> 日期：2026-06-08 ｜ 状态：**后端实现完成、静态校验通过、集成层未活体验证** ｜ 分支：`feat/projects-ui-shell`（未提交）
> 审阅目标：这是 Projects 功能里**最敏感、且无先例**的一块——在生产 `ws-server.mjs` 里做 SDK fork 分支。请重点核查正确性、安全性、边界与未测路径。

---

## 0. TL;DR（给审阅者）

- **要实现的业务**：项目 X 的成员 B 能**看**到 owner A 的会话 D1；B **不能写入 D1**；B 一旦在 D1 里尝试回复，就**自动 fork 成 D2**（带 D1 全量上文、归 B 所有、标题「分支·D1」、落在同一 Project），原 D1 不动。D2 出现在项目会话列表，A 也能看到。= ChatGPT 的 branch-on-reply，= PRD「续聊即分支」。
- **核心机制**：SDK `0.2.112` **原生支持 fork**（`query({ resume, forkSession:true })`）。已**活体验证**（见 §3）：fork 返回新 sessionId、复制全量 transcript、重写内部 sessionId、原文件不动、**纯本地无需 ARK**。
- **本次范围**：**后端**（ws-server + worker + session API + schema）。**前端分支 UX 不在本次**（C#2，单列）。
- **最大风险**：**完整 ws-server 分支链路无法在本地集成测试**（本地 prod 不起 WS/worker，需真实 ARK + 运行栈）。已验证：① 静态（typecheck/node --check）；② fork 机制（standalone）。**未验证：分支创建 → fork → 捕获 forked id → 落库 D2 → session_init 的端到端流。** 这是 Codex/团队必须集成验证的点。

---

## 1. 任务与业务逻辑（owner 原话）

owner 明确的语义（2026-06-08）：

> A 在项目 X 中开了对话 D1，A 和 B 都能看到 D1 的聊天内容。
> B 能看 D1，但 **B 不能往 D1 里写入**。B 在 D1 里要试图写入时，**自动开启 D2（带着 D1 的上文）= 开分支**。会话标题一定有「分支·D1」；此时「分支·D1」出现在项目会话列表，A 也能看到。这就是 branch-on-reply。

确认的设计约束：
- 分支**带全量上文**（从最新一条分），中间某条消息分**留作后续**。
- **A 在自己的 D1 里回复 = 正常续写（不分支）**；**只有「非 owner 回复」才分支**。

方案选型（owner 拍板走 C）：A=只共享文档不共享会话 / B=完全共享会话(需 per-session 写锁) / **C=只读共享 + 续聊即分支**。C 因为「B 永不写 D1、只写自己的 D2」**从根上绕开并发写**，无需锁——这也是 PRD 选分支的原因。

---

## 2. PRD 与上下文

**来源 PRD**：`docs/project/prd/2026-06-projects-collaboration-prd.md`
- Model A（容器即权限，无逐文件 ACL）；owner/member 两角色；**单一访问解析器**取代散落的 `WHERE user_id`。
- 场景 1 = **续聊即分支（ChatGPT branch-on-reply）**，不做实时协同。`agent_session + branched_from_session_id + created_by_user_id`。
- §9 风险：**最大工程量 = 把全站 user_id 查询改成解析器**；漏一处 = 越权可见。

**两轮独立审计**（2026-06-08，本次工作前置）一致指出：之前的 P1 是「happy-path 脚手架」——**解析器只接了 1/7 的会话读路径**，成员能在列表里看到共享会话但**打不开**（其余读路径仍 `WHERE userId`），且 session 文件在 `/data/users/{owner}/` 下。两位审阅都把这列为 #1 问题。

**已完成的前置（步骤 A，本报告不重复细节，但分支依赖它）**：
- 单一解析器：`src/server/projects/access-logic.ts`（纯函数，DB-free，有单测）+ `src/server/projects/access.ts`（DB 包装）。
- **会话读路径扫尾**：`$id.ts`/`by-sdk-id.$sdkId.ts`/`workspace-session.ts`/`message-attachment.server.ts` 全部改成 **load-then-authorize**（`canAccessSession` 读 / `canMutateSession` 改），不再 `WHERE userId`。这让 **B 能 resume/查看 D1**——是分支的前提。
- 单测 `tests/unit/projects-access.test.ts`（「非成员看不到」回归，10 用例，全过）。
- schema `0024`（project/project_member/agent_session.project_id）。
- **关键存储事实**：`/data/users/*` 全部属 **同一 uid（1001 nodejs）**，ws-server + worker 都以该 uid 跑——**没有 OS 级 per-user 隔离**，任意 worker 能读写任意 session 目录。这是「分支无需搬数据」成立的基础。

---

## 3. Spike：原生 fork 已活体验证

`@anthropic-ai/claude-agent-sdk@0.2.112` 暴露两条 fork：
- `query({ resume, forkSession:true })`（流式，本次用这条）——`.d.ts`：「resumed sessions will fork to a new session ID rather than continuing」。
- `forkSession(sessionId,{ dir?, upToMessageId?, title? })`（独立函数；`upToMessageId` → 未来「从中间分」原生支持）。

`sdk.mjs`/`assistant.mjs`/`cli.js` 三处都有 `forkSession` 实现 + `--fork` flag，**非 stub**。

**活体测试**（用真实 73 行会话，offline，HOME 指向临时 home）：
```
forkSession('29930b00-…',{title:'分支·test'}) → { sessionId:'47a973b2-…' }
```
- 新 JSONL 生成在原文件旁，**原文件不动**；
- fork 文件 65 行 = 全量对话（21 user + 41 assistant + 2 attachment + 1 custom-title）；
- **fork 里所有行的 sessionId 都被重写成新 id**（distinct sessionIds = {新 id}）——不需手动改写 JSONL；
- **纯本地、无需 ARK**（fork 是本地会话文件操作，不是 LLM 调用）。

→ 分支播种 = `forkSession` 一次调用，最高保真。

---

## 4. 架构与关键设计决策

### 4.1 数据流（B 在 D1 回复 → 生成 D2）
```
B 发 chat(content, sessionId=D1) → ws-server handleChat
  existingSession = loadSessionFromDb(D1)          // by-sdk-id，A2 已放行成员
  isBranch = (!silentInit && D1.userId !== ws.userId)   // B≠A → 分支
  outputSessionId = 新 id (D2)
  effectiveResumeSdkId = D1.realSdkSessionId        // resume D1 的 transcript
  claudeHome = D1.claudeHomePath (= A 的 home)       // fork 落在 A 的 home
  workspacePath = getSessionWorkspace(D1.userId, D1.sdkSessionId)  // 共享 D1 工作区
  title = 分支·<D1.title>
  ── 预建 D2 ── persistSession(outputSessionId, null, claudeHome, 分支·title,
                              { projectId: D1.projectId, branchedFromSessionId: D1.id })
  ── 起 worker ── request{ sdkResumeId: D1.realSdkSessionId, forkSession:true, prompt:B的消息 }
       worker: query({ resume: D1.realSdkSessionId, forkSession:true, ... })
       → init 事件的 session_id = 新 forked id
  ws.workspaceSessionId = outputSessionId (D2)       // 捕获重定向到 D2
  init 捕获: sessionMapping.set(D2, forkedId); persistSession(D2, forkedId, …) // 更新 D2.realSdkSessionId
            sendMessage session_init{ sessionId: D2 }  // 客户端切到 D2
```

### 4.2 存储模型（为什么这样）
- **D2 的 transcript** fork 进 **A 的 claudeHome**（worker HOME=A 的 home），落在 **D1 的 cwd 工程目录**下（因为 fork 时 cwd=D1 工作区）。D2.claudeHomePath 存 = A 的 home。**同 uid → B 的 worker 能读写**。
- **D2 共享 D1 的工作区（cwd）**。原因：forked transcript 里**文件路径是绝对路径、指向 D1 工作区**；若给 D2 新工作区，这些路径就失效（拷贝也会破坏绝对路径）。共享 = 路径一致、最简。**代价**：B 在分支里改文件会动到 A 的 D1 工作区(语义上分支非完全隔离)——对话型分支影响小，已在代码注释标注；真隔离留作 v1.1。
- **续聊 D2**（B 二次发消息）：`isBranch=false`（B owns D2），但 cwd 必须仍 = D1 工作区，否则 SDK 在 D2 的 cwd 工程目录找不到 D2.jsonl。→ §C1e：发现 `existingSession.branchedFromSessionId` 时，**load 源会话 D1，用 D1 的工作区**。

### 4.3 并发
分支模型下 B 永不写 D1，只写 D2；A 写 D1。**transcript 无并发写**，无需 per-session 锁。唯一共享可变面 = 工作区文件（见上，已知取舍）。

---

## 5. 逐文件改动（本次 = C1）

| 文件 | 改动 | 要点 / 审查点 |
|---|---|---|
| `src/db/schema/agent-session.schema.ts` | 加 `branched_from_session_id`（自引用 FK，`ON DELETE set null`，`AnyPgColumn`）| `created_by_user_id` **故意不加**——分支模型下每会话单作者(= userId)，冗余 |
| `drizzle/0025_round_marvel_boy.sql` | 生成：ADD COLUMN + 自引用 FK | **未应用到任何库**（需 `drizzle-kit migrate`）|
| `src/routes/api/agent-sessions/index.ts` (POST) | 接受 `projectId` + `branchedFromSessionId`，**仅 CREATE 时**写入，且**校验**：projectId 必须 ∈ accessibleProjectIds；branchedFrom 必须 canAccessSession。否则 403 | **安全核心**：不信任客户端传的 lineage。UPDATE 路径不动这两字段 |
| `ws-query-worker.mjs` | 解构加 `forkSession`；query options 加 `...(forkSessionFlag && sdkResumeId && { forkSession:true })` | fork 必须与 resume 并存 |
| `ws-server.mjs` `persistSession` | 加可选第 6 参 `lineage={projectId,branchedFromSessionId}`，透传给 POST | 既有 2 处调用传 5 参 → lineage=null，**向后兼容** |
| `ws-server.mjs` `loadSessionById` | 新增：按内部 id 取会话（GET `/$id`，受 canAccessSession 门控）| 用于续聊时解析分支源 |
| `ws-server.mjs` `handleChat` | **核心 6 处**：①isBranch/outputSessionId/effectiveResumeSdkId（替换 A3 拦截块）②分支标题 ③3-case 工作区派生 ④预建 D2 ⑤worker request 用 effectiveResumeSdkId + forkSession ⑥`ws.workspaceSessionId = outputSessionId` | 见 §4.1 数据流 |

A3（上一步加的「非 owner 写 → 拒绝」临时拦截）**已被分支逻辑替换**。

---

## 6. 不变量 / 边界（请逐条核）

1. **viewing 不经 handleChat**：B 看 D1 走 `resume` case（只读，发 transcript），不触发分支。分支只在 `chat`（真实发言）触发。✔ 设计如此，但请确认前端 viewing 确实发 `resume` 而非 `chat`。
2. **silentInit 豁免**：`init_session`（silentInit=true）不分支。✔
3. **owner 续写不分支**：A 发 chat 到自己的 D1 → D1.userId===ws.userId → isBranch=false。✔
4. **分支的分支**：B 的分支 D2 若被 C(另一成员) 回复 → C≠B(D2.userId) → 再 fork 成 D3，标题 `分支·` 单前缀（`.replace(/^分支·/,'')`）。✔
5. **lineage 越权**：POST 校验 projectId 成员资格 + branchedFrom 可见性，非法 403。**请重点核**：D2 的 projectId 取自 `existingSession.projectId`(D1 的)——B 既能 resume D1 说明 B 是该 project 成员，故 B 必然 ∈ accessibleProjectIds，校验会过。逻辑自洽，但请确认无绕过。
6. **续聊工作区**：D2 续聊 load D1 取工作区；若 D1 被删（branchedFrom 自引用 set null）→ D2.branchedFromSessionId 变 null → 续聊回退到 `getSessionWorkspace(ws.userId, D2)` = B 的新空工作区（D2.jsonl 在 A 的 home D1-cwd 下 → **可能 resume 不到**）。**这是一个未决边界**：源删除后分支续聊的行为。请评估。
7. **forked id 捕获**：依赖 worker init 事件的 `session_id` = 新 forked id。**未活体验证**（见 §8）。若 SDK 在 fork 时 init 事件给的是旧 id，则 D2 会错绑 D1 的 realSdkSessionId → 灾难（D2 实际指向 D1）。**Codex 必须确认 forked query 的 init session_id 是新 id。**
8. **claudeHomePath 非空**：POST insert 仍有既存 `claudeHomePath||null` 的 type 报错（基线，非本次引入）；运行期 ws-server 总传非空 claudeHome，故不炸。分支预建传的是 D1.claudeHomePath(非空)。✔

---

## 7. 安全审查清单

- [ ] POST `/api/agent-sessions` 的 projectId/branchedFrom 校验是否可绕过（§6.5）。
- [ ] `loadSessionById` 经 `/$id`（canAccessSession 门控）——非成员取源会话应得 null（→ 工作区回退）。确认不泄露。
- [ ] 成员 B fork A 的会话 = 读 A 的 transcript + 在 A 的 home/工作区写 D2。属 Model A「半可信同事」威胁模型内（CLAUDE.md §1）。确认无跨 project 泄露（D2.projectId 锁死 = D1.projectId）。
- [ ] `canMutateSession`（改名/删 = 发起人）——B 不能删 A 的 D1，但能删自己的 D2。确认。

---

## 8. 验证状态（**关键：分清已验证 / 未验证**）

**已验证 ✅**
- `node --check ws-server.mjs` / `ws-query-worker.mjs` 通过（语法）。
- `pnpm typecheck`：本次改动 **0 新增错误**（index.ts 仅剩既存 `claudeHomePath` 基线 1 个）。
- fork **机制** standalone 活体验证（§3）。
- 前置 A 的解析器单测 10/10。

**未验证 ❌（Codex / 团队必须补）**
- **完整 ws-server 分支端到端流**：本地 prod 产物**不含 WS server**（`node .output/server/index.mjs` 无 WS），WS 是独立 `node ws-server.mjs` + 需真实 ARK token + 运行栈。所以「B 发言 → 分支 → fork → 捕获 forked id → 落库 D2 → session_init → 客户端切 D2」**整条没跑过**。
- **forked query 的 init 事件 session_id 是否 = 新 forked id**（§6.7，最高风险）。
- **D2 续聊**（二次发言）能否正确 resume（工作区派生 §C1e）。
- migration `0025` **未应用**（任何库）。
- 前端：viewing 是否发 `resume`、分支后客户端能否随 session_init 切到 D2。

**建议的最小集成验证脚本**（团队在真实栈上）：
1. 应用 0024+0025；A 建项目 + 邀 B；A 在项目内 D1 聊两轮。
2. B 打开 D1（应只读看到全文）；B 发一句 → 期望：新会话 D2「分支·…」出现、带 D1 上文、B 的话进 D2、**D1 不变**、A 也能在项目里看到 D2。
3. B 在 D2 再发一句 → 期望：正常续写 D2（验证 §C1e 工作区）。
4. 校验 DB：D2.userId=B、projectId=D1.projectId、branchedFromSessionId=D1.id、realSdkSessionId=forked 新 id≠D1。

---

## 9. 风险与未决（给 Codex 重点看）

| # | 风险 | 影响 | 建议 |
|---|---|---|---|
| R1 | forked init 事件可能返回**旧** session_id | D2 错绑 D1 的 realSdkSessionId（数据灾难）| **已加防御断言**：捕获处若 `isBranch && session_id===effectiveResumeSdkId` → 中止落库 + 回 `branch_fork_failed`（ws-server.mjs init 捕获块）。仍**必须**集成验证 §6.7 确认正常路径返回新 id |
| R2 | 共享工作区 = B 改文件动 A 的 D1 工作区 | 语义非完全隔离 / 并发文件冲突 | 已知取舍，v1 接受 + 注释；v1.1 可拷贝工作区 + 重写路径 |
| R3 | 源会话删除后分支续聊工作区回退 | D2 可能 resume 不到 | §6.6 未决，请定语义（禁删有分支的源？或迁移）|
| R4 | 分支创建是「预建 D2 + fork query」两步，非原子 | fork 失败但 D2 已建 = 空壳 D2 | 可接受（空 D2 可删）；或失败时清理 D2 |
| R5 | per-session 写锁缺失 | 本设计**不需要**（B 不写 D1）| 确认无「两人同时 fork 同一 D1」的竞态问题（各自得独立 D2，无共享写）|

---

## 10. 不在本次范围

- **前端分支 UX（C#2）**：查看他人会话时 composer 显示「回复将创建你的分支」；fork 后客户端切到 D2；列表/标题的「分支·」呈现 + branched-from 指示。
- **应用 migration 0025**。
- **成员看 owner 的工作区文件（artifacts）** 的路径派生（A 遗留的小项；本次只处理了 chat/resume 的工作区，未碰 `/api/workspace/*` 文件路由的 owner 派生）。
- 提交 / PR（owner 选择 (b)：整个 Projects 功能闭环后再一次性提交）。

---

## 11. Codex 第一轮 review —— 已处理（2026-06-08）

Codex 提了 3 条，全部合理、已修：

| # | Codex 发现 | 修复 |
|---|---|---|
| P1 | **R1 守卫没停 worker**：原守卫只 `sendMessage`+`return`（退出 stdout 行处理器），worker 继续跑 → B 的回合仍可能 append 到 D1 | init 捕获守卫改为：`worker.__intentionalAbort/__terminalSent=true` + `worker.kill()` + 错误帧。init 是 SDK 首个事件、在「处理 B 的 prompt + append」之前 → 在 init 同步 kill，B 的消息基本到不了 D1。 |
| P1 | **分支预建失败被吞**：`persistSession` 失败只 log、返回 undefined，handleChat 仍起 fork → init 捕获会建出**无 lineage 的孤儿 D2**（loose / 不在项目里）| `persistSession` 现返回 `{id,created}` 或 `null`；分支预建 `if (!created) { 错误帧; return; }`——**D2 不带 lineage 建成就不起 worker**。 |
| P2 | **源无 realSdkSessionId 时静默丢上文**：`effectiveResumeSdkId` 可能为 null，worker 仅在有 sdkResumeId 时传 forkSession → 退化成「新空会话」而非「带 D1 全文的分支」| 加硬失败：`if (isBranch && !effectiveResumeSdkId) { branch_source_not_ready; return; }`。 |

**残留（给下一轮）**：R1 的 kill-at-init 仍有**极小竞态窗**（init 已发出 ~ B 的 user 消息 append 之间）。完全消除需改用「先 standalone `forkSession()`(本地、无 LLM、已验) 得到 D2 新 id → 再起 worker resume **D2**(B 自己的会话) + B 的 prompt」——B 的回合永不碰 D1。但 `forkSession()` 在 ws-server 调用要 `HOME=A 的 home`，而 `forkSession()` 读 `process.env.HOME`（全局，并发会有 HOME 串台风险），故需 fork-子进程隔离 env。本次保留流式 `query({forkSession:true})` + kill-at-init；若 Codex 认为竞态不可接受，再上分离式。

Codex 验证回执（与本报告 §8 一致）：node --check ✅；projects-access 单测 10/10 ✅；typecheck 仅既存基线错（含 claudeHomePath）；共享库仍 `0024`、`0025` 未应用、**完整 live 分支链路仍未验**；SDK 源确认 `forkSession:true → --fork-session`，但**流式 init `session_id` 是否新 id 仍需 live 测**。

---

## 12. Codex 第二轮 —— 架构改定：fork-in-worker（R1 结构性归零，已实施）

**Codex 源码证明**：流式 `query({resume:D1, forkSession:true})` 下，SDK 在发 `system/init` **之前**就把 user prompt 写进 JSONL（`submitMessage → insertMessageChain`）。所以 kill-at-init 是「灾后报警」不是「防写」——若 fork flag 退化为 no-op，B 的话已落 D1。**R1 在流式下是真实结构性竞态**。

**改定（Codex 验证通过、已实施）**：把 fork 挪进 **worker**（本身就是 per-request、env 隔离的子进程，`HOME=A 的 home` 已设好）：
```
worker branch 模式（ws-query-worker.mjs）：
  forkedId = forkSession(sourceSdkId, { dir: config.cwd, title: branchTitle })  // 纯本地、无 LLM、已活体验
  assert  : 未 throw && UUID && forkedId !== sourceSdkId                          // 门控；不过则不发 query
  query({ resume: forkedId, prompt: B })                                         // resume 的是 FORK，永不 resume source
```
**worker 永不 resume source → source 不可能被写 → R1 结构性归零。** 用 standalone `forkSession()`（与流式 `--fork-session` 不同代码路径，已活体验：返回新 id、新 JSONL、源不变），**不再用 `query({forkSession:true})`**。

Codex 源码确认：① `forkSession` 纯本地（读源 JSONL → 重写每条 entry 的 sessionId 为新 id + 加 `forkedFrom:{sessionId:source}` → 写新 JSONL），不碰 CLI 会话全局态；随后 `query()` 另起 CLI 子进程，**同进程顺序调用干净**。② `dir: config.cwd` 把 fork 的查找+落点钉死在当前 workspace 的 project dir，与后续 `query(resume:forkedId)`（按 cwd 找 project dir）**100% 对齐**；源不在则 fork **直接 throw、不进 query**（内建门控）。

> **这取代 §4.1 的流式数据流。** ws-server 侧基本不变（仍传 source id + branch flag + 新增 `branchTitle`、预建 D2、init 捕获 forkedId 落 D2）；§11 的三条 P1 修复仍在；R1 guard（§11 P1）退化为**永不触发的兜底日志**（worker 永不 resume source）。

**本轮改动文件**：`ws-query-worker.mjs`（import `forkSession as forkSdkSession`、destructure `branchTitle`、query 前 fork + UUID/≠source 门控、query 用 `resume: forkedId` 弃 `forkSession:true`）；`ws-server.mjs`（worker request 传 `branchTitle`、R1 guard 注释更新为兜底）。

**残留**：分支模式下若 fork 在 worker 里 throw（如源不在 project dir），ws-server 已预建的空 D2 会成孤儿（极少、可删）。`node --check` 双通过。**完整 live 链路仍未验**（§8）。

---

## 13. C#2 分支 UX 前端 —— v1 已落（待 live + Codex）

参照 owner 给的 ChatGPT 截图（图1 banner / 图2 分割符）。已实现（静态：类检 0 新错、lint 0）：
- **P1** `src/lib/hooks/use-session-branch-info.ts`：拉当前会话 DB 行（owner / branchedFrom / 源标题），用 A2 放行的成员可读会话 API（session_init/metadata 不带这些）。
- **P2 banner（图1）** `src/components/claude-chat/branch-indicators.tsx::BranchReplyBanner`：viewing 非己会话 → composer 上方「发表回复将创建你的分支」。
- **P3 indicator（图2）** `…::BranchedFromDivider`：branched 会话 → 「从 <源> 建立的分支」分割符，**v1 放线程顶部**（非 fork 点）。
- 接入 `src/routes/agents/claude-chat/route.tsx`（`useSessionBranchInfo` + 两处条件渲染）；i18n `src/contents/projects.content.ts` 的 `branch.*`。
- **P4（分支后切 D2）**：未加新代码——预期复用现有 `onSessionInit`（后端 session_init(D2) → 前端 setCurrentSessionId）。**待 live 验。**

**Codex 第三轮裁定（2026-06-08）**：**v1 点头。**
- **Q2 切换 = 干净,无需新代码** ✅：`onNew` append user → `runChat` append assistant placeholder（按 id patch）→ `session_init` 只 `setCurrentSessionId/setSessionId`、不清消息/不 bump chatKey → D1 历史 + B user + assistant 原地变成 D2 线程。**已应用** Codex 的唯一修：`onSessionInit` 现也 invalidate `['project-sessions']`（否则分支出的 D2 不会即时出现在项目 Chats tab）。caveat：fork 在 session_init 前失败 → optimistic user 短暂留 D1（非污染，后续可加 rollback）。
- **Q1 精确分割符 = 延后 polish**：`forkedFrom` 不在 ws-server 丢（`parseJsonlContent` 浅拷保留未知字段，`ws-server.mjs:533`），丢在**前端转换层**（`SDKMessage` 没声明 + `convertSDKMessage` 只取 type/message/uuid，`chat-session-store.ts:82/261`）。精确版要：① 打通 forkedFrom 到 ThreadMessage（resume D2 时还原 fork 点）+ ② **发送即时分支那一刻** store 里是 D1 历史(无 forkedFrom)，需另记「在当前最后一条后插 divider」或后端发 branch-boundary 事件。不记 raw「继承数 N」(会因 summary 过滤/tool_result 跳过/assistant 合并 与 UI index 失配)。**v1 顶部版 Codex 接受。**
- **Q3 owner 名 = 延后**：v1 name-less 可接受；要名字需 `$id` 与 `by-sdk-id` **两个** detail API 一起返回 `ownerDisplayName`。优先级在精确 divider + project invalidation 之后。

---

## 附：相关文件清单（审阅入口）
- 解析器：`src/server/projects/access-logic.ts`、`access.ts`
- 会话 API：`src/routes/api/agent-sessions/{index,$id,by-sdk-id.$sdkId}.ts`
- 附件：`src/server/function/message-attachment.server.ts`、`src/server/workspace-session.ts`
- WS：`ws-server.mjs`（`handleChat` / `persistSession` / `loadSessionById`）、`ws-query-worker.mjs`
- schema/迁移：`src/db/schema/agent-session.schema.ts`、`drizzle/0025_round_marvel_boy.sql`
- 测试：`tests/unit/projects-access.test.ts`
