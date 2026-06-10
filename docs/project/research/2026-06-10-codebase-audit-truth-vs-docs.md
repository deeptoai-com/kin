# OxyGenie 代码库审计报告 —— 去伪存真（文档 vs 代码）

> 目的：给架构师重新规划提供**经代码核实**的现状基线。重点不是"文档说了什么"，而是"代码到底接没接线、被没被调用、跑没跑得起来"。
> 基线：`main` @ `a50cd45`（2026-06-10，PR #152 合并后）。审计人：Claude（直接 grep/read 核证）。
> 适用仓：`oxygenie/`（嵌套独立 git 仓）。

---

## 0. 方法与置信度声明（先读）

- **核证方式**：对每个子系统，先看文档/注释声称，再用 `grep` 追调用链（函数被谁 import、被谁调用、生产入口 `ws-server.mjs` / `ws-query-worker.mjs` / `start-production.mjs` / `docker-compose*.yml` 是否真走到），再读关键文件确认。证据均为**实际读到的 `file:line`**。
- **置信度标注**：
  - **【实测】** = 本会话内在 local-fullstack + 共享 Docker DB 上跑过、看到真实行为（仅限 Projects/分支/单入口/lazy-create 那条线）。
  - **【静读-高】** = 调用链清晰、证据确凿。
  - **【静读-中】** = 主链路确认，但末端深度（边界/错误路径）未逐行走完。
- **覆盖范围限制**：原计划用 8 个并行子 agent 做穷尽审计，**因账号会话配额限制全部失败（0 产出）**，故本报告为单线直接核证，深度优先押在最可疑的 **RAG / 知识库 / 文档** 一块；其余子系统给出有据的判定 + 明确标注未走完的部分。
- **判定图例**：✅ 真实可用 ｜ 🟡 部分/有坑/软实现 ｜ 🔴 文档声称但代码未接线（空壳/死代码）｜ ⚪ 纯文档无代码。

---

## 1. 执行摘要（TL;DR）

**核心结论：系统的"Agent 运行时 + 协作 + 计费 + 预览"主干是真实接线的；唯独"RAG / 语义检索"是空的——schema 和死代码摆出了 RAG 的样子，但没有任何 embedding 计算、没有向量检索、没有检索注入。**

| 子系统 | 判定 | 一句话 |
|---|---|---|
| Agent 运行时（SDK/会话/resume） | ✅ | 真接线：每消息 spawn worker、SDK 0.2.112、resume 真重放 |
| 权限分级 / Ask-Act HITL | ✅ | 审批真经 worker stdin 双向回路（canUseTool） |
| Bash 沙箱 / 执行后端 | 🟡 | docker/local 双后端真实；沙箱强度与默认开关需架构师确认 |
| Skills 系统 | ✅ | 真同步到 `.claude/skills` 并经 `settingSources:['project']` 加载 |
| MCP 能力中心 | ✅ | 真把 `mcpServers` 传给 SDK query（sdk/stdio/http/sse 全支持） |
| 多模型路由（ARK） | ✅ | `buildWorkerEnv` 真按所选模型改 worker 的 BASE_URL/token |
| 真预览（Phase C） | ✅ | 真 install→build→serve `dist`（静态、拒服务端应用、支持强制重建） |
| Projects / 续聊即分支 / 单入口 / lazy-create | ✅【实测】 | 本会话实测：分支 D2 真 fork、首发才建会话、URL 镜像 |
| Artifacts / Workbench | 🟡 | 从消息/registry 检测产物渲染，真实但深度未逐行核 |
| 计费（Polar）/ 积分 | 🟡 | 计量+扣减真实，但**额度耗尽是软警告非硬拦截**，且受 `metering.enabled` 开关 |
| 可观测（PostHog/Sentry） | 🟡 | 真埋点但**纯前端**（无 `posthog-node`，服务端 turn 的 token/cost 不入 PostHog） |
| 审计日志 / 用量记录 | ✅ | `build-usage-rows` 真把 SDK usage 落库（每模型一行） |
| **RAG / 语义检索** | 🔴 | **不存在**：无 embedding、无向量检索、无检索注入 |
| 知识库（Knowledge Base） | 🟡 | 真 CRUD + 把文档 sync 进会话 workspace 让 Agent `Read`，**但不是语义检索** |
| 全文搜索（`/api/search`） | ✅ | Meilisearch 全文检索（关键词，非向量） |
| `src/todo-file-upload/**` RAG 脚手架 | 🔴 | 死代码：无人 import，依赖 `.ts` 扩展名 import 还在拖垮 typecheck |

