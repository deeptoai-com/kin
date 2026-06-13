---
title: "设计篇 06：Agent / RAG 可观测 —— 把 seq 事件流导成 span，追到每一步、每一次检索"
slug: d6-agent-tracing
date: 2026-06-07
series: oxygenie-agent-harness
series_track: design
series_index: 25
keywords: [可观测, tracing, span, Langfuse, OTel, RAG 指标, 链路追踪]
prev: d5-guardrails
next: null
---

# 设计篇 06：Agent / RAG 可观测 —— 把 seq 事件流导成 span，追到每一步、每一次检索

> 第 17 篇有 PostHog（行为）+ Sentry（错误）+ audit_log（安全）——那是**应用级**观测。baby-agent 把 Trace/Metrics/Log 列为必备，指的是**Agent 级**：一次 run 里每一步推理、每一次工具/检索调用的链路。oxygenie 这一层**只有 console.error**。好消息是：它其实已经有一条现成的 trace，只是没导出去。

> 📐 本篇原为**设计篇**（2026-06-07，现状有据，设计为"该有的"）。
> ✅ **2026-06-13 实现回填**：做 RAG 时，**检索可观测这一刀被一起做了**——每次 `kb_search` 落一行 trace。但落地方式**和本篇设计的"复用 seq 事件流导成 span"不一样**，反而修正了本篇的反直觉结论。Agent 级 step/span trace 仍是设计。详见末尾 [实现回填](#实现回填2026-06-13检索可观测落地了但打了反直觉结论的脸)。

## 问题陈述

一次 Agent run 慢了/错了/答歪了，要能回答"卡在哪一步、哪个工具、哪次检索召回了什么、各花多少 token/时间"。没有 step 级链路，线上问题只能靠猜。

## oxygenie 现状

- **应用级有，Agent 级无**：`src/lib/observability/` 是 PostHog/Sentry（第 17 篇），看的是"页面/错误/用量"。
- **Agent 内部只有 console.error**（`ws-query-worker.mjs`），不可查询、不能回放。
- **无 step/span 级 trace**，无 RAG 检索指标（召回了什么、recall、延迟），无 LangSmith/Langfuse/OTel。
- 但：worker 已经在吐**带 `seq` 的 NDJSON 事件流**（第 04 篇）——**这本身就是一条 trace**，只是被原样转发给了前端、没被导成可观测的 span。

## 朴素方案为什么不行

- **console 日志**：不可查询、不可聚合、SSH 上机器捞日志（第 04 篇坑三）。
- **只有应用指标**：知道"今天 401 多了"，但定位不到是哪个 session 的哪一步、哪次检索出的问题。
- **只测端到端延迟**：一次 run 5 秒，到底是 LLM 慢、工具慢、还是检索慢，分不出来。

## 核心方案：复用 seq 事件流，导成 span

- **事件流即 trace**：worker 的 seq 事件（第 04 篇）天然是按序的步骤记录——给每个 turn/工具调用/检索调用包一个 span（用 `seq` 当 span 顺序），导出到 Langfuse/OTel。
- **step 级 token/成本**：把 `usage_record`（第 17 篇）从 run 级细化到 step 级——每次工具/检索/LLM 调用各记 token 与耗时。
- **RAG 检索指标**：每次 `kb_search`（设计篇 01）记 query、召回的 chunk、混合/rerank 前后排名、延迟——线上才能算 recall、调 top-K。
- **落点**：在 worker 事件出口加一个 exporter（把 seq 事件转 span），复用第 04 篇的流、第 17 篇的用量表，不另起一套埋点。

## 反直觉结论

> [!IMPORTANT]
> **oxygenie 不缺一条 trace，缺的是"把已有的事件流导出去"。** 第 04 篇为了前端流式渲染，已经给每个事件盖了 `seq`、按序吐出——这恰好就是一条带时间线的执行轨迹。可观测不需要从零埋点，只要在事件出口加一个 exporter，把"给 UI 看的流"同时"给 trace 看一份"。**最好的 trace 往往不是新加的，是把你为别的目的已经产生的有序事件，换个出口导出来。** 这和设计篇 03"卸载而非摘要"、设计篇 01"检索是工具"一样——都是认出"零件已经在了，只差接线"。

## 三个生产坑

> [!WARNING]
> **坑一**：trace 里别带敏感内容原文（prompt/检索文档），按第 17 篇脱敏后再导，否则可观测自己成泄漏点。
> **坑二**：span 导出要异步、要采样——同步全量导会把 worker 的流式热路径拖慢。
> **坑三**：`seq` 是 32 位会回绕（第 04 篇坑二），当 span 排序键时长 run 要处理回绕，别让时间线错乱。

---

## 实现回填（2026-06-13）：检索可观测落地了，但打了反直觉结论的脸

本篇反直觉结论很漂亮："oxygenie 不缺一条 trace，缺的是把已有的 seq 事件流导出去。" 做 RAG 时，**检索可观测确实做了**——但**不是**按这个结论做的。这恰好暴露了那个优雅结论的边界。

### 落地的：一张专用的 `rag_search_trace` 表

每次 `kb_search` 执行，落一行 trace（`src/db/schema/rag-trace.schema.ts`，`search.ts:187` 写入）。记的不是"延迟"这种粗信号，而是**检索内部每一步的中间产物**（`rag-trace.schema.ts:20-34`）：

| 列 | 记录什么 | 回答的问题 |
|---|---|---|
| `query` / `params` | 查询词 + 收窄参数(k/kbId) | 查的是什么 |
| `visibleDocCount` | 隔离后可见文档数 | 隔离对不对、范围多大 |
| `vectorIds` / `bm25Ids` | 两条腿各自召回了哪些 chunk | **哪条腿召回了它/漏了它** |
| `fusedIds` / `rerankedIds` | RRF 融合后、rerank 后的排名 | RRF 怎么融的、rerank 改了什么 |
| `returnedIds` | 最终给模型的 | 中间哪一步把正确答案挤掉了 |
| `degraded` | `ok`/`bm25_degraded`/`rerank_degraded`/… | 是不是某条腿降级了 |
| `latencyMs` | 耗时 | 慢在哪 |

这张表的设计目标写在 schema 注释里：**"不靠猜就能回答『为什么答错了』——每条召回腿返回了什么、RRF 怎么融、rerank 改了什么、最终 surface 了什么。"** 这正是设计篇要的"step 级 RAG 检索指标"，而且比设计说的更细。

### 打脸：检索可观测**不能**靠"导出 seq 事件流"

> [!IMPORTANT]
> **本篇反直觉结论"不缺 trace、只差把 seq 流导出去"——对 Agent 级成立，对 RAG 检索内部不成立。**
>
> seq 事件流（第 04 篇）是 worker 吐给前端的"步骤流"：发了什么消息、调了什么工具、工具返回了什么。但 `kb_search` 内部那些最关键的可观测数据——**向量腿召回了哪些、BM25 腿召回了哪些、RRF 融合前后排名怎么变、rerank 动了谁**——**这些根本不在 seq 流里**。它们是 `searchKb()` 函数内部的中间变量，执行完就没了，从不流向前端。
>
> 所以 RAG 可观测**不是"把已有的事件流换个出口"**，是**专门建表、在 `searchKb` 内部埋点记录**。设计篇"零件已经在了，只差接线"的乐观判断，在 RAG 这一处**不适用**——这里的零件压根不存在，必须新造。**这是一个有价值的修正：'复用已有信号'是观测的理想路径，但当关键数据从不流经你已有的信号通道时，你就得为它单独造一条。**

### 仍是设计的：Agent 级 step/span trace

- **❌ "seq → span exporter" 没做。** 设计的核心方案——给每个 turn/工具调用包 span、导出 Langfuse/OTel——**一行没落**。Agent 级（一次 run 里每步推理、每个工具调用）仍然**只有 console.error**，现状和 2026-06-07 一样。
- **❌ step 级 token/成本拆分没做**（`usage_record` 仍是 run 级，第 17 篇）。
- 落了的 `rag_search_trace` 是**离线分析表**（写 DB、可 SQL 查），不是设计想要的"导进 Langfuse 看时间线 span"。两者互补但不是一回事。

一句话：**RAG 把"检索内部可观测"做实了（一张比设计更细的 `rag_search_trace` 表），但它走的是"专门建表"而非设计设想的"导出 seq 流"——因为检索内部数据从不流经 seq。Agent 级的 span trace 仍停在设计。** 设计篇那个漂亮的"只差接线"结论，被 RAG 检索这一处礼貌地纠正了一下。

## 配图

1. ![seq 事件流 → span 导出（一份给 UI，一份给 trace）](../assets/img/d6-seq-to-span.svg)
2. ![step 级 token/延迟 + RAG 检索指标](../assets/img/d6-step-metrics.svg)

## 结语：设计篇到此

设计篇 6 篇（RAG / 记忆 / 上下文 / 评测 / Guardrails / 可观测）补的都是 oxygenie **该有、却还没有**的能力。它们有个共同模式：**该有的零件大多已经躺在代码里**——RAG 的向量列、记忆/Skills 的 FS 模式、上下文的 attachment 表、可观测的 seq 流——**缺的不是设计，是接线**。这与正传 19 篇的"现状"互为镜像：正传写"我们怎么把 SDK 包成产品"，设计篇写"要成为完整的 harness，还差哪几根线"。

> ✅ **2026-06-13 实现回填（全系列）**：设计篇不再是纯设计了。**做 RAG（D1）时，连带把 D4 评测、D5 Guardrails、D6 可观测的"检索那一刀"一起做了**——四篇都已加 [实现回填] 段，带真实 `文件:行号`：
> - **D1 RAG**：整条落地（PR #153–#182）。设计预言对了一半，也实打实打了五次脸（维度/解析/切块/rerank/查询改写）+ 一个设计完全没料到的"最后一公里"（工具注册≠模型会用）。
> - **D4 评测**：检索层评测落地（黄金集按检索腿分型 + 消融模式），**驱动了 rerank 默认关这次反悔**；生成层指标 + CI 门禁仍设计。
> - **D5 Guardrails**：检索注入护栏落地（"文档=数据"信封），印证"能力和护栏成对出现"；但仍是"prompt 防 prompt"的适度护栏，输出 PII 仍设计。
> - **D6 可观测**：检索 trace 落地（专用 `rag_search_trace` 表），**修正了本篇"只差导出 seq 流"的结论**（检索内部数据从不流经 seq，必须新造）；Agent 级 span trace 仍设计。
> - **D2 记忆 / D3 上下文**：仍是纯设计，未动。
>
> 一个意外但合理的规律：**真做一个 RAG 系统，会把它的评测、护栏、可观测一起逼出来**——能力从不单独落地，它拖着自己的配套设施一起来。这本身就是"完整 harness"那句话的注脚。

---

📌 系列阅读地图：[reading-map.md](../reading-map.md)
🔗 蓝本：[baby-agent](https://github.com/baby-llm/baby-agent)（第六/七/八章）· [building-an-agent-harness](https://github.com/sky54laozhu/building-an-agent-harness)
