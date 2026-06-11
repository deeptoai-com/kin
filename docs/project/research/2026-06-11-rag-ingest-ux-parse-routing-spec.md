# RAG 入库 UX + 解析路由方案（已定，按此实施）

> 日期：2026-06-11 ｜ 状态：**已与 Owner 商议确定，作为实施依据** ｜ 实施：Claude
> 关系：**修订**《[RAG 最终实施方案](./2026-06-10-rag-final-implementation-spec.md)》的 D5（分流语义）与 R1 解析路径；其余 D 项不变。R0–R4 已落地的代码（迁移 0026/0027、kb_search、trace、护栏、评测）均保留。

## 0. 一句话

**解析引擎由用户选（系统推荐+可改），不再用文件大小猜；上传/解析/检索三步解耦；知识库文档全量进向量库（保证 kb_search 不漏），文件大小只决定"怎么切"而非"嵌不嵌"。**

## 1. 背景：原方案的弱点（Owner 指出）

原 D5 用 `token_estimate` 三档（inline/grep/rag）**同时**决定了两件事：怎么解析、要不要语义检索。问题：
- **文件大小判断不了 PDF 复杂度**。10MB 全是图（扫描件，页数不多但体积大）vs 25MB 纯文字，大小相近但解析路径完全不同；版式复不复杂、有没有文本层，从元数据读不出来。
- 规则猜不准的事，**人一眼能判断** → 交给用户选更可靠。
- 25MB 这个阈值不是唯一标准，本就不该作为解析决策的依据。

## 2. 核心决策记录

| # | 决策 | 理由 |
|---|---|---|
| **DR-1** | 解析引擎**用户选**，系统给**推荐+可改**（不纯手动，照顾非技术用户：律师/金融/白领） | 复杂度无法从元数据可靠推断；引导式 UX 是北极星 |
| **DR-2** | 三档解析路由：**简单 PDF / 结构化 PDF / 扫描·图片(OCR)**，各走不同引擎，统一落地 Markdown | Owner 定档 |
| **DR-3** | **上传 / 解析 / 检索三步解耦**：上传成功 → 选引擎 → 异步解析（进度）→ 落地 Markdown（可预览/重解）→ 解析完才谈检索 | 解析（尤其 OCR）慢，必须异步；复用既有 BullMQ |
| **DR-4** | **聊天里上传 ≠ 知识库**：聊天附件落 session workspace，不进向量库、不进知识库；知识库文档才进检索体系 | 临时附件 vs 持久可检索文档，两种语义 |
| **DR-5** | **知识库文档全量进向量库**，不做"按必要性部分进" | "部分进"会让 kb_search 静默漏掉没嵌入的文档——最坏的信任崩塌；嵌入成本比 LLM 低两个数量级，单组织规模零压力 |
| **DR-6** | 文件大小（token）只决定**怎么切**，不决定**嵌不嵌**：小文档=整篇 1 个 chunk（不切，保全局），大文档=结构化 parent/child 切块 | kb_search 永远搜全量知识库；小文档不切避免破坏全局结构 |
| **DR-7** | 唯一不在向量库的知识库文档 = **解析失败的**（OCR 没接/失败），且**状态可见可修**（UI 显示"解析失败，请换 OCR 重试"），非静默盲区 | 与"主动不嵌入"有本质区别 |

## 3. 解析路由（三档 → 引擎映射）

| 用户档位 | 引擎 | 现状 | 备注 |
|---|---|---|---|
| **简单 PDF** | 快速文本层直取（`opendataloader --reading-order off` 或 pdftotext） | opendataloader 实测可用 | 快；纯文字、不在乎表格/标题层级 |
| **结构化 PDF** | **opendataloader 完整模式**（标题层级 + 表格 + 页码 + 阅读顺序） | 实测可用（中文文字版 PDF 标题层级提取完整，4s/份） | 合同/招股书/研报；页码喂 chunks 的 `page_start/page_end`（现为空） |
| **扫描 / 图片** | **OCR**（接 Owner 的既有 OCR 项目；opendataloader `--hybrid` 也预留 OCR 后端口） | **待接入** | 图片型 PDF、扫描件 |
| docx/pptx/xlsx/… | markitdown（现状链） | 已有 | opendataloader 只管 PDF，其余不动 |

**系统推荐探测**（启发式，DR-1）：上传后用 opendataloader 快速模式跑一遍（3–4s），得文本字符数 C / 页数 P：
- `C/P` 极低（每页近乎无字）→ 推荐 **扫描·OCR**（"检测到每页文字很少，可能是扫描件"）
- 有文本层 + 检测到表格/多级标题 → 推荐 **结构化**
- 否则 → 推荐 **简单**
推荐附理由文案；用户可一键接受或改选。阈值可配。

## 4. 上传 / 解析 / 检索流程（DR-3）

```
点击上传 → 弹窗（拖拽 + 限定 .pdf/.docx/…）
   ↓ 上传成功（文件落 S3/MinIO + 建 document 行, parse_status=pending）
快速探测 → 推荐解析档位
   ↓ 用户确认/改选引擎
异步解析（BullMQ 'rag' 队列；进度条 parse_status=processing→ready|failed）
   ↓ 落地 Markdown（写 documents.content；可预览；不满意可换引擎重解）
   ↓ 仅知识库文档：解析 ready 后自动进向量库
按大小决定切法（DR-6）：小=单 chunk / 大=结构化切块 → 嵌入 → pgvector + Meili
```

