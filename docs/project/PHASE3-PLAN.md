# Phase 3 实施计划 — 追赶并超越 Deep Agents（能力 + UI/UX 全面升级）

> 给接手的工程师 / AI：读完这一份 + `research/2026-05-phase3-ui-ux-design.md` 即可开工。
> 日期：2026-05-31 · 交接时 main 已含 Phase 0.5 + Phase 2 全部。
> 延续项目一贯的「小步 PR、真实验证、可回滚」节奏。

---

## 0. 仓库 / 工作纪律（必读）

- 主仓库 `git@github.com:foreveryh/oxygenie.git`（origin）。开发目录
  `/Users/peng/Dev/Projects/active/ClaudeAgentChat/oxygenie`。
- **铁律**（详见 `WORKLOG.md`）：① 每次 Edit/Write 后立即 `grep`/`test -f` 验证落地（Edit 会静默
  no-op；**改前先 Read 真实文本，别凭记忆写 old_string**）；② 绝不 `git add -A`，只 add 显式路径，
  commit 前核对 `git diff --cached --name-only`；③ 运行时代码真跑验证（`node --check` 不算；前端跑
  `pnpm build` 或起栈看页面）；④ 提交说明只写验证为真的内容，**绝不虚报**；⑤ 别信终端回显，关键结论写文件再 Read。
- 提交流程：feature 分支 → `git -c commit.gpgsign=false commit --no-verify` → push →
  `gh pr create` → CI 必需 check = `Quality Checks (22.12)` + `gitleaks`（`changedoc` 非必需，可
  `--admin` 合）→ `gh pr merge --admin --squash --delete-branch` → `git reset --hard origin/main`。
- shell 是 zsh；起栈 `./scripts/dev-up.sh`；`.env` gitignored 勿提交密钥。

## 1. 目标与定调

**Goal**：补齐 Deep Agents harness 能力（Todo/子agent/HITL/检查点/记忆），同时**把"聊天框"升级为
"agent 工作台"**，并重做设计语言。
**设计定调（已锁定，详见 UI/UX 设计文档）**：
- Coze 外壳气质 + Cowork 工作台深度；三栏布局（左导航/中对话/右常驻工作台）。
- 重做 design token（改 `src/styles/app.css` 的 `@theme`/shadcn 变量 + `tokens.css`），**保留 shadcn/Radix**。
- 3D 拟物图标：负责人后续提供素材，代码侧先占位。
- **守住 web + 多租户 + 隔离工作区边界**（参考产品是桌面单用户本地文件，不可照搬数据模型）。

## 2. 已核实的代码现状（行号会漂移，用 grep 定位）

- **design token 在 `src/styles/app.css`**（Tailwind v4 `@theme` + shadcn 变量 + `.dark`）+ `tokens.css`。
  改 token 即全局换肤；35 个 `src/components/ui/*` 消费这些变量；76 个业务组件引用 `<Button>` 等。
- **子 agent 结构化字段已有**：`ws-adapter.ts` 已用 `parent_tool_use_id`（grep）→ ② 缺前端嵌套渲染。
- **无 TodoWrite 处理**（adapter grep 不到 todo）→ ① 全新。
- **右侧面板体系已存在**：`src/components/claude-chat/` 下 `artifacts-panel` / `session-files-panel` /
  `session-info-panel` / `knowledge-base-panel` / `permission-badge`（含 `PermissionMode` 类型）。
- **HITL 守卫在后端**：worker `canUseTool`（`ws-query-worker.mjs`）当前自动判定；③ 改成「暂停→问前端→等响应」。
- **Phase 2 已交付**：`usage_record`（#55，每 run token 落库）、`audit_log`（#56）、计量+配额默认关（#57）。
  右侧 Context 面板的"本月用量"可直接读这些。

## 3. 子任务 / 难度 / 与其它工作的冲突

| # | 项 | 改动面 | 难度 |
|---|---|---|---|
| 设计 | design token 重做 + 工作台骨架 | 前端（app.css + 新容器组件） | 中 |
| ① | Todo/Plan 面板（TodoWrite→右侧实时勾选） | 前端 + adapter | 低-中 |
| ② | 子 agent 面板（结构化嵌套） | 前端（字段已有） | 中 |
| ③ | HITL 工具审批（approve/reject/edit + Ask/Act） | **后端重**（worker/ws 协议） | 中-高 |
| ④ | 检查点 / 续跑 | 后端 + DB（`ExecutionRuntime.snapshot?()` 已预留） | 高 |
| ⑤ | 上下文管理 / 记忆 | 后端 + DB（参考 hermes-agent FTS5） | 中-高 |
| ⑥ | 统一两 runtime 共享逻辑（skill-sync/路径守卫） | 后端重构（类似 B3） | 低-中 |
| 视觉 | 35 个 shadcn 组件应用新 token | 前端，渐进 | 中 |

## 4. 分波执行（Phase 3 太大，必须分波，勿一把梭）

### Wave 0 — 设计稿 + token（不写功能代码）
- 把 UI/UX 设计文档的 token 方向**细化成 `app.css` 的具体数值**；产出 1-2 个风格方向供负责人拍板。
- 搭三栏工作台**空骨架容器**（右侧面板可切换分区，先空态）。
- 验证：`pnpm build` 通过；页面整体换肤后不破版（截图给负责人看）。
- ⚠️ 这一步要和负责人来回对齐，**骨架/视觉定了再进 Wave 1**，否则返工。

### Wave 1 — 工作台内容：① Todo + ② 子 agent（前端线）
- P3-1 Todo 面板：adapter 认 `TodoWrite` → `todo-panel.tsx` 右侧实时勾选（对标 Cowork Progress）。
- P3-2 子 agent 面板：用 `parent_tool_use_id` 组织嵌套，去正则；前端折叠渲染。
- 验证：起栈跑触发 TodoWrite / 子 agent 的真实任务，面板实时更新；多会话不串、数据按 user/session 隔离。

### Wave 2 — 交互模式 + ③ HITL（前后端）
- Ask/Act 模式开关（扩展 `permission-badge`）；工具调用升级为可展开卡片 + 危险工具审批往返
  （worker `canUseTool` 暂停 → WS 问前端 → 等响应）。**动 worker 协议，串行做，勿与其它后端改动并行。**

### Wave 3 — ④ 检查点 + ⑤ 记忆（后端重）
- 最难，放最后。④ 用 `ExecutionRuntime.snapshot?()`；⑤ 参考 hermes-agent。

### 贯穿
- ⑥ 技术债随时插；视觉打磨（35 组件应用新 token）放每个 Wave 尾巴，**别先美化后改结构**。
- 技能商店重做（Coze 卡片网格）可作为 Wave 1 或独立小波。

## 5. 待负责人确认 / 依赖

1. Wave 0 风格方向需负责人拍板（或借助设计 skill 出方案）。
2. 3D 图标素材由负责人提供（未到位用占位）。
3. ③④⑤ 的产品细节（审批粒度、检查点恢复范围、记忆边界）实施前各自再出小设计稿给负责人审。

## 6. 验收标准

- 与 `deep-agents-ui` 在 todo / 子agent / HITL parity-or-better；具备断点续跑；
- 全新设计语言落地、整体不破版、暗色可用、响应式可用；
- **全程守住隔离 + 多租户 + web 边界**；
- 每步 `pnpm build` / `test:unit` 绿 + 真实页面/运行验证；提交说明诚实。
