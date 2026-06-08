# OxyGenie 文件上传 · 解析 · 会话↔文档库 地基设计

> 状态：**设计稿 + 实施计划** · 2026-06-07 · 与 [Advanced RAG 方案](./2026-06-advanced-rag-design.md) **分离**。
> 关系：本文是 RAG 的**前置地基（R0.5）**——RAG 是"大文档捞针"的逃生通道，但今天连"单个文件被 Agent 读到"都没闭环。本文只做到"文件可靠地、以文本形式、被 Agent 用上"，**不做 chunk/embed/检索**（那是 RAG 文档）。
> 北极星对照：自托管 / 单组织 / 多用户（半可信同事）/ ARK + SDK 0.2.112 / 可部署性优先。

## 0. 目标 / 非目标

**目标**：用户上传**各类文本文件**（txt/md/csv/json/代码 + pdf/docx/xlsx/pptx），在**同一个会话里**被 Agent 可靠读到、用上；并让会话文件能**按需提升**到 `agents/documents` 文档库（为 RAG 接力）。
**非目标**：chunking、embedding、向量检索、知识库语义检索——全部留给 RAG 方案（R0+）。

## 1. 现状：三个断点（有据）

| 断点 | 现象 | 出处 |
|------|------|------|
| **富文本没解析** | `markitdown-mcp` 装了但 **`query()` 的 `mcpServers` 没注册它**；Agent `Read` 碰 pdf/docx = 二进制乱码 | `ws-query-worker.mjs`（mcpServers 不含 markitdown）；`src/mcp-store/markitdown-mcp/` |
| **上传/发送没定序** | `chat-composer` 的 `handleSend` 不 await 上传完成；worker 可能在文件落盘前 spawn → 空读 | `src/components/claude-chat/chat-composer.tsx`（handleSend）|
| **文档页文件不递给 Agent** | composer 附件经 `runConfig.custom.attachments` 注入 prompt；文档页加的文件只落 `sessionDocument`+盘，**无等价注入** | `ws-adapter.ts`（buildAttachmentsBlock）vs 文档页路径 |

**另一个结构问题**：上传字节直接写进 per-session **workspace 当源**（`…/workspace/{file}`，`$sessionId.files.ts:174-179`）。references 无一这么做。

## 2. references 怎么做的（简表，详见各 file:line）

| 维度 | LobeChat ⭐ | LibreChat | open-webui | onyx |
|------|-----------|-----------|-----------|------|
| 文件落地 | S3 预签名直传 `files/{date}/{uuid}` | 可插拔 strategy(local/S3/…) | storage provider 抽象 | S3-backed FileStore |
| 文件实体 | 一等 `File`(uuid)+**hash 去重**(globalFiles) | `file`(file_id,context,embedded,text) | file 表(path,meta) | FileRecord+FileOrigin |
| 解析 | `packages/file-loaders`(每型一 loader)，**解析存 `documents.content`** | rag_api / parseText 存 `text` | 7 种可插拔引擎 | **MarkItDown** |
| 聊天文件 | **解析+全文 inline，不 embed** | context 路径 inline / file_search 路径 embed | 同管线 embed(每文件一 collection) | **解析后 in-memory，不 embed** |
| 知识库文件 | **异步** chunk+embed+检索 | rag_api embed(同步) | embed 进 KB collection | **async Celery 连接器**索引 |
| 聊天→KB | **同一 File，加关联**(addFilesToKnowledgeBase，不复制) | — | 加进 Knowledge | 经连接器 |

**关键共识**：① 文件落**对象存储**、DB 一行 `File` 实体；② 解析是 **loader/converter 抽象**、解析文本**存下来**；③ **分档**：聊天=解析/inline、知识库=chunk/embed；④ 聊天文件可**按关联提升**到 KB（同实体不复制）。
**你点名的 LobeChat 是分档派**，正好对上我们之前的"三档阶梯"。

## 3. OxyGenie 目标模型（落到已有的表）

幸运点：**LobeChat 模型几乎 1:1 落在 oxygenie 已有 schema 上**——`document`(.content 存解析文本)/`message_attachment`(会话附件)/`session_document`/`kb_document`(关联) 全在，只差接线。

