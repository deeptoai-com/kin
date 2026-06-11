# RAG 最终实施方案（终审锁定版）

> 日期：2026-06-10 ｜ 状态：**已锁定，按此实施** ｜ 实施负责：Claude（Owner 授权全线）
> 设计理据见《Advanced RAG 设计》（同目录）；本文只锁**有约束力的实施决策**与设计稿的偏差修正。
> 上游：《RAG 复工实施计划》（外层仓）+《T0 决策备忘》（同目录）+《代码库审计》（同目录）。
>
> 🔄 **2026-06-11 修订**：**D5（分流语义）与 R1 解析路径已被《[RAG 入库 UX + 解析路由方案](./2026-06-11-rag-ingest-ux-parse-routing-spec.md)》取代** —— 解析引擎改为用户选（系统推荐+可改）、上传/解析/检索三步解耦、知识库文档全量进向量库（大小只决定切法不决定嵌不嵌）。本文 D1–D4/D6–D10 仍有效；读 D5 与 R1 时以新方案为准。

## 0. 范围

只造设计稿的"③ 档"：**大文档/大语料 + 捞针**的语义检索通道。小文档维持 workspace `Read`/`Grep` 现状不动；通读类任务走摘要路由（R3）。**不引入第二套 Agent SDK；聊天主链路（ws-server/worker SDK 调用）不动。**

## 1. 锁定决策（D1–D10）

| # | 决策 | 内容 | 依据 |
|---|---|---|---|
| D1 | Embedding | 智谱 `embedding-3` @ **1024 维**；`document_chunks.embedding` 由 `vector(1536)` **改为 `vector(1024)`**（表空，零成本）；HNSW(cosine) 索引 | T0 实测 |
| D2 | 访问基元 | `documents`/`knowledge_bases` 加 **`project_id` nullable（null=personal）**，与已上线 `agent_session` 同构；**不上 scope 枚举**。`access.ts` 扩展 `accessibleKbIds(userId)` + `visibleDocumentsWhere(userId, projectIds)`，检索 SQL 一律经解析器 | 重定基 §3 |
| D3 | chunks 表 | 增列：`document_id`（FK→documents，**新增**——现表只挂 file_id，多文档共享文件时语义不清）、`section_path`、`page_start/page_end`、`parent_chunk_id`、`content_hash`、`context_prefix` | keystone 文档 + 现表核查 |
| D4 | 入库形态 | 纯函数 `ingestDocument(documentId)`（幂等、按 content_hash 增量）+ BullMQ 包装。**独立队列 `rag`**（旧镜像 worker 只订阅 `system` 队列，新队列不会被吞）；本地开发 `RAG_INGEST_INLINE=true` 走进程内执行，不依赖 worker | 共享栈陷阱实证 |
| D5 | 分流 | `token_estimate` 启发式（CJK≈1/字符，其余≈1/4字符）；`rag_tier`: `inline`(<8k) / `grep`(8k–阈值) / `rag`(≥阈值)；阈值 `RAG_TIER_RAG_MIN_TOKENS` 默认 **20000**。只有 `rag` 档入队嵌入 | 设计稿 §2 |
| D6 | kb_search 形态 | worker 内 sdk-MCP 工具，handler **HTTP 回调 app**（`POST ${APP_URL}/api/rag/search`）。worker 保持无 DB、无智谱 key（既有架构边界）；鉴权用 ws-server 随 spawn 签发的**短期签名 token**（沿用 preview 签名模式），不把 cookie 放 worker env（防经 Bash 子进程泄漏） | 边界核查：worker 零 DB 引用 |
| D7 | 检索管线 | 双路并行：pgvector cosine（chunks）∥ Meili **chunks 新索引** BM25 → RRF 融合 → 智谱 rerank 精排 → small-to-big（返回 parent 小节）→ top-8 + `section_path`/页码引用。双路 SQL/filter 一律带可见文档约束 | 设计稿 §5 + T0（rerank 可用） |
| D8 | Meili | ingest 时写 chunks 索引；顺手给 `document.repo.ts` 补 `getAllDocumentsForSearch()`，让 worker 既有 `reindex-all` job 从软 no-op 变真 | 终审发现 |
| D9 | 上下文增强 | v1 只做免费档：`context_prefix = 文档标题 + section_path`，嵌入前拼接；LLM 档（块摘要）留 R3，按 prompt-cache 成本评估 | 设计稿 §4.1 |
| D10 | 切块 | 结构感知：Markdown 标题层级切 **parent**（section，≲2500 tokens），parent 内按大小切 **child**（目标 ≤1024 tokens——智谱单条 3072 硬限的安全余量）；`content_hash = sha256(context_prefix + text)` | 设计稿 §4 + T0 限额 |

