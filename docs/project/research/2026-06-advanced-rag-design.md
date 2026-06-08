# OxyGenie Advanced RAG 设计方案

> 状态：**设计稿（未实现）** · 2026-06-07 · 对应博客设计篇 [D1](../../blog/zh/d1-advanced-rag.md)
> 北极星对照：自托管 / 单组织 / 多用户（半可信同事）/ ARK 网关 + SDK 0.2.112 钉死 / 单机 16G·50 并发 / 可部署性优先。本方案不依赖任何 0.3.x-only 的 SDK 特性。
>
> **🔄 更新（2026-06-08，Projects PRD）**：隔离基元从 `user_id` 改为 **`scope(personal|project)` + 统一访问解析器**——所有检索 `WHERE user_id=?` 改为 **`WHERE kb_id IN accessibleKbIds(user)`**；`documents`/`knowledge_bases` 加 `scope + project_id`；`document.userId` 退化为"上传者/署名"；**chunks/embedding 不加 scope（零重嵌，一份嵌入多人可见）**。**scope 列必须在 R0 同一次迁移里落**，否则按 `user_id` 建好后加 Project 必返工。详见 [Projects PRD](../prd/2026-06-projects-collaboration-prd.md) + [Projects P1 ⊕ RAG R0 合并方案](./2026-06-projects-p1-rag-r0-data-model.md)。

## 0. 一句话方针

**RAG 不是默认项，是"放不下了"才触发的逃生通道。** OxyGenie 已有的 `Read`/`Grep`（per-session workspace）对小文档**本来就够、而且更好**；本方案只补**大文档 / 大语料 + 捞针**这一格，并把"走哪一格"做成**上传时分流 + 在线让 Agent 自己选工具**的路由，而不是把所有文档都 chunk+embed。

---

## 1. 背景：现状是"空架子"

代码盘点（`main` @ 2026-06-07）：

| 该有的 | 现状 | 证据 |
|--------|------|------|
| 向量列 | ✅ 有，**从未写入/查询** | `src/db/schema/document.schema.ts:33` `embedding: vector(1536)` |
| chunk 仓库 | ✅ 定义，**死代码** | `src/db/repositories/document.repo.ts:6` `documentChunkRepo` |
| 入库 | ❌ 纯文件拷贝，无切分/嵌入 | `src/routes/api/workspace/$sessionId.documents.ts` |
| 解析 | ❌ 装了不用 | `src/mcp-store/markitdown-mcp` |
| 检索 | ⚠️ 只有 BM25 | `src/search/meilisearch.ts` |
| Embedding / 检索工具 / 评测 / tracing | ❌ 全无 | — |

**缺的不是设计，是接线**：pgvector 列、BullMQ、Meili、markitdown、ARK 网关、S3 全在了，只是从没接到一起。

---

## 2. 核心原则：分档路由，不是默认 RAG

### 2.1 三档阶梯（按"塞不塞得进上下文"切）

| 档 | 触发条件 | 用什么 | 成本 |
|----|----------|--------|------|
| **① 装得进上下文** | 单文档 ≲ 预算的一小块（粗略 ~1–3 万 token / 十几页），单次/短会话 | **整篇丢进上下文，模型自己读** | 零额外基建；按 token 计费（有 cache 则更省） |
| **② 放不下、字面可定位** | 单个大文件，查的是关键词能命中的东西 | **`Grep` + `Read`（Agent 自己翻）= 现状** | 几乎零成本、无损 |
| **③ 放不下 + 语义对不上 / 多文档语料** | 200 页、一堆文档、或跨会话天天查的常备资料 | **chunk + embed + 混合检索（本方案）** | 入库有成本，换语义召回 + 跨文档 + 可复用 |

> ①②是 OxyGenie 现状，**对它们这是正确答案，不是缺口**。本方案只造 ③。

### 2.2 第二根轴：任务类型（捞针 vs 通读）

RAG 只擅长**大海捞针（lookup）**，不擅长**通读全篇（holistic）**：

