# 致 Codex 团队 —— Projects「续聊即分支」后端 Double-Check 交接

> 日期：2026-06-08 ｜ 发起：Claude（本次实现者）｜ 收件：Codex review 团队
> 一句话：请 review 我在**生产 `ws-server.mjs`** 里做的 **branch-on-reply（续聊即分支）后端**实现——这是整个 Projects 功能里**最敏感、且无先例**的一块。重点：正确性、安全、边界，以及**一条至今没活体跑过的集成链路**。

---

## 0. 先读这一份（90% 的内容在这）

📄 **执行报告：`docs/project/research/2026-06-08-branch-on-reply-execution-report.md`**

它已完整记录：业务逻辑（owner 原话）、PRD/上下文、fork 机制的活体验证证据、架构与存储决策、**逐文件改动**、端到端数据流、**不变量/边界 8 条**、安全清单、**已验证 vs 未验证（关键）**、风险 R1–R5、**最小集成验证脚本**、不在本次范围。

本交接是「导航 + 你必须知道的前提」，细节都在那份报告里。

---

## 1. 代码 & 分支状态（先知道这个，否则你找不到代码）

- 分支 **`feat/projects-ui-shell`**，**零 commit、全部是未提交工作区改动**（owner 选择：整个 Projects 功能闭环后再一次性提交，所以现在不在 git 历史里）。
- → **看代码 = 直接看 `feat/projects-ui-shell` 工作区的文件本身**；`git diff origin/main` 也行，但别指望有 commit message。
- `main` 在持续前移（当前 `124d67c`），本分支基线 `bca44e2`；我改的文件与 main 的新提交**零重叠**，rebase 干净。
- **迁移状态**：`0024` 已应用到 owner 的共享 dev 库；**`0025`（branched_from）未应用任何库**——你做集成验证前要先 `drizzle-kit migrate`。

---

## 2. 必读文档清单 + 在哪（⚠️ 有两份不在本分支）

| 文档 | 用途 | 位置 |
|---|---|---|
| **执行报告**（上面那份） | 本次 review 主体 | 本分支 ✓ |
| **Projects 协作 PRD** `docs/project/prd/2026-06-projects-collaboration-prd.md` | 所有决策来源（Model A / scope / 续聊即分支 / §9 风险） | 本分支 ✓ |
| **P1 ⊕ RAG R0 数据模型** `…/research/2026-06-projects-p1-rag-r0-data-model.md` | schema/解析器/排期的设计依据 | ⚠️ **在 `docs/scope-projects-rag` 分支（PR #146 未合），本分支看不到**。取：`git show origin/docs/scope-projects-rag:docs/project/research/2026-06-projects-p1-rag-r0-data-model.md` |
| **Advanced RAG 方案** `…/research/2026-06-advanced-rag-design.md` | RAG 背景（非本次，但解释为什么 chunks 不带 scope 等） | ⚠️ 同上，在 `docs/scope-projects-rag` 分支 |
| **文件上传地基** `…/research/2026-06-file-upload-foundation-design.md` | 上传/解析/会话↔文档背景 | 本分支 ✓ |
| **`CLAUDE.md`**（项目根 `oxygenie/CLAUDE.md`） | **必读**：§1 北极星/威胁模型、ARK 钉死、本地运行环境章节 | 本分支 ✓ |

> 注：之前有两轮独立审计（发现「P1 只接了 1/7 会话读路径」的承重缺陷），其结论已**收进执行报告 §2**，没有单独存档。本次工作（步骤 A 的解析器扫尾 + 步骤 C 的分支）就是为修这个缺陷而做。

---

## 3. 环境/不变量（核查时的前提，错一个判断就偏）

- **存储无 OS 隔离**：`/data/users/*` 全部属**同一 uid（1001 nodejs）**，ws-server + worker 都以该 uid 跑。所谓「用户隔离」是**逻辑的**（路径里带 userId + DB 校验），不是 OS 文件权限。→ 跨用户读写在容器内合法（「分支无需搬数据」「共享工作区」成立的基础）。
- **ARK 网关**：Claude Agent SDK **钉死 `0.2.112`**（0.2.113+ 改原生二进制、与 ARK 不兼容）；鉴权用 **`ANTHROPIC_AUTH_TOKEN`（Bearer），不设 `ANTHROPIC_API_KEY`**；`ENABLE_STRUCTURED_OUTPUTS=false`。
- **WS 不在本地 prod 产物里**：`node .output/server/index.mjs` **不含 WebSocket server**（独立 `node ws-server.mjs` + 真实 ARK + 运行栈）。这是「分支链路没法本地集成测」的根因。
- **本地怎么跑**：CLAUDE.md「本地运行环境（共享 Docker 后端）」章节 + `scripts/local-backend.sh` / `scripts/local-prod.sh`（连 owner 的共享 Docker 后端；socat 桥 + `.env.local` 覆盖、`AUTO_MIGRATE=false`、8G 堆构建）。
- **威胁模型 = 半可信同事**（律所/财务/学校自托管），**Model A：容器即权限、无逐文件 ACL**。判断「是否泄露」要按这个，不是按公网多租户 SaaS。