## 2. 对既有文档的修正（终审核查结论）

1. **审计报告勘误**：`src/worker/processors/reindexDocuments.ts` **不是**"自引用无限递归空壳"——它是真实现，只因 `document.repo.ts` 未导出 `getAllDocumentsForSearch` 钩子而落入软 no-op（`indexed: 0`）。D8 将其补真。
2. `src/db/repositories/document.repo.ts` 被 worker **动态 import**——**不删**，R0/R1 扩展之。其余 `todo-file-upload/**` 维持死代码判定（worker/search 零引用），C0 删除。
3. keystone 文档的"全站 scope 枚举"按 D2 降级为 project_id 惯例；该文档保留作历史参考。

## 3. 阶段与 Exit（每阶段独立 PR → CI → 合 main）

| 阶段 | 分支 | 内容 | Exit |
|---|---|---|---|
| **C0** | `chore/rag-c0-cleanup-docs` | 删 `src/todo-file-upload/**`；五份文档进 main（审计/T0/本方案/两份设计稿）；更正 CLAUDE.md MCP 表述 | typecheck 错误数下降；CI 绿 |
| **R0** | `feat/rag-r0-foundation` | D1/D2/D3 一次迁移 + HNSW；embedding/rerank HTTP 客户端（含 429 退避、批 ≤64）；`accessibleKbIds`/`visibleDocumentsWhere` + 单测；local 脚本透传 `ZHIPU_API_KEY` | 单测过；手工脚本能写入一条 1024 维 chunk 并 cosine 近邻查回；非成员查不到 |
| **R1** | `feat/rag-r1-ingest` | 分流写 `rag_tier`；`ingestDocument`：parse(复用 document-parser)→结构切块→嵌入→pgvector+Meili chunks→summary/toc→ready（进度回写）；`rag` 队列 + worker 注册 + inline 模式；KB 面板进度/徽标；D8 钩子 | 一份大文档 ingest 到 ready 可被近邻查到；小文档不入队；进度可见 |
| **R2** | `feat/rag-r2-kb-search` | `/api/rag/search`（双路+RRF+rerank+small-to-big+引用+解析器隔离）；worker sdk-MCP `kb_search` + 签名 token；跨项目隔离回归测试 | Agent 实测对已 ingest 文档检索且带引用；非成员检索不到他人项目文档（用例固化） |
| **R3/R4** | 后续 | LLM 档上下文增强、通读路由 ∥ 黄金集、注入护栏、检索 trace | 见复工计划 |

## 4. 环境与配置（新增项汇总）

```
ZHIPU_API_KEY=<key>                    # 必填（嵌入+rerank）；本地在 .env.local zhipu 段
EMBEDDING_BASE_URL=https://open.bigmodel.cn/api/paas/v4   # 默认值即此
RAG_TIER_RAG_MIN_TOKENS=20000          # 分流阈值
RAG_INGEST_INLINE=false                # true=进程内入库（本地开发）
```
部署侧：compose 给 app + worker 注入 `ZHIPU_API_KEY`；`local-backend.sh` 模板加 zhipu 透传段（R0 内完成）。

## 5. 一句话收口

**全部决策已锁：1024 维智谱嵌入、project_id 惯例隔离、独立 `rag` 队列、kb_search 经 app 回调——C0 清场起步，R0→R1→R2 每阶段一个绿色 PR，黄金集在 R2 落地时同步起步。**