- "退款费率是多少" → top-K 检索完美。
- "总结这 200 页 / 对比第 3 章和第 9 章" → top-K **有害**（切碎全局结构）→ 走**全文 map-reduce / 分层摘要**，不是检索。

**决策是二维的：`大小 ×（捞针 / 通读）`。** 200 页 + 捞针 → RAG；200 页 + 通读 → 分层摘要。

### 2.3 路由落点

- **上传时分流（关键省钱点）**：文件入库时按大小分类——小 → 留作 workspace 文件，走 Read/Grep，**不嵌**；大 → 才入 BullMQ 嵌入管线。**绝大多数上传是小的，全嵌纯属烧钱。**
- **在线把工具都给 Agent**：同一会话里 Agent 同时有 `Read` / `Grep` / （大文档才有的）`kb_search` / 文档摘要+ToC——**用哪个交给 Loop**（Agentic 本质；第 03/06 篇）。RAG 是多给的一把工具，不是替换 Grep。
- **门槛是预算不是页数**：真正决定档位的是 `(大小 × 复用次数 × 任务类型 × 有无 prompt cache)`。40 页查一次 → Grep；40 页天天查的常备件 → 嵌（摊薄成本）。阈值做成**可配置**（`RAG_INGEST_MIN_TOKENS` 之类），先给保守默认，按实测调。

---

## 3. 数据模型

沿用 Skills 已验证的 **DB-as-truth** 模式（DB 为真相，不做 FS 复制）。

**复用已存在的**：`document`、`documentChunks(embedding vector(1536))`、`knowledgeBases`、`kbDocuments`、`sessionDocument`、`messageAttachment`。

**需要新增/补列**：

```
documents            + ingest_status (pending|processing|ready|failed)
                     + ingest_progress (0-100)
                     + token_estimate           -- 用于分档路由
                     + rag_tier (inline|grep|rag)-- 分流结果
                     + summary (text)           -- 文档级摘要
                     + toc (jsonb)              -- 章节树，给 agentic 路由
                     + embed_model / embed_dim  -- 记录嵌入模型与维度（换模型要重嵌）
                     + scope (personal|project) + project_id (nullable)  -- 🔄 访问基元（取代 user_id 隔离）
                     -- userId 退化为上传者/署名(attribution)，不再是访问基元

knowledge_bases      + scope (personal|project) + project_id (nullable)  -- 🔄 accessibleKbIds 据此解析

document_chunks      + section_path (text)      -- 如 "§7.2 退款条款"，用于引用 + 上下文增强
                     + page_start / page_end    -- 引用页码
                     + parent_chunk_id          -- parent-child / small-to-big
                     + content_hash             -- 块级去重 + 增量重嵌
                     + context_prefix (text)    -- contextual retrieval 前缀
                     -- embedding 已存在
```

**索引**：Postgres 开 `pgvector` 扩展，给 `document_chunks.embedding` 建 **HNSW**；Meili 维持 `documents`/新增 chunk 级 BM25 索引。**所有检索 SQL 必带 🔄 `WHERE kb_id IN accessibleKbIds(user)`**（统一解析器，取代 `WHERE user_id`；隔离仍进 SQL、不事后过滤；第 11 篇 + Projects PRD §4）。

---

## 4. 入库管线（离线，BullMQ）

上传后挂一个 BullMQ job（不是只拷文件）。各 stage 幂等、按 `content_hash` 增量、可报进度。**只对 ③ 档文档跑。**

```
upload(S3 + document 行, status=pending)
   │  ① 路由：token_estimate < 阈值 → rag_tier=grep/inline，结束（不嵌）
   ▼  大文档 → rag_tier=rag，入队
② parse        markitdown-mcp → 结构化 Markdown（保留标题层级 + 页码锚点；扫描件/表格走 OCR 兜底）
③ chunk        结构感知切分：按标题层级 章→节→小块（不是定长窗口）；建 parent-child
④ contextualize 给每块前置上下文（见 4.1）
⑤ embed        批量调 ARK/Zhipu embeddings（非 SDK）→ 写 document_chunks.embedding
⑥ index        pgvector HNSW + Meili BM25
⑦ digest       生成 document.summary + toc
   ▼
status=ready（全程 ingest_progress 反馈 UI "处理中 60%"）
```

