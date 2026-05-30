# Phase 2 实施计划 — 可观测性与计费（Observability & Accounting）

给接手的工程师 / AI：读完这一份 + research/2026-05-billing-design.md 就能开工。
日期：2026-05-31 · 交接时 main 已含 Phase 0.5 全部（S1–S5）。
本计划延续项目一贯的「小步 PR、真实验证、可回滚」节奏。

## 0. 仓库 / 工作纪律（必读，前任反复栽的坑）

主仓库：git@github.com:foreveryh/oxygenie.git（origin）。开发目录
/Users/peng/Dev/Projects/active/ClaudeAgentChat/oxygenie。

铁律（详见 WORKLOG.md）：

- 每次 Edit 后立即 `grep -c` 验证落地 —— Edit 工具会在 old_string 不精确匹配时静默 no-op。
- 改前先 Read 真实文本，别凭记忆写 old_string。
- 绝不 `git add -A` —— 只 `git add <显式路径>`，commit 前核对 `git diff --cached --name-only`。
- 运行时代码要真跑验证，`node --check` 只是语法不算验证。验证 ws-server：
  `WS_PORT=3198 node ws-server.mjs` 看「listening + 无 ReferenceError」。
- 提交说明只写 grep/运行验证为真的内容，绝不虚报。
- 提交流程：feature 分支 → `git -c commit.gpgsign=false commit --no-verify`（gpg 会卡）→
  push → `gh pr create` → CI 必需 check 是 Quality Checks (22.12) + gitleaks（changedoc 非必需）
  → `gh pr merge --admin --squash --delete-branch` → `git reset --hard origin/main`。
- shell 是 zsh；本地起栈 `./scripts/dev-up.sh`；.env gitignored、勿提交密钥。

## 1. 目标与范围

Goal：能看清系统健康度与成本，并具备计费能力。

Phase 2 四块：

| #   | 子项                                                | 状态                                          |
| --- | --------------------------------------------------- | --------------------------------------------- |
| 1   | per-run token/cost/turns 落库（观测）               | ⬜ 待做（P2-1）                                |
| 2   | 计量接线 + 配额（spendOneCredit 从未被调用）        | ⬜ 待做（P2-3）                                |
| 3   | 审计日志表（安全相关动作）                          | ⬜ 待做（P2-2）                                |
| 4   | 停止无条件记录原始内容（PII）                       | ✅ 已完成（D4，summarizeMessage），跳过        |

计费策略见 research/2026-05-billing-design.md（已用真实 Ark 运行验证）。要点：

- 计量基础 = token 数（字节真实返回）；SDK 的 total_cost_usd 是按 Anthropic 散价的估算，
  当前成本是字节 ¥200/月包月固定，故美元 cost 仅作内部参考，不作计费依据。
- credit 首要作用 = 公平使用配额（防个别用户吃爆包月额度），非精确成本转嫁。
- 换算率 1 credit = N tokens 可配置、按模型、现在不拍死——先观测攒数据再校准。

## 2. 已验证的地基事实（工程师不必重新探索；行号会漂移，用 grep 定位）

- usage 数据拿得到：SDK result 事件含 usage.{input,output}_tokens、num_turns、
  total_cost_usd、modelUsage[model].{inputTokens,outputTokens,costUSD}。证据见 billing-design.md。
- worker 已转发 result 事件：ws-query-worker.mjs 的 for-await 循环对每个事件
  `process.stdout.write({type:'event', event})`（grep `type: 'event', event`），result 事件已在流里。
- ws-server 已收到：`rl.on('line')` 的 `msg.type === 'event'` 分支（grep）已拿到 msg.event，
  只是没对 `event.type === 'result'` 做落库。这是 P2-1 的主改动点。
- userId 可得：handleChat 作用域内 = ws.userId；会话 id = ws.workspaceSessionId / ws.sdkSessionId。
- 计费栈已存在（src/server/credits.ts + src/db/schema/billing.schema.ts）：
  spendOneCredit() 完整可用但从未被调用；creditLedger 有 meta JSONB 字段（落 usage 的现成位置）。
- 无 audit 表（P2-2 需新建）。

## 3. 分步 PR 序列（每步小、可验证、可回滚）

### P2-1 — per-run usage 落库（观测，不收钱，先做）

目的：把每次 run 的真实 token/turns/估算cost 记下来，攒数据为定价铺路。即使永不收费也有价值
（看用量趋势、抓重度用户）。

- ws-server `msg.type==='event'` 分支里，对 `event.type==='result'` 提取 usage，落库。
- 落库位置二选一（建议先用现成的 creditLedger.meta，零新表）：
  - 简单：插一条 creditLedger，kind:'usage_record'、delta:0（不扣额度，仅记录）、
    meta:{inputTokens,outputTokens,numTurns,totalCostUsd,modelUsage,sessionId}。
  - 或新建 usage_record 表（input_tokens/output_tokens/num_turns/cost_usd/model/userId/sessionId/createdAt）
    —— 更规范，便于聚合查询。建议新表，长期更干净。
- 关键边界：一次 run 可能用多个模型（modelUsage），都要记；result 可能 is_error，也记。
- 验证：真启 ws-server + 跑一次真实聊天，查库里有该 run 的 usage 行（input_tokens 非 0）。

### P2-2 — 审计日志表

目的：安全相关动作留痕。

- 新 schema audit_log：id / userId / action / target / meta(jsonb) / ip? / createdAt。
- 写入点（至少）：登录/登出、跨租户访问被拒（path-security / owner 谓词命中拒绝处）、
  worker abort、权限模式为 bypass 的运行。
- 纯增量，不改现有逻辑。生成迁移：`pnpm db:generate` 后审查 SQL 再 `db:migrate`。
- 验证：触发一次被拒访问，查 audit_log 有行。

### P2-3 — 计量接线 + 配额（等 P2-1 攒到数据再定换算率）

目的：真正按 token 扣 credit + 防吃爆包月额度。

- 扩展 credits.ts：加 spendCredits(userId, n)（现有 spendOneCredit 是 n=1 特例，可复用其事务逻辑）。
- 换算率配置：src/config/credit-rates.ts（按模型 tokensPerCredit，env 可覆盖），初值占位，
  待 P2-1 数据校准。计费公式见 billing-design.md（ceil(tokens / tokensPerCredit)，最少 1）。
- 在 run 结束（result 落库后）调用 spendCredits；额度不足时给客户端发拒绝帧（参考 S1 的 queued 帧风格）。
- 每用户月 credit 上限（creditBalances 已有 monthlyAllotment / allotmentUsed）。
- 验证：跑一次聊天看 credit 真扣减；额度耗尽时被正确拒绝。

## 4. 不确定性 / 待负责人确认

- 换算率初值：P2-3 前需要 P2-1 的真实数据 + 负责人确认「¥200 包月 ≈ 多少 token 预算」。
  不要拍脑袋定，用数据反推。
- 是否对用户展示用量（settings 里看本月消耗）—— 可选，P2-1 落库后顺带。

## 5. 验收标准（对应 Exit criteria）

- 每次 run 的 token/cost/turns 可在库里查到（P2-1）。
- 存在审计轨迹（P2-2）。
- credit 按 token 真实扣减、额度可控、可配置（P2-3）。
- 全程 test:unit 绿 + 真实启动验证；提交说明诚实。