聊天附件走另一条既有路径（workspace 物化，Agent Read），到"落地 Markdown"为止，**不进检索**。

## 5. 知识库 vs 聊天附件（DR-4 边界表）

| | 聊天里上传 | 知识库里上传 |
|---|---|---|
| 存储 | `message_attachment` → session workspace | `documents` + `kb_documents` |
| 解析 | 同三档路由，落 workspace 的 `.md` | 同三档路由，落 `documents.content` |
| 进向量库 | ❌ 否 | ✅ **全量**（DR-5） |
| Agent 怎么用 | 当前会话 Read/Grep | kb_search（全量可达）+ 可选 sync 进 workspace 精读 |
| 生命周期 | 临时、单会话 | 持久、项目级 |
| 交叉 | 可显式"提升进知识库"（F5） | — |

## 6. tier 语义修订（DR-6）：从"嵌不嵌"到"怎么切"

原 `tier.ts` 的 `inline/grep/rag` 隐含假设"文档在某 session workspace"（grep/Read 才有对象）。知识库文档是项目级、不在某 workspace，消费通道只有两条：**kb_search（全量）** + **可选 sync 精读**。因此：

- **知识库这条线**：`inline/grep/rag` 退场，改为按大小决定切法——
  - 小（≤ 单 chunk 安全上限，约 2500 tok）→ **整篇 1 个 chunk**（kb_search 召回后返回全文）
  - 大 → 结构化 parent/child 切块（现有 chunker）
  - 两者都嵌入、都可被 kb_search 检索。
- **聊天附件这条线**：`inline/grep/rag` 三档**保留**（那里才有 workspace Read 语义）。

`token_estimate` 仍写库，但知识库语境下只用于选切法。

## 7. opendataloader-pdf 集成

- 实测：npm `@opendataloader/pdf`（Node 原生，23MB fat jar）；纯本地、Apache 2.0；中文文字版 PDF 标题层级提取完整；内容安全过滤默认开（与 R4 注入护栏同向）。
- **接入**：`document-parser.ts` 的 `PARSERS` 链——PDF 首选 opendataloader（简单档 `--reading-order off`，结构化档完整模式），markitdown 退为 PDF 降级 + 其余格式主力。
- **Java 运行时（已定 2026-06-11，Owner 拍板）**：**独立 parser sidecar 容器**（自带 JRE + opendataloader），app/worker 主镜像不动。最干净、职责分明、易扩展——**后续 OCR 引擎也归这个 sidecar**。代价：多一个 compose 服务 + 一层 HTTP 调用（ingest worker → parser sidecar）。U1 落地。

## 8. 数据模型变更（实施时落迁移）

`documents` 表新增：
- `parse_method` text — `simple | structured | ocr`（用户所选/系统推荐）
- `parse_status` text — `pending | processing | ready | failed`（与 ingest 解耦：先解析，后嵌入）
- 复用现有 `ingest_status`（嵌入阶段）、`ingest_progress`、`toc`、`embed_model/dim`

> `parse_status`（PDF→MD）与 `ingest_status`（MD→向量）分两个状态机：解析可独立重试/换引擎，不重跑嵌入。

## 9. 对现有代码的影响

| 文件 | 改动 |
|---|---|
| `document-parser.ts` | PARSERS 链加 opendataloader（PDF 简单/结构化两引擎）；解除 25MB `too-large` 短路对知识库文档的拦截（大文档正是要解析的） |
| `tier.ts` | 知识库语境语义改为"切法"（single/structured）；inline/grep/rag 仅留给聊天附件 |
| `ingest.ts` | 前置 parse 阶段（content 空 + 有 PDF → 先解析再嵌入）；小文档走单-chunk 分支 |
| `queue.ts` / worker | 解析作业（可与嵌入同队列不同 job 名）；Java 运行时按 §7 决策落位 |
| `documents.server.ts` | 上传不再按大小自动定 ragTier；新增"选引擎/重解析"server fn |
| schema + 迁移 | §8 新列 |
| 前端 | 上传弹窗（拖拽/格式限定）+ 推荐档位 + 引擎选择 + 解析进度 + Markdown 预览/重解 |

## 10. 分阶段实施（每阶段独立 PR → CI → 合 main）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **U0** | schema（parse_method/parse_status 迁移）+ 解析/嵌入两状态机解耦的后端骨架 + 知识库全量嵌入 + 小文档单-chunk + kb_search 对单-chunk 返回全文 | 无 |
| **U1** | opendataloader 集成（简单/结构化两引擎 + 快速探测推荐）；解除大文档解析短路 | **§7 Java 决策** |
| **U2** | 前端：上传弹窗 + 推荐+选引擎 + 解析进度 + Markdown 预览/重解 | U0/U1 |
| **U3** | 扫描·OCR 引擎接入 | **Owner 的 OCR 项目** |

U0 不依赖任何外部决策，可立即开工。U1 卡 Java 决策，U3 卡 OCR 项目。

## 11. 待 Owner 拍板

1. ~~Java 运行时落位~~ → **已定：独立 parser sidecar（2026-06-11）**，见 §7。
2. **OCR 项目接入方式**（路径/仓库）——阻塞 U3。
3. 真实招股书语料（文字版）——黄金集 v2 + 验证整条解析→检索链路。

## 12. 进度

- **U0**（schema 解析/嵌入两状态机 + 知识库全量嵌入 + 小文档单 chunk）：实施中（2026-06-11）。
- U1（opendataloader sidecar）、U2（前端）、U3（OCR）：待 U0 后 / 待依赖。