### 4.1 上下文增强（大文档的胜负手）

裸块"费率为 4.5%"检索不出来。在 embedding **之前**给每块前置上下文，两档：

- **免费档（默认）**：`context_prefix = doc标题 + section_path`，零 LLM 成本，已拿大半收益。
- **进阶档（Contextual Retrieval）**：用便宜的 haiku 档（`doubao-seed-2.0-lite`，第 14 篇）给每块生成一句"这段在讲什么"。Anthropic 实测它 + 混合 + rerank 能把检索失败率大幅下降。**成本评估**：N 块 × 1 次廉价调用；若 ARK 网关支持 prompt cache 可大幅摊薄，否则先用免费档、对高价值文档才开进阶档。

### 4.2 200 页 worked example

200 页 PDF ≈ 10–15 万 token ≈ 300–600 块。它**几乎能塞进 200K 窗口**，但每轮灌 15 万 token = 烧光 ARK 额度 + lost-in-the-middle 更不准 + 第二个文档放不下 → **必须走 ③ 档**。
- parse：200 页含表格/扫描页，**解析质量是天花板**（烂解析 → 烂块 → 检索全错）。
- chunk：按章节切 + parent-child；每块带 `page/section_path`。
- contextualize → embed（后台批量，几分钟，显示进度）→ pgvector + Meili。
- digest：摘要 + ToC，供 Agent 先看"地图"再钻具体节。

---

## 5. 在线检索（`kb_search` MCP 工具）

把整套检索封进 `createSdkMcpServer({ name:'kb_search', ... })`，注册进 `ws-query-worker.mjs`（与 python/glm-image/bash 并列；第 06 篇）。**Agent 自己决定何时调、查什么、取几条、要不要按 ToC 再钻一层**。

```
kb_search(query, k?, doc_id?/kb_id?) →
  ① （可选）查询改写/拆解（haiku 档）
  ② 混合召回（并行）：
       pgvector 向量召回（语义）  ∥  Meili BM25（精确词/专名）
       两路都带 WHERE kb_id IN accessibleKbIds(user)   ← 🔄 解析器隔离（个人 KB ∪ 可见 project KB）
  ③ RRF 融合
  ④ rerank 精排（ARK/Zhipu rerank 端点）
  ⑤ small-to-big：小块命中 → 返回其 parent 小节（给够上下文）
  ⑥ 返回 top-K（默认 ~8）+ 页码/小节引用
```

- **向量管"意思像"、BM25 管"词对得上"、rerank 管"真相关"、引用管"可信"**——四段各补一段。
- **通读类任务不走这里**：检测到 holistic 意图（总结/全局对比）→ 走 map-reduce 摘要（基于 summary/ToC + 分节读），而非 top-K。

---

## 6. 横切关注点

| 关注 | 做法 | 关联 |
|------|------|------|
| **访问隔离（🔄 scope）** | 统一解析器 `accessibleKbIds(user)`（个人 KB ∪ 可见 project KB）进 SQL `WHERE`，**绝不在各处散写 `WHERE user_id`**；`content_hash` 跨用户去重嵌入在**共享模型下恰是想要的**（一份嵌入多人可见），**前提是解析器铁实** | 第 11 篇 / D5 / Projects PRD §4 |
| **上下文协同** | 检索结果是工具返回，按需进上下文；大结果卸载到 `message_attachment`、留引用指针，不塞满窗口 | D3 |
| **检索内容护栏** | 检索回来的文档 = **间接提示注入面**；结构上分离"文档内容 / 指令"，低置信召回不当事实用 | D5 |
| **评测** | 每个 KB 维护黄金集（Q→相关块/期望答）；分层指标（Recall@K/MRR/NDCG + faithfulness/带正确引用）；改切分/换嵌入/调 rerank 都用它证伪 | D4 |
| **可观测** | `kb_search` 每次记 query/召回块/混合+rerank 前后排名/延迟 → 导成 span（复用 seq 流）；线上算 recall、调 K | D6 / 第 04 篇 |

