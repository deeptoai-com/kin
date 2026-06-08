# PRD：Projects —— 团队协作（共享会话 + 共享文档/RAG + 分支）

> 日期：2026-06-08 ｜ 状态：草案待评审
> 关联：
> - `research/2026-06-advanced-rag-design.md`（RAG 分档；当前按 `user_id` 隔离 → 本 PRD 改为 scope 解析）
> - `research/2026-06-file-upload-foundation-design.md`（文件上传/解析地基；`document.userId` → 改为 scope）
> - `prd/2026-06-a2composer-prd.md`、`prd/2026-06-multi-model-switching-prd.md`（同样的"先调研先例→PRD→分期"打法）
> - `VISION.md`：自托管 / 单组织 / 多用户（半可信同事）/ 可部署性优先。
> 北极星 + 用户画像（owner 2026-06-08）：终端用户是**非技术专业人士**（律师 / 财务 / 白领 / 学生），由**机构自托管**，**暂服务小团队**。

---

## 0. 决策摘要（owner 已拍板，2026-06-08）

- **定位 = 模型 B**：终端用户非技术，机构（律所/公司/学校）自托管；产品核心价值是**对团队共享文档做 RAG + Agent**。
- **共享 = Model A（容器即权限）**：**Project 级自动全共享**——成员资格 = 对该 Project 内**全部文档 + 全部会话**的访问权；**无逐文件 ACL**。
  - Model B（onyx 式 `is_public` + 逐组/逐用户授权）→ **留企业版 / 受限 project，本期不做**。
- **多人"同一对话" = 续聊即分支（ChatGPT 式），不做实时协同**（场景 1b 砍掉）。
- **访问基元 = `scope: personal | project`**，取代现有的 `user_id` 隔离；所有列表/检索走**统一访问解析器**。
- **嵌入零重嵌**：chunks/embedding 挂在文档上、与 scope 无关；加 Project 只改"谁能访问"，不重嵌。

---

## 1. 背景与现状缺口

| 维度 | 定位说的 | 代码现状 | 证据 |
|---|---|---|---|
| 多用户共享 | 单组织、多用户（组织内可信用户） | **全按 `userId` 切，无共享** | `agent_session.userId`、`knowledge_bases.userId`、`documents.userId` |
| org 概念 | 单组织 | better-auth `organization` + `member` **已存在**，但业务资源不挂 org | `auth.schema.ts` |
| RAG 隔离 | — | 设计稿按 `WHERE user_id = ?` | advanced-rag §3/§5/§6 |

→ "多用户共享"是**说出来没建出来**；RAG/上传若按 `user_id` 建好，加 Project 必返工。

### 先例（已调研）
- **ChatGPT 共享 Projects**（Oct 2025）：Project = 容器（chats + files + instructions）；**邀请同事 → 全员看到项目内所有聊天+文件**；owner 邀请/移除；**隔离上下文**（项目对话只引用项目内、不碰个人）；续聊别人的会话 → **自动分支**。→ **Model A 的范本。**
- **onyx**：`user_project`（**单 owner** 个人组织器：files+sessions+instructions）与共享解耦；共享走 `document_set`（`is_public` | 授权 `users`/`groups`）。→ **Model B 的范本（本期不采）；但"关联不复制""scope 化"思路可借。**
- **LobeChat**：纯个人，无共享；"提升到 KB = 加关联不复制"值得抄。

---

## 2. 目标 / 非目标

**目标**
- G1 **Project 作为团队共享主体**：成员 + 共享会话 + 共享文档(KB) + 项目指令。
- G2 **`scope(personal|project)` 访问模型**：单一解析器（`accessibleProjectIds` / `accessibleKbIds` / 会话可见性），取代 `user_id` 隔离。
- G3 **共享文档 RAG**：文档/KB 可属 project；RAG 检索按 `kb_id IN accessibleKbIds(user)`；个人文档"提升"到 project = 改关联（同实体、**零重嵌**）。
- G4 **共享会话 + 续聊即分支**：成员可见项目全部会话；续聊不是自己发起的 → fork（带上下文 + 署名，原会话不动）。
- G5 RAG/上传两份 design doc 的隔离从 `user_id` 改成 scope（在 RAG R0 数据模型阶段一并做，避免返工）。

