# Projects P1 ⊕ RAG R0 —— 合并数据模型 · 访问解析器 · 迁移 · 排期

> 日期：2026-06-08 ｜ 状态：**历史参考（已被重定基取代）**
> 🔄 2026-06-10：P1 半边已以 `project_id` nullable 变体落地 main（PR #152，无 scope 枚举）；RAG 半边的现行依据见《[RAG 最终实施方案](./2026-06-10-rag-final-implementation-spec.md)》。本文保留当时的合并论证。
> 关联（本文是这三者的**公共地基**，必须一次对齐，避免返工）：
> - [Projects 协作 PRD](../prd/2026-06-projects-collaboration-prd.md)（决策来源：Model A + `scope` + 单一解析器）
> - [Advanced RAG 方案](./2026-06-advanced-rag-design.md)（R0 数据模型 / `kb_search` 检索）
> - [文件上传地基](./2026-06-file-upload-foundation-design.md)（`document` 实体 / 提升到 KB）

## 0. 为什么合并

三件事——**Projects 共享 / RAG 检索 / 文件上传提升**——都要回答同一个问题：**"谁能看哪份文档/会话/KB？"** PRD 已拍板把答案从 `user_id` 隔离换成 **`scope(personal|project)` + 单一访问解析器**。

**关键时序**：scope 列若不在 RAG R0 的**同一次迁移**里落，等 RAG 按 `user_id` 建好、再加 Project 时**必返工**（PRD §6/§7）。所以本文把 **Projects P1 地基** 和 **RAG R0 数据模型** 合成**一次迁移 + 一个解析器**。

> **已发的不受影响**：刚上线的文件上传修复（F2/F3/Read 护栏/F4）全在 **per-session workspace（文件系统）**层，不碰 scope 治理的 DB 访问层。scope 在我们建文档实体 + RAG 时采纳即可。

## 1. 统一数据模型（一次迁移）

```
-- Projects 地基（PRD §3）
project            id, org_id?, owner_user_id, name, description, instructions, created_at
project_member     project_id, user_id, role(owner|member), PK(project_id, user_id)

-- scope 化既有资源（访问基元从 user_id → scope）
agent_session    + project_id (nullable; null = personal)
                 + branched_from_session_id (nullable) + created_by_user_id   -- 续聊即分支（PRD §5 场景1）
knowledge_bases  + scope(personal|project) + project_id (nullable)
documents        + scope(personal|project) + project_id (nullable)            -- userId 退化为上传者/署名
                 + (RAG R0 列：ingest_status/progress/token_estimate/rag_tier/summary/toc/embed_model/embed_dim)

-- RAG R0 检索基础（与 scope 无关，零重嵌）
document_chunks  + section_path/page_start/page_end/parent_chunk_id/content_hash/context_prefix
                 -- embedding 已存在；★ chunks/embedding 不加 scope 列 ★
pgvector 扩展 + document_chunks.embedding 上的 HNSW 索引
```

**铁律**：`chunks/embedding/HNSW/Meili` **不带 scope**——它们是**文档级**，访问在 `KB/文档` 这层解析。这保住 **零重嵌**：加 Project 只改"谁能访问"，不重算向量；`content_hash` 跨用户去重在共享模型下**恰是想要的**（一份嵌入多人可见）。

## 2. 单一访问解析器（唯一入口）

**严禁在各处散写 `WHERE user_id`。** 所有"谁能看什么"收敛到一处（PRD §4）：

```
accessibleProjectIds(user) = project_member 里该 user 的 project 集
canSeeSession(user, s)     = s.project_id == null ? s.user_id == user
                                                  : s.project_id ∈ accessibleProjectIds(user)
accessibleKbIds(user)      = (个人KB: scope=personal AND owner=user)
                           ∪ (项目KB: scope=project AND project_id ∈ accessibleProjectIds(user))
```

落点：
- **RAG 检索**（`kb_search`）：`WHERE kb_id IN accessibleKbIds(user)`（隔离进 SQL，不事后过滤）。
- **会话/文档列表**：`canSeeSession` / `accessibleKbIds`。
- **owner-only**：邀请/移除成员、删 project。
- **隔离（ChatGPT 式）**：project 会话只引用同 project 的会话/文档；个人与 project 互不串。

## 3. 迁移（无损、向后兼容）

- 现有 `userId`-scoped 的 `agent_session`/`documents`/`knowledge_bases` → 一律迁为 **`scope=personal`**（owner = 原 `userId`）。不进任何 project = 个人私有，**行为同今天**（PRD §8）。
- `document.userId` 列保留，但语义改为**上传者/署名**（attribution），不再参与访问判定。
- 用户事后自行把会话/文档"提升"进 project（改 `scope` + 关联，零重嵌）。

## 4. 排期（依赖关系）

| 阶段 | 内容 | 与原计划的对应 |
|------|------|----------------|
| **P1+R0（合做，keystone）** | `project` + `project_member` + scope 列；pgvector + HNSW；**`accessibleProjectIds/KbIds`、`canSeeSession` 解析器**；embedding/rerank 选型 + HTTP 客户端；列表按解析器 | Projects P1（PRD §7）⊕ RAG R0（rag §8） |
| **P2（= RAG R1/R2）** | 入库管线（parse→切分→embed）+ `kb_search` MCP（混合+rerank+引用）**按 `accessibleKbIds` 检索**；文件上传 F5"提升到 project/personal KB" | RAG R1+R2 ⊕ Projects 场景3 |
| **P3** | 续聊即分支（branch 会话 + 署名 + 隔离上下文） | Projects 场景1 |
| **暂缓** | 实时同对话(1b)、Model B（逐组/逐文档授权/is_public）、跨组织、角色细化 | PRD 非目标 |

**依赖**：P1+R0 是地基；P2 与之共用同一次数据模型迁移；P3 在 P1 后可并行。

## 5. 最大风险 + 纪律

- **最大工程量 = 把全站 `user_id` 查询改成解析器**（PRD §9）——面广，**漏一处 = 越权可见**。纪律：
  1. **先建解析器**（`accessibleProjectIds/KbIds`、`canSeeSession`）为唯一入口；
  2. **集中改写**所有列表/检索调用点（grep `WHERE.*user_id` / `eq(*.userId, ...)`）；
  3. **每个列表/检索一条"非成员看不到"回归用例**（呼应 RAG D4 + 第 11 篇跨租户回归）。
- **共享会话写权限**：member 可**分支**（场景1）；删除/重命名限 owner 或发起人（PRD §9 未决）。
- **org ↔ project**：better-auth `organization`/`member` 当外层实例边界，`project_member` 当内层；P1 厘清 `member of org ⊇ member of project`。

## 6. 一句话收口

**scope 是 Projects / RAG / 上传 的公共地基——一次迁移落 `scope + project_id` + 一个访问解析器，取代全站 `user_id` 隔离；chunks/embedding 不带 scope 以保零重嵌。P1 地基 + RAG R0 合做，避免 RAG 按 user_id 建好后返工。**