---

## 2. RAG / 知识库 / 文档（重点专章）

### 2.1 死结论

**当前系统没有任何"真 RAG"（文本切块 → 向量化 → 向量检索 → 注入 Agent 上下文）。** 逐环节核实：

| RAG 环节 | 现状 | 证据 |
|---|---|---|
| 切块（chunk） | 🔴 无生产实现 | 仅 `src/todo-file-upload/services/rag/chunkAndEmbed.ts`（死代码，无人 import） |
| 向量化（embedding） | 🔴 **全仓零调用** | `grep "embeddings.create\|createEmbedding\|/embeddings\|1536"` 在 `src/`（排除 todo-file-upload）**只命中 schema 定义行**；依赖里**无** `openai`/`ai`/`@ai-sdk/openai`/`pgvector` 包 |
| 向量存储 | 🟡 表在、永远空 | `document_chunks` 表有 `embedding vector(1536) NOT NULL`（`drizzle/0008_*.sql:21`），但**从无任何代码 insert**；`src/db/repositories/document.repo.ts:6` 定义了 `documentChunkRepo` 壳，**无人调用** |
| 向量检索（top-k） | 🔴 无 | 全仓无 `<=>` / `cosineDistance` / `retrieveContext`（生产代码内） |
| 检索注入 Agent | 🔴 无 | `ws-server.mjs` / `ws-query-worker.mjs` / `ws-adapter.ts` 内**零** `knowledgeBase`/`retrieve`/`ragContext` 引用；发消息 payload 不带任何文档/检索字段 |

### 2.2 那"看起来像 RAG"的东西，实际是什么

1. **`documents` 表（真实 DDL，`drizzle/0008_goofy_gabe_jones.sql:27`）**：列只有 `id/title/content/file_type/filename/total_char_count/total_line_count/source_type/source/file_id/user_id/client_id/created_at/updated_at`——**没有 embedding 列**。`documents.server.ts:266` 的 insert 只填这些（不填 embedding），所以**不会**因 NOT NULL 报错。即：`documents` 表 = 上传文件的"解析后全文 + 元数据"，不是向量表。
   - ⚠️ 注意 `src/db/schema/document.schema.ts` 把 `documents`(line 6) 和 `document_chunks`(line 24) 写在同一文件；`embedding`(line 33) 属于 **`document_chunks`**，不是 `documents`。审计时极易误读成"documents 有向量列"。

2. **知识库（Knowledge Base）= 真 CRUD + workspace 物化，不是检索**：
   - `knowledge-bases.server.ts`（309 行）是对 `knowledge_base` / `kb_documents` 表的纯 CRUD（list/create/update/delete/getKbDocuments/addKbDocuments/removeKbDocument），**无任何向量/检索**。
   - `KnowledgeBasePanel`（chat-composer.tsx:531 渲染）通过 `/api/workspace/${sessionId}/documents/${id}/sync`（knowledge-base-panel.tsx:107）把选中文档**同步进会话 workspace**，Agent 再用 `Read` 工具读文件。
   - **这是"把文件塞进工作目录让 Agent 自己读"，不是语义检索 RAG。** 对小文档够用，对大语料/精准召回无能为力。

3. **全文搜索 `/api/search`**：走 **Meilisearch**（`src/routes/api/search/index.ts:21` `meili.index('documents').search(q)`），是关键词全文检索，靠 `docker-compose.yml` 的 `ex0-worker`（`command: ['npx','tsx','src/worker/index.ts']`, line 206）+ `SEARCH_REINDEX_ON_BOOT` 重建索引。**真实、可用，但不是向量/语义。**

4. **文档解析 `document-parser.ts`**：真把 pdf/docx/pptx/xlsx/... → Markdown 文本（`parseToMarkdown`，失败返回 `{ok:false}` 不抛）；**OCR 被注释掉**（`document-parser.ts:101`）。