**非目标（本期）**
- 实时多人同对话 / presence / 共同打字（场景 1b）。
- 逐文档 / 逐组授权、`is_public`（Model B）。
- 跨组织共享、公网多租户。
- 成员细粒度角色矩阵（先只有 owner / member）。

---

## 3. 核心概念与关系

```
Organization (已有 better-auth)   = 自托管实例 = 这一个公司/团队（外层边界）
  └── Project                    = 共享工作区（owner + members）
        ├── members  (project_member: projectId, userId, role=owner|member)
        ├── sessions (agent_session.projectId)         ← 共享会话（场景2/4）
        ├── KB/docs  (scope=project, projectId)        ← 共享文档/RAG（场景3）
        └── instructions (项目级自定义指令)

scope: personal | project
  - personal : owner 私有（个人文件 / 个人对话）
  - project  : 该 project 全体成员可见可用（自动全共享）
```

- **一份文档/一个会话属于唯一 scope**（personal，或某个具体 project）。
- **"提升到 project" = 关联/改 scope（同实体，不复制）**——文档的 chunks/embedding 不动，只改归属/可见性。
- **个人 ↔ 项目 关系**：个人是默认私有区；project 是显式共享区；提升是单向常用动作（也允许移回个人）。
- `document.userId` 退化为**上传者/署名**（attribution），**不再是访问基元**；访问一律走 scope。

### Schema 增量
```
project              id, org_id?, owner_user_id, name, description, instructions, created_at
project_member       project_id, user_id, role(owner|member), PK(project_id,user_id)
agent_session       + project_id (nullable; null=personal)
knowledge_bases     + scope(personal|project) + project_id (nullable)
documents           + scope(personal|project) + project_id (nullable)   -- userId 保留为上传者
agent_session       + branched_from_session_id (nullable) + created_by_user_id  -- 分支(场景1)
```
> chunks/embedding/HNSW/Meili **不加 scope 列**——它们是文档级，访问在 KB/文档这层解析。

---

## 4. 访问模型（单一入口，避免"改出乱子"）

所有"谁能看什么"收敛到一个解析器，**严禁在各处散写 `WHERE user_id`**：

```
accessibleProjectIds(user)   = project_member 里该 user 的 project 集
canSeeSession(user, s)       = s.project_id == null ? s.user_id==user
                                                    : s.project_id ∈ accessibleProjectIds(user)
accessibleKbIds(user)        = (个人KB: scope=personal AND owner=user)
                             ∪ (项目KB: scope=project AND project_id ∈ accessibleProjectIds(user))
```

- **RAG 检索**：`WHERE kb_id IN accessibleKbIds(user)`（隔离进 SQL，不事后过滤）——替换 advanced-rag 的 `WHERE user_id=? AND kb_id IN(...)`。
- **会话列表 / 文档列表**：同样走 `canSeeSession` / `accessibleKbIds`。
- **owner-only**：邀请/移除成员、删除 project。
- **隔离（ChatGPT 式）**：project 会话只引用同 project 的会话/文档；个人与 project 互不串。
- **威胁模型对齐**：半可信同事 → **project 内彼此信任、无逐文件 ACL**；隔离边界是"组织内用户 + project 成员资格"，不是反匿名攻击。

---

## 5. 三场景落地（对应 owner 的三点 + 续聊分支）

