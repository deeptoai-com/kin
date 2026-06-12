# 知识库（Knowledge Base）重做 PRD

**日期**：2026-06-12
**状态**：✅ 全部阶段已实施并部署生产（2026-06-12 深夜）——阶段1 #176、bug修复 #177、
发现性 #178、新对话可用 #179、阶段5 上传进度 #180、阶段3 检索范围 #181；
阶段2/4 核实为已存在。Owner 亲测 kb_search 对话闭环成功。
**调研基线**：oxygenie 现状 + lobe-chat + onyx（三份 agent 调研报告）

---

## 1. 背景

用户（Owner）发现知识库这块产品不完整：上传时没法选知识库、没有"新建/选已有知识库"、已上传文件不能转移到知识库、上传卡很久无反馈。要求对照 lobe-chat / onyx 彻底搞好。

## 2. 调研核心结论：不重做地基，理顺 UX

三方调研一致表明 **oxygenie 的数据模型已经站在正确的设计上**，问题在前端 UX 接线。

**数据模型三方趋同**（lobe = onyx 路径B = oxygenie 现状）：
- 文件库（文件独立存在）+ 知识库（文件的命名集合）+ 多对多连接表 + chunk/embedding 挂在**文件**而非知识库。
- 一个文件进 N 个知识库只切一次、一份向量；加入/移出知识库只动连接表。

**oxygenie 已比两个参考强、不要倒退**：
- 检索：BM25 + 智谱 rerank（lobe 的 rerank 是 TODO，onyx 靠 Vespa）。
- 页码引用、parser sidecar 已落地。

**oxygenie 现状的真实缺口**（全在 UX）：
1. 上传弹窗**没有知识库选择 UI**（`showKB` 开关在文档列表页工具栏，且只是二元开关无法选具体 KB）。
2. 即使勾了开关，上传后**只标记 `sourceType='knowledge-base'`，不写 `kb_documents`**（断裂——"勾了知识库"是空的）。
3. 对话里**无法选知识库 scope**（`kb_search` 后端支持 `kbId`，前端没接）。

## 3. 产品决策（Owner 2026-06-12 拍板）

- **对话检索范围 = 对话里临时勾选**（onyx 轻量式）：聊天界面勾选一/多个知识库作为本轮检索范围，随时切换。不绑死在 agent/项目配置上。
- **知识库归属 = 个人 + 项目级**（现状即可）：个人知识库（`projectId=null`，仅自己）+ 项目知识库（`projectId` 非空，项目成员可见 = 事实上的团队级）。**不加独立的组织/团队层**。

## 4. 目标 UX 流程

### 4.1 两层概念明确：文件库 vs 知识库
- **文件库** = 用户上传的所有文件（`files` + `documents`）。
- **知识库** = 文件的命名集合（`knowledge_bases`，通过 `kb_documents` 多对多挂文件）。一个文件可属多个知识库。

### 4.2 上传（修缺口 1+2）
- 默认上传只进文件库。
- 上传弹窗增加「加入知识库」区：**选择已有知识库（可多选）/ 新建知识库**（内联快捷）。
- 上传完成后**真正写 `kb_documents`**（不再只标 metadata），并触发该文件的 parse/embed（若知识库文档需要）。
- 从某个知识库详情页发起的上传，自动透传该 `kbId`（上传即归类捷径，lobe 模式）。

### 4.3 已上传文件转移知识库（接缺口：后端 addKbDocuments 已有）
- 文件库里选文件 → 「加入知识库」（选目标知识库）→ 写 `kb_documents`。
- 知识库详情页 → 移出文件（只删连接表，文件 + 向量保留）。

### 4.4 对话里选检索范围（修缺口 3）
- 聊天界面加「知识库范围」选择器：列出当前可见知识库（个人 + 所在项目），勾选一/多个。
- 勾选后，该会话的 `kb_search` 调用带上选中的知识库 → 限定检索范围。
- **后端小改**：`kb_search` 当前 `kbId` 是单个，需扩展支持 `kbIds: string[]`（多选）。

### 4.5 ingest 进度展示（完善现状）
- 文件/文档行展示 `parseStatus` / `ingestStatus` / `ingestProgress`（状态机已有），前端轮询刷新，失败可重试。

## 5. 数据模型：保持现状 + 一处小扩展

现有 `knowledge_bases` / `kb_documents`（多对多）/ `documents` / `document_chunks` **不动**。唯一扩展：

- `kb_search` / `searchKb` 的 `kbId?: string` → 支持 `kbIds?: string[]`（多知识库 scope）。`visibleDocIds` 的 KB 过滤从单 kbId 改为 `inArray(kb_documents.kbId, kbIds)`。其余检索逻辑（向量∥BM25→RRF→rerank→页码）不变。

## 6. 分阶段实施

| 阶段 | 范围 | 修复的缺口 | 优先级 |
|---|---|---|---|
| **1. 上传归类** | 上传弹窗加「加入知识库（选已有/新建）」+ 上传真正写 `kb_documents` + 触发 ingest | 缺口 1+2（Owner 最痛） | 高 |
| **2. 文件库/知识库管理** | documents 页理顺两层；文件库选文件「加入知识库」；知识库详情页移出文件 | 已有文件转移 | 高 |
| **3. 对话选检索范围** | 聊天界面知识库勾选器 + `kb_search` 支持 `kbIds[]` | 缺口 3 | 中 |
| **4. ingest 进度** | 文件/文档行 parse/embed 状态 + 进度 + 失败重试 | 进度反馈 | 中 |
| **5. 上传体验** | 大文件上传进度反馈（base64 慢、无进度像卡死）；评估 multipart | 上传 UX | 中 |

## 7. 明确不做（砍掉 onyx 重型部分）

- 连接器生态（50 种 connector / 周期同步 / prune）——只做文件上传。
- Connector/Credential/CC-pair 三层解耦、加密凭据。
- EE 级 UserGroup / 外部权限同步 / 多租户。
- Vespa（用 pgvector，关系实时 join，免异步传播状态机）。
- 多尺度索引（mini/large chunk）、Contextual RAG、content classification boost（召回优化进阶项，后置）。

## 8. 借鉴落点小结

- **lobe-chat**：上传与归类解耦 + "上传时可传 kbId"捷径；加入/移出只动连接表。
- **onyx 路径B**：Project/UserFile 轻量形态（oxygenie projects 已对应）；status 枚举驱动前端轮询；项目级 instructions（已有）。
- **onyx DocumentSet 概念**：知识库 = 可命名、可勾选的检索范围分组（= oxygenie knowledge_base + 对话勾选）。
- **oxygenie 保持领先**：BM25+rerank、页码引用、parser sidecar 不倒退。