5. **`src/todo-file-upload/**`**：早期 spike 的完整 RAG 骨架（chunkAndEmbed/retrieveContext/vectorStore 等），**死代码**——生产（含 worker/search）零 import，且用 `.ts` 扩展名 import，是 typecheck 基线报错来源之一。**建议删除。**
   **勘误（2026-06-10 终审）**：初版报告曾把 `src/worker/processors/reindexDocuments.ts` 也判为"自引用空壳"——**错误**。复核：它是真实现（`ensureIndexes` + 动态 import `document.repo` 找 `getAllDocumentsForSearch` 钩子），只因钩子从未被导出而落入软 no-op（`indexed: 0`）；`document.repo.ts` 因此被 worker 动态引用，**不可删**。处置见《RAG 最终实施方案》D8（补钩子转真）。

### 2.3 BullMQ worker 的真相

`bullmq ^5.8.0` 是真依赖；`docker-compose.yml:170` 有真实 `worker` 服务（`ex0-worker`）跑 `src/worker/index.ts`，用途是 **Meili 全文重建索引 + 模型探活**（`src/server/models/probe.ts` 提到 `probeModels` processor）。**注意**：`scripts/local-fullstack.sh` / `local-prod.sh` 的宿主机本地跑**不启动这个 worker**——所以本地验证看不到全文索引/探活行为，别误判为坏。

### 2.4 给架构师的 RAG 重做提示

**可复用（已是真实地基）**：文档上传 + 解析（pdf/docx→md）、`documents` 全文表、Meili 全文检索、会话 workspace 物化机制、Projects 的项目归属（RAG 要做成项目级）。
**必须新建**：embedding 客户端（ARK 是否提供 embedding 端点需先确认，否则要引入一个 embedding provider）、切块管道、`document_chunks` 真实写入 + pgvector 检索（pgvector npm 包/或用 drizzle 原生 `<=>`）、发消息时的 top-k 检索 + 上下文注入到 worker。
**已有设计文档**：Projects 协作 PRD（含 RAG 对接章）在 **main**：`docs/project/prd/2026-06-projects-collaboration-prd.md`；两份 RAG 实施设计——`2026-06-advanced-rag-design.md`（三档分流 + 入库管线 + kb_search，R0–R4 拆期）与 `2026-06-projects-p1-rag-r0-data-model.md`（P1⊕R0 合并数据模型/访问解析器/迁移）——**仅在 `origin/docs/scope-projects-rag` 分支（95a99a1），未进 main**。三者一致指向同一缺口，可直接作为实施蓝本。

---

## 3. 逐子系统审计

### 3.1 Agent 运行时核心 —— ✅【静读-高】
- SDK 钉死 `0.2.112`（`package.json:43`）；worker **每消息 spawn 子进程**（`ws-server.mjs` handleChat 先 kill 旧 worker 再起）。
- `settingSources:['project']`（`ws-query-worker.mjs:784`）真加载项目级 skills。
- resume：`ws-server.mjs` resume case 从 DB 取 `realSdkSessionId` 喂 SDK 重放（本会话实测刷新深链能恢复历史）。
- ARK 鉴权：worker 继承 `process.env` 的 `ANTHROPIC_AUTH_TOKEN`（Bearer），多模型时由 `buildWorkerEnv` 覆盖。
- **遗留**：execution backend（docker vs local）默认值与沙箱强度未在本轮逐行核（见 3.3）。

### 3.2 权限分级 / Ask-Act HITL —— ✅【静读-高】
- ask→`permissionMode='default'`+HITL via `canUseTool`；act→`acceptEdits`（`ws-server.mjs:1326`）。
- 审批**真双向回路**：worker 请求经 stdin（`ws-server.mjs:1399`），用户 allow/deny 经 `approval_response` 写回 worker stdin（`:1865`→`:1870`）解决 pending `canUseTool`。
- 客户端档位被服务端 clamp（`ws-server.mjs` 注释 "server clamps to org ceiling"，PR-B）——**clamp 逻辑本轮未逐行核**，标 🟡 待确认。

### 3.3 Bash 沙箱 / 执行后端 —— 🟡【静读-中】
- `src/claude/execution/{docker-backend,local-process-backend,sandbox}.js` 双后端存在；`src/claude/bash/runner.js` + `path-security.js` 真实。
- **未核完**：生产默认走哪个后端、`sandbox.js` 的隔离强度（seccomp/容器/仅路径白名单）、默认开关。**架构师重点复核项**（关系到自托管威胁模型）。