---

## 7. 模型选型（必须先拍的决定）

- **Embedding 维度**：schema 写死 **1536**（OpenAI 系维度）。ARK/Zhipu 的 embedding 维度未必是 1536 → **要么选一个 1536 维兼容模型，要么改列维度**。**入库前必须先定，且换模型 = 重嵌全库。**
- **入口**：embedding/rerank **不走 SDK `query()`**（那是聊天，且钉死 0.2.112）；单开一个 OpenAI 兼容客户端打 ARK/Zhipu 的 `/embeddings`、`/rerank`，鉴权同 `ANTHROPIC_AUTH_TOKEN`/对应 key（第 14 篇坑一）。
- **不引入第二套 Agent SDK**（北极星红线）；embedding 客户端是纯 HTTP，不是 Agent 运行时。

---

## 8. 落地：分阶段 PR 拆解

| 阶段 | 内容 | Exit |
|------|------|------|
| **R0 · 地基** | pgvector 扩展 + HNSW 迁移；补 `documents`/`document_chunks` 列；**定 embedding 模型与维度**；嵌入/rerank HTTP 客户端 | 迁移就绪、能写入一条带 embedding 的 chunk、向量近邻查询能跑 |
| **R1 · 分流 + 最小入库** | 上传时 `token_estimate` 分流（小→不嵌）；BullMQ job：parse→结构切分→embed→pgvector+Meili；进度反馈 | 一个大文档能 ingest 到 ready，小文档保持 Read/Grep 不变 |
| **R2 · kb_search 工具** | `kb_search` MCP（混合召回 + RRF + rerank + small-to-big + 引用 + SQL 隔离），注册进 worker | Agent 能对已 ingest 文档检索、带页码引用、跨租户隔离有回归测试 |
| **R3 · 进阶召回** | 上下文增强（免费档→LLM 档）+ parent-child + 文档 summary/ToC + holistic 路由（通读走摘要） | 200 页 case 端到端：捞针走检索、通读走摘要 |
| **R4 · 护栏 + 评测 + 观测** | 检索内容注入护栏（D5）；黄金集 + 分层指标进 CI（D4）；kb_search→span（D6） | 改动可证伪、可回归、可观测 |

依赖：R0→R1→R2 串行；R3/R4 可在 R2 后并行。**R4 的评测建议尽早起最小版**（哪怕几十条黄金集），否则 R3 的调参无法判断好坏。

---

## 9. 风险与未决

- **解析是天花板**：扫描件/复杂表格不 OCR/不抽表 → 垃圾块 → 检索全错。R1 先验证解析质量。
- **入库成本/时延在离线侧**：必须后台、批量、限速（ARK 速率限制）；`content_hash` 让小改只重嵌变化块。
- **多租户去重 vs 隔离**：`content_hash` 共享嵌入省钱，但 `WHERE` 必须铁实，否则泄漏。
- **引用全程透传**：页码/小节从解析一路带到返回，否则可信度归零。
- **未决**：① embedding 模型 + 维度（阻塞 R0）；② ARK 网关是否支持 prompt cache（决定上下文增强成本）；③ 分档阈值默认值（需实测校准）；④ pgvector HNSW 在多文档×多用户下的索引规模/recall 调参。

---

## 10. 一句话收口

**OxyGenie 的 Advanced RAG = 只在"大文档/大语料 + 捞针"这一格触发的逃生通道：上传时按大小分流（小的不嵌）、离线把解析+结构切分+上下文增强做扎实、在线把 `kb_search` 和 `Read`/`Grep` 一起摊给 Agent 由 Loop 决定——目标是让 Agent 永远只看到 8 段带引用的精排结果，而不是那 200 页。** 基建几乎都在，工作量主要是把零件接起来 + 先拍 embedding 选型。