- **存储**：`document` 当**解析后的文件实体**（`content` = markitdown 文本，`fileType`/`title`/`userId` 已有）；原始字节进**对象存储/MinIO**（已在栈）为规范家；workspace = **解析文本的投影**（DB 为真相、workspace 为投影，与 Skills 的 `~/.claude` 投影同构）。
- **解析**：用**已装的 markitdown** 当 loader，pdf/docx/xlsx/pptx → markdown 文本；txt/md/csv/json/代码直接用。
- **分档（对齐三档）**：
  - **聊天上传** = 解析 → **把解析文本物化进本会话 workspace**（Agent `Read`/`Grep` 直接读）+ 小文件可 inline 摘要；**不 embed**。
  - **提升到文档库/KB** = 给**同一个 `document`** 建 `kb_document` 关联；**这时才**异步 chunk+embed（交给 RAG R1+）。
- **oxygenie 专属适配**：references 是 chat-completion 只能 inline；**oxygenie 是带 Read/Grep 的文件系统 Agent**，所以"物化解析文本到 workspace"比 inline 更稳、还能 Grep——这是本地化的关键差异。

## 4. 安全 / 效率

- **解析在不可信输入上运行**：markitdown 跑用户文件，**经沙箱/受控子进程**执行（复用 ExecutionRuntime/python 沙箱思路，第 05/10 篇），限时限内存；解析失败优雅降级（存错误元数据，不崩）。
- **隔离**：文件路径含 `userId/sessionId`；`validateRelativePath` 已在用；提升到 KB 的关联查询带 `userId` 过滤（第 11 篇）。
- **去重（可选，后置）**：LobeChat 式 hash 去重（`globalFiles`）省存储，但**前提是访问过滤铁实**；地基阶段可先不做，先把单文件闭环。
- **大小/类型闸**：上传大小上限 + 类型白名单；超大文件走 RAG 分档（本文不处理，标记 `rag_tier`）。

## 5. 分阶段安全实施（每步小、可验证、可回滚）

> 原则：先修"读不到"，再谈"模型/实体/去重"。每步独立可上、独立可回滚。**先不碰 embedding。**

| 阶段 | 内容 | 验证 | 风险 |
|------|------|------|------|
| **F0** | **验证 markitdown 运行时可用**：Dockerfile 是否装了 markitdown python 包；能否服务端调用（markitdown-mcp 怎么跑） | 在 worker 镜像里 `markitdown <pdf>` 有输出 | 只读，零风险 |
| **F1** | **composer 等上传完成再发**（消除竞态） | 上传大文件后立刻发，Agent 不再空读 | 前端单点，低 |
| **F2** | **解析落盘**：上传富文本时，markitdown → 把 `<name>.md` 物化进 workspace（原文件保留）；解析文本写 `document.content` | 上传 pdf，workspace 出现可读 `.md`，Agent `Read` 到文本 | 后端 upload 路由，contained |
| **F3** | **把文件路径可靠递给 Agent**：composer 附件 + 文档页两条路径都注入"附件信息（用 Read 读）" | 文档页加的文件，Agent 也知道在哪 | prompt 注入，低 |
| **F4** | **文件实体规范化**（可选）：原始字节进 MinIO 为规范家、workspace 为投影；hash 去重 | 重复上传不重复存 | 较大，可后置 |
| **F5** | **会话文件→文档库"提升"**：一键给 `document` 建 `kb_document` 关联（**不复制**），为 RAG 接力 | 会话文件出现在 `agents/documents`，仍是同一实体 | 中，接 RAG 边界 |

**与 RAG 边界**：本文止于 F5 的"关联提升"；F5 之后的 chunk/embed/检索 = RAG 方案 R1+。

## 6. 实施顺序与本次起点

按 F0 → F1 → F2 → F3 推进（F4/F5 后置）。**本次从 F0（验证 markitdown）+ F1（composer 定序）开始**，每步在 feature 分支上小步提交、`pnpm typecheck/lint` 验证，不动 `.env`、不碰 Dockerfile 前先对照（CLAUDE.md Docker 规则）。