### 3.4 Skills 系统 —— ✅【静读-高】
- 真同步到 `${userRoot}/.claude/skills`（symlink 跨会话共享），经 `settingSources:['project']` 被 SDK 加载（`ws-query-worker.mjs:641-784`）。
- catalog/materialize/enable-disable/github-installer/icon-generator 等文件齐全。
- **未核完**：github-installer 真装、icon-generator 真生成 vs 占位、`skills-api-client` 连的上游——标 🟡 待深核。

### 3.5 MCP 能力中心 —— ✅【静读-高】
- worker 真把 `mcpServers` 传给 SDK `query()`（`ws-query-worker.mjs:597` resolveMcpServerConfigs，`:790` 注入）。
- `mcp.server.ts` 支持 sdk/stdio/http/sse 四类，`resolveCommandPath` 校验命令存在（:251）。
- **修正一处文档**：CLAUDE.md 说"MCP 目录/选择器在路线图 Next"——**运行时注入其实已是真实的**，只是策展目录 UI 可能不完整。架构师别被 CLAUDE.md 误导成"MCP 没做"。

### 3.6 多模型路由 —— ✅【静读-高】
- `buildWorkerEnv(meta, sourceEnv)`（`src/server/models/build-worker-env.js:34`）真按所选模型设 `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_URL` + 从 `meta.tokenEnv` **名字**取 token（密钥不过网）。
- resolve API 返回 tokenEnv 名而非值（安全）；`ws-server.mjs` 有 `resolveModelForChat` + TTL 缓存。
- **无第二套 SDK**：依赖确认无 `ai`/`@ai-sdk/*`/`openai`，符合"单一 SDK"铁律。
- **未核完**：admin models CRUD 真持久化、`probe.ts` 真探活 vs 写死——标 🟡 待深核。

### 3.7 真预览（Phase C）—— ✅【静读-高】
- `src/preview/runtime.js:211 #startStaticPreview` 真 install→build→serve `dist`（静态，无 HMR）；服务端应用被拒（`:241` "Static preview v1 supports frontend SPA/static apps only"）；支持 `force` 强制重建（`:246`）。
- 自动重建钩子 `src/lib/hooks/use-preview-auto-rebuild.ts` + ws-server 接线（PR #150/#151，本会话已合入运行环境）。
- `docker-compose.yml:333` 有真实 `preview-controller` 服务。
- 符合 CLAUDE.md「build+静态 serve、改代码必须重建」描述。

### 3.8 Projects / 续聊即分支 / 单入口 / lazy-create —— ✅【实测】
- 本会话在 local-fullstack 实测：落地 `/agents/c` 零建会话；首发才 `createSession`；URL 镜像 `/agents/c/$id`（含项目变体）；项目首发 `project_id` 创建时即绑定；Bob 回复 Alice 项目会话**真 fork 出 D2**（`branched_from_session_id` 真写、同项目、源 D1 不动）。验收 7/7。
- 权限：`src/server/projects/{access,access-logic}.ts` + `tests/unit/projects-access.test.ts`。
- **唯一遗留**：首发前附件上传被禁用（需 session workspace），属设计取舍。

### 3.9 Artifacts / Workbench —— 🟡【静读-中】
- 从消息内容/`/api/workspace/$sessionId.artifacts.ts` registry 检测产物并渲染（`use-artifact-detection`、`artifacts-panel`、`workbench-panel`）；真实但末端（多文件/图片/排序边界）未逐行核。

### 3.10 计费（Polar）/ 积分 —— 🟡【静读-中】
- Polar webhook 真接：`polar-webhooks.ts:100 polarWebhookHandlers`（onSubscriptionActive 等）→ 改 `subscriptions`/`invoices` 表、`upsertPolarCustomerByExternalId`。
- 积分真账本：`credits.ts` 有 `spendCredits`/`spendOneCredit`/`addPurchasedCredits`/`ensureDailyRefill`/`resetMonthlyAllotment`。
- **关键去伪存真**：额度耗尽是**软警告非硬拦截**——`ws-server.mjs:392-398`，metering 开启且不足时只发 `credit_warning`「this run was not charged」，**该 run 照常执行**；且整套计量受 `result.metering?.enabled` 开关控制（自托管默认可能整体关闭）。架构师若要"额度硬门禁"需新增 pre-flight 拦截。
- **未核完**：invoices 生成真实 vs 桩、webhook 验签细节（疑由 better-auth/polar 插件托管）。

