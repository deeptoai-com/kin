---
title: "设计篇 01：Advanced / Agentic RAG —— 从「空架子 schema」到「Agent 自己会调的检索工具」"
slug: d1-advanced-rag
date: 2026-06-07
series: oxygenie-agent-harness
series_track: design
series_index: 20
keywords: [Agentic RAG, Advanced RAG, pgvector, embedding, rerank, 混合检索, MCP 检索工具]
prev: 19-retrospective
next: d2-long-term-memory
---

# 设计篇 01：Advanced / Agentic RAG —— 从「空架子 schema」到「Agent 自己会调的检索工具」

> 前 19 篇写的是 oxygenie **已有的**。从这一篇起进入**设计篇**：写 oxygenie **该有、但还没有**的能力——按 references（尤其 baby-agent 第七章 Agentic RAG）的"完整版"倒推。RAG 是最典型的缺口：oxygenie 的 `documentChunks` 表早就带了 `embedding vector(1536)` 列，却**一行都没写进去过**。本文回答两件事：① oxygenie 的检索现状到底空在哪（有代码为证）；② 在 oxygenie 的 per-message worker + MCP 架构里，Advanced RAG **该怎么落**——而答案会颠覆一个直觉：**RAG 不是喂给 prompt 的前处理管线，是 Agent 自己会调的一个工具。**

> 📐 本篇原为**设计篇**（写于 2026-06-07，现状部分有 `文件:行号` 为证，设计部分是"该有的"的落地方案）。
> ✅ **2026-06-13 实现回填**：这套设计已**整条落地并上生产**（`rag-line` → PR #153–#182，由 `RAG_ENABLED` flag 控制开关）。本篇保留原设计推理（它是"我们当初怎么想的"的完整记录），并在末尾新增 [实现回填](#实现回填2026-06-13设计落地了但有五处打脸) 一节，用真实代码对照——**设计预言对了一半，也实打实打了五次脸**，那五处"设计没料到/料错了"才是这篇最值钱的部分。