| 场景 | 做法 | 难度 | 先例 |
|---|---|---|---|
| **2. Project 多成员共享所有 sessions** | `agent_session.project_id`；列表按 `canSeeSession`；成员可打开/续聊 | 中 | ChatGPT 共享 Projects |
| **3. Project 文档跟随、团队引用(RAG)** | 文档/KB `scope=project`；RAG 按 `accessibleKbIds`；"提升"=关联到 project KB（零重嵌） | 中 | ChatGPT / onyx `document_set` |
| **1. 多人"同一对话"/共享长期上下文** | **共享只读 + 续聊即分支**：续聊非本人发起的会话 → 新建会话以分叉点上下文为种子 + `branched_from_session_id` + 署名，原会话不动 | 中 | **ChatGPT branch-on-reply** |
| **1b. 实时同处/共同打字** | **不做** | — | 无人做 |

- **分支实现**：新 `agent_session`，用分叉点之前的消息历史做种子（SDK resume/复制上下文）；`created_by_user_id` 记发起人、底部标注"谁的分支"。
- **串行化**：分支模型下各人写各自分支，**基本规避**"两人同时 resume 同一 sdkSession"的并发；若将来允许多人写同一会话再加每会话队列。

---

## 6. 与 RAG / 上传地基的对接（同步改，防返工）

- advanced-rag：R0 数据模型阶段**加 `scope+project_id` 到 KB/文档 + 落地 `accessibleKbIds` 解析器**；检索 SQL 用解析器，不用 `user_id`。
- file-upload：`document.userId`=上传者；F5"提升到 KB"改为"提升到 **project/personal KB**（关联不复制）"；访问走 scope。
- **embedding 零重嵌**：scope 变化不触发重嵌；`content_hash` 跨用户去重在共享模型下更顺（一份嵌入多人可见），前提是解析器铁实。

---

## 7. 分期

- **P1 · Projects 地基（keystone）**：`project` + `project_member` + scope 列；`accessibleProjectIds/KbIds`、`canSeeSession` 解析器；会话/文档列表按成员可见；owner 邀请/移除；项目指令。
- **P2 · 共享文档 → RAG（接 RAG R0/R1）**：文档/KB scope=project；RAG 按 scope 检索；"提升到 project"动作。
- **P3 · 续聊即分支（场景1）**：branch 会话 + 署名 + 隔离上下文。
- **暂缓**：实时(1b)、Model B（逐组/逐文档授权、is_public）、跨组织共享、成员角色细化。

依赖：P1 是地基；P2 与 RAG R0 合做（同一次数据模型迁移）；P3 在 P1 后可并行。

---

## 8. 迁移

- 现有 `userId`-scoped 的会话/文档/KB → 一律迁为 **`scope=personal`**（owner = 原 userId）。**无损、向后兼容**（不进任何 project = 个人私有，行为同今天）。
- 用户事后自行把会话/文档"提升"进 project。

---

## 9. 风险与未决

- **最大工程量 = 把全站 `userId` 查询改成解析器**（面广；授权必须做对，漏一处 = 越权可见）。建议先建解析器 + 集中改写 + 回归测试（每个列表/检索一条"非成员看不到"用例）。
- **共享会话的写权限语义**：member 能否续聊/删除别人发起的会话？建议：member 可**分支**（场景1），删除/重命名限 owner 或发起人。
- **分支对 SDK session 的实现**需验证（历史 seed / resume 复制；0.2.112 行为）。
- **org ↔ project**：better-auth `organization`/`member` 当外层实例边界，`project_member` 当内层；二者关系要在 P1 厘清（member of org ⊇ member of project）。
- **未决**：① 是否需要 `viewer` 只读角色；② 移出成员后其在共享会话/分支里的消息归属与可见性；③ 一个文档能否同时在多个 project（多对多 vs 单 scope）——本期取**单 scope 最简**，多 project 复用留待需求出现。

---

## 10. 一句话收口

**Project = 团队共享工作区（成员即全量访问，Model A）；用 `scope(personal|project)` + 单一访问解析器取代 `user_id` 隔离；共享文档走同一份嵌入零重嵌；"多人同对话"用分支不用实时。** 先做 P1 地基 + 在 RAG R0 一并落 scope，避免 RAG 返工。