### 3.11 可观测 / 审计 / 用量 —— 🟡/✅【静读-高】
- PostHog：`posthog-events.ts` 真 `posthog?.capture(...)`，但**纯前端**——依赖**无 `posthog-node`**，服务端 worker 的 token/cost **不进 PostHog**。Sentry client+server 都在。
- 用量：`build-usage-rows.ts` 真把 SDK `result.usage`/`modelUsage` 映射成 DB 行（每模型一行）→ `usage-record` 表。✅
- 审计：`src/server/audit/**` + `audit-log.schema.ts` + `api/audit/index.ts` 存在；**写入覆盖哪些操作未逐行核**，标 🟡。

---

## 4. 文档健康度（doc-vs-code 缺口清单）

| 文档/声称 | 代码现实 | 处置建议 |
|---|---|---|
| RAG 设计文档描绘完整向量检索（advanced-rag-design 等） | 零 embedding/检索/注入 | 两份 RAG 设计仅在 `docs/scope-projects-rag` 分支；合进 main 时**明确标注"设计稿（未实现）"**（advanced-rag-design 自己已如此标注，诚实） |
| CLAUDE.md「MCP 目录/选择器在路线图 Next」 | 运行时 MCP 注入**已真实** | 更正 CLAUDE.md，区分"运行时已做" vs "策展 UI 待完善" |
| advanced-rag-design §1 现状盘点（"空架子"、todo 死代码） | 准确（与本审计独立核证结果一致） | ✅ 该文档的现状盘点可信 |
| 各 PhaseC/branch/routing 完成报告 | 与代码一致（本会话实测分支/路由/预览） | ✅ 可信 |
| 「知识库」相关 UI 文案/Tab 暗示语义检索 | 实为文件物化 + 全文检索 | 重做 RAG 时统一术语，避免"知识库=语义RAG"的误解 |

**总体**：文档**夸大主要集中在 RAG 一处**（schema/死代码/PRD 摆出 RAG 姿态但无实现）；其余子系统文档与代码基本一致，PhaseC/Projects/路由线的完成报告经实测可信。这与"之前有造假成分"的记忆吻合——**造假面比想象的窄，集中在 RAG**。

---

## 5. 给架构师的优先级建议

1. **清场（低风险，先做）**：删除/移出 `src/todo-file-upload/**` 与 `src/worker/processors/reindexDocuments.ts` 空壳（消 typecheck 噪音、去误导）；把 RAG PRD 合进 main 并加"未实施"注脚；更正 CLAUDE.md 的 MCP 表述。
2. **决策点（动手前拍板）**：embedding provider 从哪来（ARK 是否有 embedding 端点？无则需引入第二个 provider，注意这是"单一 SDK"铁律之外的新依赖，要 Owner 批）；向量库用 pgvector（库里已有 `vector` 列基础设施）。
3. **RAG R0→R1→R2**：按 `2026-06-07-projects-rag-prd.md` 落地，复用 documents 全文表/解析/workspace 物化/Projects 归属。
4. **顺带硬化（与 RAG 无关但审计暴露）**：① 沙箱默认与强度复核（自托管威胁模型）；② 若要积分硬门禁，加 pre-flight 拦截（当前是软警告）；③ 服务端可观测缺口（worker token/cost 不入 PostHog，考虑 posthog-node 或落库即够）。

---

## 6. 本报告未覆盖/置信度偏低处（诚实声明）

- Bash 沙箱隔离强度与默认后端（3.3）、权限 clamp 逻辑（3.2）、Skills 上游安装链（3.4）、admin models CRUD/probe（3.6）、Artifacts 边界（3.9）、invoices/webhook 验签（3.10）、审计写入覆盖（3.11）——均为**主链路确认、末端未逐行**，标 🟡。建议账号配额恢复后用并行子 agent 对这些做二轮深核（本轮并行审计因配额失败）。
- 全文基于静态读 + 本会话对 Projects 线的实测；**未跑** Skills/MCP/多模型/计费的端到端实测。