**章节跳转：**[问题](#问题陈述) · [现状：空架子](#oxygenie-的-rag-现状空架子基础设施) · [朴素方案](#朴素方案为什么不行) · [核心方案](#核心方案agentic-rag--检索是一个工具) · [实现要点](#关键实现要点落到-oxygenie) · [反直觉结论](#反直觉结论) · [生产坑](#三个生产坑) · ⭐[实现回填](#实现回填2026-06-13设计落地了但有五处打脸)

## 问题陈述

oxygenie 是"团队私有化知识工作台"——用户会把内部文档、代码库、资料丢进知识库，期待 Agent **能基于这些资料回答**，而不是凭空编。这就要求一套检索能力，同时满足四件事：

1. **语义召回**：用户问"我们去年的退款政策"，文档里写的是"售后服务条款第 3 条"——关键词对不上，必须靠**语义**而非字面匹配。
2. **多租户隔离**：用户 A 的检索结果里，**绝不能**混进用户 B / 别的知识库的内容（呼应第 11 篇）。
3. **不撑爆上下文**：知识库可能上万段，不能把 top-K 全塞进 prompt——要精排、要 Agent 按需取。
4. **不重写 Loop**：oxygenie 包着 Claude Agent SDK（第 03 篇），检索不能要求改 Loop，得顺着 SDK 的工具机制接进去。

## oxygenie 的 RAG 现状：空架子基础设施

先把账摊开——oxygenie 今天**不是 RAG 系统，是一个文档库 + workspace 文件管理器**。地基浇了，房子没盖：

| 该有的 | oxygenie 现状 | 证据 |
|--------|--------------|------|
| 向量列 | ✅ 有，但从没写入/查询 | `document.schema.ts:33` `embedding: vector('embedding', {dimensions:1536})` |
| chunk 仓库 | ✅ 定义了，**从未调用** | `document.repo.ts:6` `documentChunkRepo`（死代码） |
| 切分 / 入库 | ❌ 纯文件拷贝，无切分/解析/embedding | `routes/api/workspace/$sessionId.documents.ts`（S3→workspace 拷贝） |
| 文档解析 | ❌ 装了不用 | `mcp-store/markitdown-mcp`（入库流程从不调用） |
| 检索引擎 | ⚠️ 只有 BM25 关键词 | `src/search/meilisearch.ts`（无向量、无 rerank、无混合） |
| Embedding 调用 | ❌ 全无 | grep `embedding/embed/text-embedding` → 仅 schema 一处 |
| 检索到达 Agent | ❌ 无 KB 检索工具/MCP | `ws-query-worker.mjs` 注册的是 python/glm-image/bash/zhipu-*，**无 kb_search** |
| 查询改写/rerank/eval | ❌ 全无 | — |

注意一个关键事实：**Zhipu 那几个 MCP（search/reader/zread）是纯外部 web 工具**——web 搜索、读 URL、读 GitHub 仓库，**没有一个接到知识库**。所以今天用户把文档加进会话后，Agent 唯一的"检索"手段是**自己 `grep`/`read` workspace 里的文件**——小工作区能凑合，知识库一大、关键词对不上，就召不回。

**一句话现状：1536 维向量声明了、却永远是空的；检索靠关键词 + Agent 手动翻文件。** 缺的不是 schema，是从切分到检索的整条执行链。

> ✅ **回填**：上面整张表是 **2026-06-07 的起点快照**——每一行的 ❌/⚠️ 现在都已变 ✅（真实 `文件:行号` 见末尾 [实现回填](#实现回填2026-06-13设计落地了但有五处打脸)）。连那一行"`vector(1536)`"都改了——实际落地是 **1024 维**（见下文打脸 ①）。

## 朴素方案为什么不行

补 RAG 时，几条直觉路径各有死穴：

- **方案一：静态预检索 + 注入 prompt。** 每轮对话前，拿用户问题检索 top-K，把结果塞进 system prompt 再调 `query()`。这是最常见的"RAG = 检索后生成"。但它**和 oxygenie 的架构对着干**：Loop 是 SDK 的，你要在 `query()` 前硬插一段预处理；而且每轮都注入 top-K **白白烧上下文**，问题根本不需要检索时也注入，Agent 还**控制不了**检索时机和数量。
- **方案二：纯向量 or 纯关键词。** 只上 pgvector 向量检索——遇到精确的产品名、错误码、专有名词，语义相似度反而不如关键词；只用现有的 Meili BM25——语义改写的问题召不回。**单条腿都瘸**。
- **方案三：查询时现切现 embed。** 不建索引，每次检索把库里文档现场 embed 比对——几千段就慢到不可用。
- **方案四：继续让 Agent grep workspace 文件。** 就是现状。工作区一大、文档一多，关键词召回率崩，且没有语义、没有精排、没有跨会话的库级检索。

共同教训：**RAG 的难点不在"塞个向量库"，在"让检索既语义又精确、既隔离又不撑爆上下文、还不逼你重写 Loop"。** 静态注入违背架构、单腿检索召不全、现切现 embed 太慢、grep 不 scale。oxygenie 的答案要顺着它自己的两个原语走：**MCP 工具** 和 **per-message worker**。

## 核心方案：Agentic RAG —— 检索是一个工具

> **不在 `query()` 前面插一段"检索后生成"的管线，而是把检索做成一个 MCP 工具 `kb_search`，注册进 worker，让 Agent 自己决定何时调、查什么、取几条、要不要再查一次。** 离线把文档切分+embed 进 pgvector，在线走"向量 + BM25 混合召回 → rerank 精排"，全程按 `userId/kbId` 在 SQL 里过滤隔离。

```
离线（BullMQ 后台 job）                     在线（worker 里的 MCP 工具）
file → markitdown 解析 → 切分(overlap)      Agent 判断"要查" → 调 kb_search(query,k)
   → ARK/Zhipu embeddings → documentChunks      │
   → pgvector HNSW 索引 + content_hash 去重       ├─ 查询改写(可选, haiku 档廉价模型)
                                                 ├─ 向量召回(pgvector) ∥ BM25(Meili)
                                                 ├─ RRF 融合 → rerank 精排(Zhipu rerank)
                                                 └─ 返回 top-K(带引用/来源) → Agent 决定怎么用
                                                       ↑ WHERE userId=? AND kbId IN (...) 隔离
```

逐层看它怎么把四个约束各个击破：

**① 离线入库（补全那条死链）。** 用已经装着的 `markitdown-mcp` 把 PDF/docx/网页解析成 Markdown → **递归切分 + overlap**（代码文件按符号/函数边界切）→ 调 **embedding 模型**批量向量化 → 写进**早就存在的** `documentChunks`（`embedding` 列终于有值）。整条放进 **BullMQ 后台 job**（BullMQ 已在技术栈里，第 02 篇），上传即排队、增量入库；用 `content_hash` 去重，文档更新只重 embed 变化的块。

**② 混合召回 + 精排（补足检索的另一条腿）。** 在线检索同时走两路：**pgvector 向量召回**（语义）+ **Meili BM25**（精确词/专名）→ **RRF 融合** → 再过一遍 **rerank 模型**（Zhipu/ARK 的 rerank 端点）精排。向量负责"意思像"，BM25 负责"词对得上"，rerank 负责"真正相关"——三者各补一段。

**③ Agentic：检索是工具，不是前处理。** 把上面整套封进一个 `createSdkMcpServer({ name:'kb_search', tools:[...] })`，和 python/glm-image/bash 并列注册进 `ws-query-worker.mjs`（第 06 篇的工具机制）。于是**检索时机交给 Agent**：简单问候它不查，复杂问题它查、还能根据首轮结果**改写查询再查一次**（迭代检索）。这正是 baby-agent ch07 的 Agentic RAG，也完美贴合 oxygenie——**Loop 是 SDK 的，我们只递一把好用的检索工具，由 Loop 决定怎么用**。查询改写/多查询/HyDE 用便宜的 haiku 档模型（`doubao-seed-2.0-lite`，第 14 篇）做，成本可忽略。

**④ 隔离写进 SQL。** 向量检索的 `WHERE` 必须带 `userId = ? AND kbId IN (当前会话挂载的库)`——**在数据库层过滤，不是查完再过滤**（呼应第 11 篇：跨租户隔离是硬边界，不能事后补）。

## 关键实现要点（落到 oxygenie）

复用现有原语，几乎不引入新基础设施：

| 该补的 | 落点（用 oxygenie 已有的） |
|--------|---------------------------|
| 向量存储 | 现有 **Postgres** 开 `pgvector` 扩展，给 `documentChunks.embedding` 建 **HNSW** 索引（schema 已就位，`document.schema.ts:33`） |
| 入库 job | **BullMQ**（已在栈，第 02 篇）跑解析→切分→embed→写 chunk |
| 文档解析 | **markitdown-mcp**（已装，`mcp-store/markitdown-mcp`）从"摆设"变入库第一步 |
| Embedding / Rerank | **ARK / Zhipu 的 OpenAI 兼容 embeddings + rerank 端点**（ARK 网关已通，第 14 篇）——注意：**embedding 不能走 SDK `query()`**，那是聊天；要单独的 embeddings client |
| 关键词腿 | 现有 **Meilisearch**（`src/search/meilisearch.ts`）直接当 BM25 那一路 |
| 检索工具 | 新增 `kb_search` MCP，`createSdkMcpServer` 注册进 `ws-query-worker.mjs`（与第 06 篇工具同机制） |
| chunk 仓库 | 复活 `documentChunkRepo`（`document.repo.ts:6` 那段死代码） |

唯一真正"新"的依赖是 pgvector 扩展和一个 embeddings/rerank 客户端——其余全是把**已经躺在代码里、却没接线的零件**接起来。

## 反直觉结论

> [!IMPORTANT]
> **在一个"包了 Agent SDK"的 harness 里，RAG 的正确形态不是"检索后生成"的管线，是一个"Agent 自己会调"的工具。**
>
> 大多数 RAG 教程教你"问题进来 → 检索 top-K → 拼进 prompt → 生成"。但 oxygenie 的 Loop 是 SDK 的（第 03 篇）——你没有那个"prompt 之前"的口子去插管线，硬插就是和架构对着干。换个视角：**把检索做成 `kb_search` 工具，把"要不要检索、查什么、取几条、要不要再查"全交给 Loop**，反而更省上下文、更准、更自然。这就是 Agentic RAG 的精髓，也是本系列主线的又一次印证：**harness 的职责不是"替 Agent 检索"，是"给 Agent 一把好检索工具"——retrieve-then-generate 是你的活，when-to-retrieve 是 Loop 的活。**

再点破一层：oxygenie 的 RAG 缺口**不是设计缺口，是接线缺口**。`documentChunks` 表、`vector(1536)` 列、`documentChunkRepo`、markitdown-mcp、Meilisearch、BullMQ、ARK 网关——**该有的零件几乎都躺在代码里了，只是从没接到一起**。这比"从零设计"幸运得多，也更危险：空架子最容易被误读成"我们有 RAG"。

## 三个生产坑

> [!WARNING]
> **坑一 —— 多租户向量泄漏：过滤必须在 SQL 里，不能查完再过滤。** pgvector 的相似度检索若先取全局 top-K、再在应用层按 `userId` 过滤，会发生"别人的文档挤掉了你自己的命中"甚至直接泄漏。隔离条件 `userId/kbId` 必须进 `WHERE`、和 HNSW 检索一起执行（呼应第 11 篇：跨租户是硬边界，不是事后补丁）。

> [!WARNING]
> **坑二 —— embedding 的成本与延迟在入库侧，必须离线 + 增量。** 给整个知识库 embed 是真金白银 + 时间。绝不能在用户上传时同步阻塞，必须丢进 BullMQ 后台 job；文档更新时用 `content_hash` 只重 embed 变化的块，否则一次小改触发全量重嵌。rerank 在线那一跳也有延迟预算，top-K 别给太大。

> [!WARNING]
> **坑三 —— embedding 走错入口：它不在 SDK `query()` 里。** SDK 0.2.112 的 `query()` 是聊天接口，不产 embedding；而 SDK 钉死在 0.2.112、又走 ARK 网关（第 14 篇）。embedding/rerank 要单开一个 OpenAI 兼容客户端打 ARK/Zhipu 的 embeddings/rerank 端点，鉴权同样是 `ANTHROPIC_AUTH_TOKEN`/对应 key 的坑（第 14 篇坑一）。把 embedding 误当成 SDK 能力，是接 RAG 时第一个会撞的墙。

三个坑的共同根源：**RAG 是把"离线重活（切分/embed）"和"在线快路（检索/精排）"和"多租户硬隔离"缝在一起**——每条缝（隔离条件、入库时机、embedding 入口）错一处，要么泄漏、要么炸成本、要么根本跑不起来。

---

## 实现回填（2026-06-13）：设计落地了，但有五处"打脸"

上面是 2026-06-07 的**设计**。六天后（`rag-line` 分支，PR #153–#182）这套设计**整条上了生产**——`oxygenie.cc` 上传一份 716 页招股书 PDF，切成 1467 个带页码的 chunk，Agent 提问时自己调 `kb_search`、带页码引用作答。**核心判断全部成立**：检索确实做成了一个 Agent 自调的 MCP 工具、确实是向量+BM25 混合、确实离线 BullMQ 入库、确实在 SQL 里隔离。

但"设计对"和"做出来"之间，隔着五次结结实实的打脸。**设计篇的价值在推理，实现回填的价值在打脸**——下面每一处都标了真实 `文件:行号`。

### 真实落地的执行链（对照设计图）

```
离线（BullMQ rag queue / 本地 RAG_INGEST_INLINE 兜底）        在线（worker 里的 kb_search MCP）
PDF → parser sidecar(opendataloader, Java) → md + pageMap     Agent 判断要查 → kb_search(query,k=8)
   → 结构切块(parent≤2500 / child≤1024, 无 overlap)             │
   → sectionPath 前缀拼进正文 → doubao-vision embed @1024       ├─ 向量召回(pgvector,20) ∥ BM25(Meili,20)
   → documentChunks(content_hash 去重) + HNSW                   ├─ RRF 融合 → rerank【默认关】
                                                                ├─ small-to-big：child 命中→回取 parent
                                                                └─ [n] 标题—章节(p.X) 正文 → Agent 带引用作答
   ↑ 入库即排队，ingestStatus 状态机                              ↑ WHERE visibleDocumentsWhere ∧ ingestStatus='ready'
```

代码落点（全部可查）：管线 `src/server/rag/search.ts:85` `searchKb()`；切块 `src/server/rag/chunker.ts`、分档 `tier.ts:65`；解析 `src/server/rag/parser-client.ts` + `parser-sidecar/server.mjs`；embedding `src/server/rag/embedding.ts`；入库队列 `src/server/rag/queue.ts`；工具注册 `ws-query-worker.mjs:527`（`kbSearchTool`）→ `:578`（`createSdkMcpServer`）；总开关 `src/server/rag/flag.ts:13` `isRagEnabled()`。

### 设计 ✅ 对了什么

| 设计预言 | 现实 | 证据 |
|---|---|---|
| RAG 是 Agent 自调的工具，不是 prompt 前处理 | ✅ 完全成立，本篇最硬的判断 | `ws-query-worker.mjs:527-580` `kb_search` 与 python/glm-image 并列注册 |
| 向量 ∥ BM25 → RRF 融合 | ✅ 一字未改 | `search.ts:46-47` `VECTOR_RECALL/BM25_RECALL=20`，`fuse.ts` RRF |
| 离线 BullMQ 入库、上传即排队 | ✅ + 本地 `RAG_INGEST_INLINE` 兜底（无 Redis 时同步跑） | `queue.ts:9`、`ingest.ts:4` |
| `content_hash` 去重、只重嵌变化块 | ✅ | `ingest.ts:157-165` |
| 隔离写进 SQL 的 `WHERE`，不事后过滤 | ✅ | `search.ts:66` `visibleDocumentsWhere(userId, projectIds)` |
| embedding 不走 SDK `query()`，单独客户端 | ✅ 坑三应验 | `embedding.ts`（doubao/zhipu OpenAI 兼容端点） |

### 设计 ❌ 打脸五处（这才是重点）

**打脸 ① 维度：设计写满全篇的 `vector(1536)`，实际是 `1024`。** 1536 是 OpenAI `text-embedding-3` 的惯性数字；真上线用的是团队网关里的 **doubao-embedding-vision**（默认）和 zhipu embedding-3，两者落到 **1024 维**（doubao 靠 MRL 截断、zhipu 原生）。`src/db/schema/document.schema.ts:101` 现在写的是 `vector('embedding', { dimensions: 1024 })`。教训：**embedding 维度不是你选的，是你的 provider 选的**——设计阶段照搬教程数字，到落地必被真实 provider 纠正。

**打脸 ② 解析：设计说"让躺着的 `markitdown-mcp` 从摆设变入库第一步"，实际另起了一个 parser sidecar。** markitdown 解 PDF 的质量 + 拿不到**页码**，撑不起"带页引用"。最终造了一个独立的 **parser sidecar 容器**（Java 的 `opendataloader-pdf`，`parser-sidecar/server.mjs`），输出 markdown **+ pageMap**（`odl-page` 标记→行号→页码映射，`parser-client.ts`）；markitdown 退居"无 sidecar 时的兜底"。教训：**"复用已有零件"是设计阶段的美好假设，落地常被质量要求顶翻**——RAG 的上限往往卡在解析这一步，不是检索。

**打脸 ③ 切块：设计说"递归切分 + overlap"，实际是结构切块、零 overlap。** 没有用经典的滑窗 overlap，而是**沿 Markdown 标题层级**切：小文档（≤2500 tok，`tier.ts:65`）整篇不切；大文档切 **parent（章节，≤2500）/ child（段落包，≤1024，`chunker.ts:16-17`）** 两级。补上下文不靠 overlap，靠两招：**① sectionPath 前缀拼进正文再 embed**（"招股书>業務>研發"+正文，孤立句也自带语境）；**② small-to-big**——用 child 召回，命中后回取它的 parent 给模型（`search.ts:147`）。教训：**overlap 是无结构文本的妥协；只要你有结构（Markdown 标题），结构切块 + 父子回取比机械 overlap 更省更准。**

**打脸 ④ rerank：设计默认它是管线一环，实测把它默认关了。** 用真实黄金集（716 页书、24 题）跑消融：在生产 `k=8`（8 条全喂给模型读）下，**开不开 rerank，R@8 都是 96%**——rerank 只改善"前 4 名的排序"，但模型反正 8 条全看，收益被吃掉，却要白付 **+1.4 秒/查**。于是 `search.ts:56` `rerankEnabled()` 默认读 `RAG_RERANK_ENABLED`（默认 false）。教训：**rerank 不是"加了就好"，要拿你自己的 k 和数据量出来量**；何时该开——把 k 缩到 3-4、或做给用户看的引用排序时。**设计阶段对 rerank 的信仰，被一次 eval 打回原形。**

**打脸 ⑤ 查询改写/HyDE：设计说"用便宜的 haiku 档做"，实际一行没写。** `grep rewrite|hyde src/server/rag/` 是空的。不是忘了，是发现**没必要**：Agentic 架构下，Agent 本来就能"看完首轮结果不满意→自己换个说法再调一次 `kb_search`"——迭代检索由 Loop 天然承担，再加一层显式改写是重复投资。教训：**Agentic RAG 会"吃掉"一部分传统 RAG 的预处理环节**——when-to-retrieve 交给 Loop 后，连 how-to-rewrite 它也顺手干了。

### 最深的一课：设计完全没料到的"最后一公里"

> [!IMPORTANT]
> **工具注册成功 ≠ 模型会用它。** 这是设计篇通篇没有一个字提到、却差点让整个 RAG 白做的坑。
>
> 设计的反直觉结论说得漂亮——"把检索做成工具，何时查交给 Loop"。工具确实注册成功了（日志里 MCP servers 明明白白列着 `kb-search`）。可 Owner 实测：问"MiniMax 招股书里研发团队多少人"，**Agent 直接去 web search 了，根本没调 `kb_search`**。
>
> 根因：**Loop 决定"要不要查"的前提，是它知道"库里有没有可能有答案"——而它对自己的知识库一无所知。** 你不会去翻一个你不知道里面有什么的抽屉。
>
> 修法：worker 启动时拉一份 `/api/rag/overview`（用户当前可检索的文档清单：标题/页数/所属知识库），把它**注入系统提示**（`ws-query-worker.mjs:695-717`，`kbInventoryInstructions`）——"你现在能 `kb_search` 到这些文档：《MiniMax 招股书》716 页……遇到这些内容里的问题，**先查知识库，别去 web search**"。注入之后，Agent 一次就调对了。
>
> **这才是 Agentic RAG 真正的最后一公里**：retrieve-then-generate 是你的活、when-to-retrieve 是 Loop 的活——但"让 Loop 知道有什么可检索"是**你必须喂给它的前置知识**。设计篇的优雅结论，落地时栽在这个最朴素的认知缺口上。所有声称"Agent 自己会调检索"的系统，都得先回答："它怎么知道该调？"

### 设计篇预言之外、真实踩到的坑

原文「三个生产坑」（SQL 隔离、离线增量、embedding 入口）全部应验。落地又补了几个设计没写的：

- **页码引用是"可信"的命门，且要做到可点击。** 设计只字未提引用。现实：1467 chunk 全程带 `pageStart/pageEnd`，`kb_search` 返回 `[n] 标题—章节(p.21) 正文`（`ws-query-worker.mjs:558`），前端再把回答里的 `[1][2]` 渲染成**可悬停/点击弹出原文+页码的 chip**。对律师/财务这类非技术用户，**"[1] 能点开看到第 21 页原文"才是 RAG 兑现可信承诺的那一下**，否则 [n] 只是好看的噪音。
- **检索只认 `ingestStatus='ready'`。** `search.ts:66` 把状态过滤和隔离写在同一个 `WHERE`——还在切块/embedding 中的文档绝不会进检索结果（半成品召回比召不回更糟）。
- **总开关 flag 先行。** `RAG_ENABLED`（`flag.ts:13`）让 RAG 能"熄火上 main"——主干默认全黑，单个 release 显式开。新能力切上生产的标准做法，设计阶段没考虑发布策略。

一句话收尾这次回填：**设计篇负责想清楚"形态"（RAG 是工具不是管线，这点对得漂亮），实现负责把"形态"砸进现实的五个硬角——维度归 provider 管、解析定上限、结构胜过 overlap、rerank 要量不要信、以及最致命的"得先让 Loop 知道有什么可查"。** 一篇设计 + 一次回填，合起来才是一门完整的 RAG 课。

## 配图

1. ![RAG 现状 vs 该有的：空架子 → Agentic RAG](../assets/img/d1-rag-gap.svg)
2. ![离线入库 + 在线混合检索 + Agent 工具调用 全景](../assets/img/d1-agentic-rag.svg)
3. ![检索是工具不是管线：query() 内 Agent 自主调用 kb_search](../assets/img/d1-retrieval-as-tool.svg)

## 下一篇

→ [设计篇 02：长期记忆](./d2-long-term-memory.md)

RAG 解决"查外部资料"，但 Agent 还缺"记住你"。下一篇按 baby-agent 第六章 + HarWork 第 06 篇倒推 oxygenie **该有、却没有**的长期记忆：两层记忆（全局 / 工作区）、LLM 驱动的记忆更新、注入 system prompt——以及它和本篇 RAG、和上下文工程怎么协同。

---

📌 系列阅读地图：[reading-map.md](../reading-map.md)
🔗 现状对照：本篇"空架子"部分基于 oxygenie `main` 2026-06-07 快照；设计部分已于 **2026-06-13 整条落地上生产**（`rag-line` → PR #153–#182，`RAG_ENABLED` flag 控制），真实代码与"五处打脸"见 [实现回填](#实现回填2026-06-13设计落地了但有五处打脸)。
