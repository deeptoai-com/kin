# T0 决策备忘 —— Embedding / Rerank 选型（实测版）

> 日期：2026-06-10 ｜ 状态：**已实测，待 Owner/B 确认后即解锁 R0**
> 上游：《RAG 复工实施计划》T0 阶段（外层仓 `docs/5. 研发实施/.../1. 实施计划/2026-06-10-RAG复工实施计划.md`）
> 方法：用 Owner 提供的智谱 key 对生产端点**真实调用**实测（非纸面调研）。key 不入库、不入文档，存于 gitignored `.env.local`。

## 1. 决策摘要

| 决策项 | 结论 |
|---|---|
| **供应商** | 智谱 BigModel（Owner 已供 key）。独立于 ARK 聊天网关，互不影响 |
| **Embedding 模型** | `embedding-3` |
| **向量维度** | **1024**（文档化取值）→ R0 迁移把 `document_chunks.embedding` 从 `vector(1536)` 改为 `vector(1024)`（表为空，改维零成本） |
| **Rerank** | ✅ 可用：`POST /api/paas/v4/rerank`，model=`rerank` → **R2 直接做"混合召回+精排"完整版**，无需降级纯 RRF |
| **接入方式** | 纯 HTTP 客户端（fetch），`Authorization: Bearer`。**不引入第二套 Agent SDK**（北极星红线不触碰） |
| **环境变量** | `ZHIPU_API_KEY` + `EMBEDDING_BASE_URL`（默认 `https://open.bigmodel.cn/api/paas/v4`）。**不复用** `ANTHROPIC_AUTH_TOKEN` |

## 2. 实测记录（2026-06-10，生产端点）

| # | 探针 | 结果 |
|---|---|---|
| ① | `embedding-3` + `dimensions:1024`，批量 2 条 | HTTP 200，2×1024 维，25 tokens，1.35s |
| ② | `embedding-3` 不带 dimensions | HTTP 200，**默认 2048 维** |
| ③ | `embedding-3` + `dimensions:1536` | HTTP 200，**返回了 1536 维**——但官方文档只列 256/512/1024/2048，属**未文档化行为，不可依赖**（这就是不保留现表 1536 的原因） |
| ④ | `rerank`，query+3 docs，`top_n:2`+`return_documents` | HTTP 200，1.40s，返回 `relevance_score` 排序正确（正确答案 1.0；但第二名 0.99998——**分数区分度偏弱，R4 黄金集须验**） |
| ⑤ | 批量上限：64 条 ×1024 维 | HTTP 200，64 向量，1206 tokens，5.24s |

**文档要点**（docs.bigmodel.cn 文本嵌入页）：`POST /api/paas/v4/embeddings`；embedding-3 单条 ≤**3072 tokens**、单请求 ≤**64 条**；embedding-2（1024 固定/512 tokens）不选。

## 3. 维度选 1024 的理由（vs 2048 / 1536）

1. **16G 单机北极星**：1024 比 2048 省一半向量存储与 HNSW 内存，索引构建/查询也更快；
2. Matryoshka 式降维在 1024 的召回损失通常很小，且我们有 R4 黄金集可证伪——若实测召回不达标，表为空期间升 2048 的代价仅是"重嵌已入库文档"；
3. 1536 实测可用但未文档化（探针 ③），供应商随时可能收紧到文档值，不押注。

**连带规则**：`documents.embed_model='embedding-3'`、`embed_dim=1024` 随行写入；**换模型/维度 = 全库重嵌**，靠这两列识别旧向量。

## 4. 吞吐与成本量级（实测推算）

- 批量 64 条/请求 ≈ 5.2s → 单线程 ≈ **700+ 块/分钟**；200 页文档（约 300–600 块）嵌入耗时 **< 1 分钟**，完全satisfies"后台入库+进度条"体验。
- token 消耗极小（64 块中文 ≈ 1200 tokens）。价格页未能抓取（404），**待在智谱控制台核对单价**——但量级上整库入库成本可忽略。
- 在线侧：query embedding ~1.3s + rerank ~1.4s → `kb_search` 端到端 ~3s 量级（双路召回并行 + HTTP keep-alive 可再压）。可接受。

## 5. 落地配置与遗留

1. **key 存放**：已追加到 `oxygenie/.env.local`（gitignored）`# >>> zhipu` 段。⚠️ **坑**：`scripts/local-backend.sh up` 会整文件重写 `.env.local`——重跑后该段会丢，需重加。**R0 子任务**：local-backend.sh / local-fullstack.sh 增加 ZHIPU 段透传（从 shell env 或宿主配置读），compose 部署侧把 `ZHIPU_API_KEY` 加入 worker/app 环境。
2. **限速/退避**：本轮未触发限流；R1 管线仍须实现 429 退避 + 并发上限（保守起步：串行批量即可满足吞吐）。
3. **切块上限**：单条 ≤3072 tokens 是硬限 → 切块器目标块长 ≤1024 tokens（含 context_prefix 后仍留余量）。
4. **rerank 分数区分度偏弱**（探针 ④）：R2 先按分数排序使用；R4 黄金集专门验"rerank 是否真比纯 RRF 提升"，不达标则 rerank 降为可选层。

## 6. 一句话收口

**智谱 embedding-3 @ 1024 维 + 官方 rerank，实测全通：R0 迁移按 `vector(1024)` 落表，R2 直接做混合+精排完整版——T0 解除阻塞，R0 可以开工。**