---

## 4. 重点核查项（按优先级；细节见报告 §6/§7/§9）

1. **R1（最高风险）**：forked query 的 **init 事件 `session_id` 必须是「新」forked id**。若返回源 id → D2 会错绑 D1 的 `realSdkSessionId`（D2 实际指向 D1，数据灾难）。**已加防御断言**（捕获处 `isBranch && session_id===effectiveResumeSdkId` → 中止 + 回 `branch_fork_failed`），但**正常路径返回新 id 这件事只在 standalone `forkSession()` 验过，流式 `query({forkSession:true})` 路径未活体确认**。
2. **安全**：
   - POST `/api/agent-sessions` 的 `projectId`/`branchedFromSessionId` **仅创建时写入且校验**（projectId ∈ accessibleProjectIds；branchedFrom 经 canAccessSession）——确认不可绕过。
   - `loadSessionById` 经 `/$id`（canAccessSession 门控）——非成员取源会话应得 null。
   - **D2.projectId 锁死 = D1.projectId**（跨 project 不泄露）。
3. **边界 8 条**（报告 §6）：viewing 走 `resume` 不走 `chat`、`silentInit` 豁免、owner 续写不分支、分支的分支（单「分支·」前缀）、**源会话删除后分支续聊的工作区回退（未决，§6.6）**、claudeHomePath 非空等。
4. **工作区共享取舍**：分支 D2 **共享** D1 的工作区（为让 forked transcript 的绝对路径仍解析）→ B 在分支里改文件会动到 A 的 D1 工作区。**已知取舍**（对话型分支影响小），确认可接受 / 或建议 v1.1 隔离方案。

---

## 5. 你必须做的（我做不了的）

🔴 **跑最小集成验证**（报告 §8 有脚本）：真实栈起来 → 应用 `0024`+`0025` → A 建项目 + 邀 B → A 在项目内 D1 聊两轮 → **B 打开 D1（应只读看全文）→ B 发一句 → 期望生成「分支·…」D2、带 D1 上文、B 的话进 D2、D1 不变、A 也能看到 D2** → B 在 D2 再发一句（验续聊工作区）→ 校验 DB（D2.userId=B、projectId=D1.projectId、branchedFromSessionId=D1.id、realSdkSessionId=新 id≠D1）。

**这是整个实现唯一没跑过的部分**，也是 R1 的活体确认。

---

## 6. 不在本次范围（别当缺陷报）

- **前端分支 UX（C#2）**：查看他人会话时 composer 显示「回复将创建你的分支」、fork 后客户端切到 D2、列表/标题的「分支·」呈现 + branched-from 指示。
- **应用 `0025`、提交/PR**。
- **成员看 owner 工作区文件（artifacts）的路径派生**（步骤 A 遗留小项；本次只处理了 chat/resume 的工作区，未碰 `/api/workspace/*` 文件路由的 owner 派生）。

---

## 7. 审阅文件入口

- 解析器（纯逻辑 + DB 包装）：`src/server/projects/access-logic.ts`、`src/server/projects/access.ts`
- 会话 API：`src/routes/api/agent-sessions/{index,$id,by-sdk-id.$sdkId}.ts`
- 附件 / 工作区会话：`src/server/function/message-attachment.server.ts`、`src/server/workspace-session.ts`
- **WS（本次核心）**：`ws-server.mjs`（`handleChat` 分支流 / `persistSession` / `loadSessionById` / init 捕获块的 R1 断言）、`ws-query-worker.mjs`（`forkSession` flag）
- schema/迁移：`src/db/schema/agent-session.schema.ts`、`drizzle/0025_round_marvel_boy.sql`
- 测试：`tests/unit/projects-access.test.ts`

—— 有疑问回执给 owner（Peng），他会转回来。谢谢 🙏
