# OxyGenie Agent Harness 系列 · 阅读地图 / Reading Map

> **正传 19 篇（现状）+ 设计篇 6 篇（该有的）· 双语 · 一套自托管、多租户、可计费、可上线的 Web Agent Harness 的工程拆解**
>
> **两条线，分清"现状"与"该有的"**：**正传 01–19** 写 OxyGenie **已有的**（每篇都有 `文件:行号` 为证）；**设计篇 D1–D6** 写按 references（baby-agent 的 RAG/记忆/Guardrails/评测章、HarWork 的上下文章）倒推出来、OxyGenie **该有却还没有**的能力。完整的 harness ≠ 只写已有的——所以这套地图把"缺口"也画进来。
>
> ✅ **2026-06-13 进展**：设计篇已不全是"未实现"。**D1 RAG 整条落地上生产（#153–#182），并连带做出 D4 评测 / D5 Guardrails / D6 可观测的"检索那一刀"**——这四篇均加了 [实现回填] 段（真实 `文件:行号` + 设计 vs 现实的打脸/修正）。D2 记忆、D3 上下文仍为纯设计。
>
> 蓝本：[building-an-agent-harness](https://github.com/sky54laozhu/building-an-agent-harness)（HarWork）、[baby-agent](https://github.com/baby-llm/baby-agent)（Agentic RAG / 记忆 / Guardrails / 评测）。
> 但 OxyGenie 走了一条**不同的路**——HarWork 自己手写了 640 行的 Agent Loop；
> **OxyGenie 不写 Loop**，它包住官方 **Claude Agent SDK**，把工程全花在"让 SDK 在多租户、沙箱、断流、计费、上线场景下不崩"。
> 这套系列就是把这层"包"一层层摊开。
>
> **代码引用基准**：全系列所有 `文件:行号`（如 `ws-server.mjs:1125`、`permission-tier.js:26`）对应 OxyGenie `main` 分支 2026-06-07 的快照；代码持续演进后行号可能漂移几行，以该快照为准。

---

## 一句话定位 · One-line positioning

**OxyGenie**：面向中小团队的、可私有化部署的、可扩展的 AI Agent 平台——基于 **Claude Agent SDK 0.2.112**（钉死以兼容 ARK 多模型网关）+ **TanStack Start**，用 Skills Store、MCP、Artifacts、Python 执行、**真预览** 替代通用 GPT 产品，单机 16GB/8 核目标 **~50 并发会话**。

---

## 中文版 · 推荐阅读顺序

| 板块 | 篇 | 标题 | 一句话 |
|------|----|------|--------|
| **立论** | 01 | [什么是 Agent Harness](zh/01-what-is-agent-harness.md) | SDK 已经给了 Loop，你还要造的那 15 层 |
| | 02 | [OxyGenie 技术栈全景](zh/02-oxygenie-stack-overview.md) | 双进程（ws-server + worker）/ SDK 0.2.112 / ARK |
| **执行内核** | 03 | [Per-Message Worker 模型](zh/03-per-message-worker-model.md) 🌟 | 为什么"每条消息 spawn 一个子进程"而不是常驻 Loop |
| | 04 | [流式协议](zh/04-streaming-protocol.md) | seq 编号 NDJSON 帧 + stdin/stdout 双工 + 背压 |
| | 05 | [ExecutionRuntime 双后端](zh/05-execution-runtime.md) | local-process / per-session Docker，FAIL-CLOSED |
| **工具扩展** | 06 | [工具系统](zh/06-tool-system.md) | SDK preset `claude_code` + 自定义 MCP 工具 |
| | 07 | [MCP 能力中心](zh/07-mcp-capability-center.md) | 7 个内置 MCP + 按用户 FS 启用 + 凭据/覆写 |
| | 08 | [Skills 系统](zh/08-skills-system.md) | copy-on-enable + LLM 生成表单 schema + disabled veto |
| **沙箱权限** | 09 | [Ask/Act 两模式 + HITL](zh/09-ask-act-hitl.md) | canUseTool → approval_request → stdin 回灌 |
| | 10 | [Bash 沙箱](zh/10-bash-sandbox.md) | srt FAIL-CLOSED + prlimit + secret 永远剥离 |
| | 11 | [多租户隔离](zh/11-multi-tenant-isolation.md) | per-session workspace + path guard + 9 系统前缀封锁 |
| **会话并发** | 12 | [会话持久化](zh/12-session-persistence.md) | SDK transcript 为真相 + DB 13 表为索引 + resume 坑 |
| | 13 | [单机 50 并发](zh/13-single-host-concurrency.md) | semaphore(max 8) + worker heap cap + idle reaper |
| | 14 | [多模型路由](zh/14-multi-model-routing.md) | ARK 网关 + 为什么钉死 SDK 0.2.112 |
| **产物预览** | 15 | [真预览](zh/15-real-preview.md) 🌟 | per-session Docker + Traefik 子域 + bootstrap JWT |
| | 16 | [Artifact 检测与会话 UI/Workbench](zh/16-artifacts-and-workbench.md) | 启发式检测 / 为什么关掉 structured outputs / seq 排序 |
| **计费上线** | 17 | [计费与可观测](zh/17-billing-and-observability.md) | usage_record 观测 / costUsd 为什么不扣费 / PostHog+Sentry+审计 |
| | 18 | [Dokploy 上线](zh/18-dokploy-deploy.md) | 多阶段 Docker + GHCR + Traefik + Cloudflare Origin CA |
| **复盘** | 19 | [复盘](zh/19-retrospective.md) | 从 starter 到生产：做对 / 做错 / 反悔 |

🌟 = 旗舰篇（中英双语全文）。正传 01–19 **均为完整全文**（问题 → 朴素方案 → 核心方案 → `文件:行号` → 反直觉 → 三个生产坑 → 配图 → 下一篇）。

### 设计篇 · 该有的（现状 → 设计） 📐

> 正传写"已有的"，设计篇写"完整 harness 该有、却还没有的"。每篇结构：**问题 → oxygenie 现状（有 `文件:行号` 为证）→ 朴素方案为什么不行 → 核心方案（该有的设计）→ 落点（复用哪些已有原语）→ 反直觉 → 生产坑**。
>
> ✅ **2026-06-13 更新**：设计篇不再全是"未实现"了。**做 RAG（D1）整条落地时，连带把 D4 评测 / D5 Guardrails / D6 可观测的"检索那一刀"也做了**——这四篇都已加 [实现回填] 段（真实 `文件:行号` + 设计 vs 现实的"打脸/修正"）。D2 记忆 / D3 上下文仍是纯设计。下表"状态"列标了最新进度。

| 设计篇 | 标题 | 状态 | 现状一句话 → 落地了什么 |
|--------|------|-----------|-------------|
| **D1** | [Advanced / Agentic RAG](zh/d1-advanced-rag.md) | ✅ **全落地** | 离线 embed 进 pgvector + 向量∥BM25 混合 + 检索做成 Agent 自调 MCP 工具，**整条上生产（#153–#182）**；设计预言对一半、打脸五处 + 一个"最后一公里" |
| **D2** | [长期记忆](zh/d2-long-term-memory.md) 📐 | ⬜ 纯设计 | 无 auto-memory；两层记忆 + LLM 蒸馏 + 注入 system prompt，**仍未实现** |
| **D3** | [上下文工程](zh/d3-context-engineering.md) 📐 | ⬜ 纯设计 | 渐进压缩 + 卸载到 `message_attachment`（表已存在）+ 预算前置，**仍未实现** |
| **D4** | [评测](zh/d4-evaluation.md) | 🟡 **半落地** | ✅ 检索层黄金集（按腿分型）+ 分层指标 + 消融，**驱动 rerank 反悔**；❌ 生成层指标 + CI 门禁仍设计 |
| **D5** | [Guardrails](zh/d5-guardrails.md) | 🟡 **半落地** | ✅ 检索注入护栏（"文档=数据"信封，适度护栏）；❌ 输出 PII / 内容护栏仍设计 |
| **D6** | [Agent / RAG 可观测](zh/d6-agent-tracing.md) | 🟡 **半落地** | ✅ 检索 trace（专用 `rag_search_trace` 表，**修正了"导 seq 流"的结论**）；❌ Agent 级 step/span trace 仍设计 |

📐 = 仍为纯设计 · ✅/🟡 = 全/半落地（带 [实现回填] 段）。设计篇的共同发现仍成立：**该有的零件大多已躺在代码里，缺的是接线**——但 RAG 这一轮也补了一条反向教训：**当关键数据从不流经已有信号通道时（如检索内部之于 seq 流），你就得新造，不是接线**（见 D6 回填）。

## English · Recommended Order

| Section | # | Title | One-liner |
|---------|---|-------|-----------|
| **Thesis** | 01 | What is an Agent Harness | The 15 layers you still build after the SDK gives you the loop |
| | 02 | OxyGenie stack overview | Two-process (ws-server + worker) / SDK 0.2.112 / ARK |
| **Execution Core** | 03 | [Per-message worker model](en/03-per-message-worker-model.md) 🌟 | Why spawn a child per message instead of a resident loop |
| | 04 | Streaming protocol | seq-numbered NDJSON frames + stdin/stdout duplex + backpressure |
| | 05 | ExecutionRuntime dual backend | local-process / per-session Docker, fail-closed |
| **Tools** | 06 | Tool system | SDK preset `claude_code` + custom MCP tools |
| | 07 | MCP capability center | 7 built-in MCPs + per-user FS enablement |
| | 08 | Skills system | copy-on-enable + LLM-generated form schema |
| **Sandbox** | 09 | Ask/Act modes + HITL | canUseTool → approval_request → stdin |
| | 10 | Bash sandbox | srt fail-closed + prlimit + secrets always stripped |
| | 11 | Multi-tenant isolation | per-session workspace + path guard |
| **Session** | 12 | Session persistence | SDK transcript is truth + 13-table DB index |
| | 13 | Single-host 50 concurrency | semaphore + worker heap cap + idle reaper |
| | 14 | Multi-model routing | ARK gateway + why SDK 0.2.112 is pinned |
| **Artifacts** | 15 | [Real preview](en/15-real-preview.md) 🌟 | per-session Docker + Traefik subdomain + bootstrap JWT |
| | 16 | Artifacts & workbench | heuristic detection / why structured outputs are off / seq |
| **DevOps** | 17 | Billing & observability | usage observation / why costUsd ≠ charge / PostHog+Sentry+audit |
| | 18 | Dokploy deploy | multi-stage Docker + GHCR + Traefik + Cloudflare Origin CA |
| **Retro** | 19 | Retrospective | starter → production: what worked, what didn't |

> English bodies: the **reading-map is fully bilingual**, and the two 🌟 flagships ship in `en/`. The remaining English article bodies are a mechanical translation pass over the Chinese versions — tracked as a follow-up.

---

## 按"我想了解 X"反查 · Reverse index

- **Agent 内核怎么转**：03 → 04 → 05（SDK 在子进程里跑，harness 负责 spawn/流/沙箱）
- **为什么不自己写 Loop**：01 → 03 → 14（包 SDK 的代价与收益 + ARK 钉版）
- **怎么不让 LLM 删库 / 跨租户**：10 → 11 → 09（沙箱硬边界 + path guard + HITL）
- **怎么保住会话**：12 → 13 → 04（transcript 为真相 + reaper + 断流重连）
- **多模型怎么切**：14 → 02 → 17（ARK 别名 + 钉版 + 按 token 观测）
- **AI 生成的 App 怎么真跑起来**：15 → 16 → 05（per-session Docker + 子域代理 + manifest）
- **怎么上线不炸**：18 → 13 → 17（Docker/GHCR/Traefik + 并发上限 + 可观测）
- **一人/小团队工程取舍**：19 → 02 → 01
- **该有却还没有的（缺口）**：D1（RAG）→ D2（记忆）→ D3（上下文）→ D4（评测）→ D5（Guardrails）→ D6（可观测）
- **怎么让 Agent 用上知识库**：D1 → D3 → D5（检索是工具 → 上下文协同 → 检索内容护栏）

## 关键词索引 · Keyword index

- **执行内核**：per-message worker, child_process spawn, Claude Agent SDK 0.2.112, async generator (SDK 内), NDJSON, seq, backpressure（03-05）
- **工具扩展**：SDK preset claude_code, createSdkMcpServer, MCP enabled.json, copy-on-enable skills, schema generator（06-08）
- **沙箱权限**：permission-tier ask/act, canUseTool HITL, srt / bubblewrap, prlimit, buildSafeEnv, path-security, cross-tenant guard（09-11）
- **会话并发**：transcript-as-truth, agent_session, usage_record, audit_log, semaphore, idle-reaper, ARK gateway, pinned SDK（12-14）
- **产物预览**：real preview, per-session Docker, Traefik subdomain, bootstrap JWT, opaque cookie, artifact detection, structured outputs off, workbench seq（15-16）
- **计费上线**：token-based credits, costUsd≠charge, Polar webhook, PostHog, Sentry, multi-stage Dockerfile, GHCR, Cloudflare Origin CA, Dokploy（17-18）

---

## OxyGenie vs HarWork：同蓝本、不同路 · Same template, different road

| 维度 | HarWork（蓝本） | OxyGenie（本系列） |
|------|----------------|--------------------|
| **Agent Loop** | 自写 `agent/loop.ts` 640 行 async generator | **不自写**，包 Claude Agent SDK 的 `query()` |
| **执行形态** | engine 库/服务双形态，进程内 Loop | **每条消息 spawn 子进程** worker（`ws-query-worker.mjs`） |
| **沙箱** | Per-User 持久 Docker（pause/resume） | srt(bubblewrap)/Docker + **ExecutionRuntime 抽象**，per-session workspace |
| **多模型** | 5 厂商硬编码 + AI SDK | **ARK 网关**（GLM/Doubao/DeepSeek/Kimi/MiniMax），钉死 SDK 0.2.112 |
| **持久化** | SQLite，30 表，DB 为真相 | **Postgres，13 表，SDK transcript 为真相**、DB 为索引 |
| **产物** | iframe overlay + 多版本 mix + 乐观锁协作 | **真预览**：per-session Docker + Traefik 子域 + bootstrap JWT |
| **栈** | Next.js + 自研 engine | **TanStack Start + ws-server/worker 双进程** |

**这套系列的价值**：如果你也在"基于官方 Agent SDK 造产品"（而不是从零手写 Loop），HarWork 的 18 篇有一半对不上你的现实——OxyGenie 这 19 篇补的就是那一半。

---

## 系列说明 · Series notes

- **蓝本**：[sky54laozhu/building-an-agent-harness](https://github.com/sky54laozhu/building-an-agent-harness)（结构与文风借鉴，内容全部基于 OxyGenie 真实代码重写）。
- **代码快照**：OxyGenie `main`，2026-06-07。
- **每篇结构**：`问题陈述 → 朴素方案为什么不行 → 核心方案（代码+图）→ 关键实现要点（文件:行号）→ 反直觉结论 → 生产坑 → 配图 → 下一篇`。
- **配图**：占位于 `assets/img/NN-*.svg`，按需补绘。
- **状态**：reading-map 双语完成；ZH 19 篇骨架完成，03/15 为全文旗舰；EN 旗舰 03/15 完成，其余 EN 待译。
