# OxyGenie 架构观察（缺陷 / 优化机会）— 2026-06-07

> 来源：实施多模型功能过程中通读 `ws-server.mjs` / `ws-query-worker.mjs` / `src/server/**` / `src/db/**` /
> `src/worker/**` / `src/start.ts` 的随手记录。按**严重度**排序，每条给**现状 / 风险 / 建议**。不是要求立刻全做，
> 是给 owner 一份"地图 + 优先级"。已在 ROADMAP 的，标注 [已在路线图]。

---

## 🔴 高（影响正确性/可维护性，建议尽快）

### A1. ws-server ↔ web-app 之间是**无类型 REST 边界**
- **现状**：`ws-server.mjs`(独立 `node` 进程、纯 JS)无法用 web app 的 Server Functions，只能 `fetch(${APP_URL}/api/...)`：`/api/agent-sessions`、`/api/usage`、`/api/audit`、`/api/auth/*`。项目铁律是"浏览器↔web-app 禁 REST、用 Server Functions"，但这条**进程间内部 API** 是必要例外，且**当前无共享类型、无版本**。多模型 PR4 还要再加一个 `/api/models/resolve/:id`，强化了这个模式。
- **风险**：ws-server 期望与 web app 端点**静默漂移**(改了字段/路径，运行期才炸);无 schema 校验;无类型提示。
- **建议**：把"内部 API"显式化——① 用一组 **共享 zod schema**(`src/server/internal-api/*`) 定义这些端点的入参/出参,ws-server 和 web app 都 import 校验;② 或生成一个小型 typed client。**先把 PR4 的 resolve 端点按这个规范做**,作为样板。澄清 CLAUDE.md 铁律:"ws-server↔web-app 内部 API 是受认可的例外,但必须 typed + zod 校验"。[部分已在路线图:"TS-ify ws-server + typed WS protocol" —— 建议把"内部 REST 也 typed"并入]

### A2. drizzle 迁移卫生缺口（schema 删了但没生成 drop migration）
- **现状**：`mastra_thread` 在 #109 从 schema 删除,但**从未生成对应的 drop migration**,导致它残留在 `drizzle/meta` 快照里。后果:**任何**新的 `drizzle-kit generate` 都会把它当"待删/待改名"而**进入交互式 prompt**(本次实施 PR1 撞上,只能手动 reconcile 快照)。
- **风险**：每次加表都踩坑;CI 无法保证"schema 与 migrations 同步"。
- **建议**：① 给 `mastra_thread` 补一个正式的 drop 迁移(owner 确认这张死表可删后);② **CI 加一道 `drizzle-kit generate --check`(或等价 diff 检查)**,保证 PR 里 schema 改动都带上迁移、快照不漂移。低成本、收益大。

---

## 🟠 中（性能/规模/一致性，按需排期）

### A3. 每条消息**两次进程 spawn**（worker child + SDK 起的 Claude Code CLI 子进程），无 warm pool
- **现状**：每个 chat 消息 `ws-server` spawn 一个 `ws-query-worker` child,worker 内 `query()` 再 spawn Claude Code CLI 子进程。已有 S1 信号量(`MAX_CONCURRENT_WORKERS`)封顶。
- **风险**：首字延迟含两次冷启动;高并发下进程开销。
- **现状判断**：**对"单机 16G/8core ~50 会话"目标够用**,warm-pool 已在 [Phase 0.5 明确延后]。仅在要冲更高并发时再做。**不建议现在动**——记录在案即可。

### A4. 多模型把"每次发送"加了一跳 resolve fetch（PR4 引入）
- **现状(将引入)**：每条 chat,ws-server 需 `fetch(/api/models/resolve/:id)` 拿连接元数据 → buildWorkerEnv。
- **风险**：热路径 +1 次 HTTP 往返(同机,~ms 级,但累积)。
- **建议**：ws-server 侧对 resolve 结果做**短 TTL 内存缓存**(如 60s,按 modelId),探活/CRUD 变更不要求秒级一致(发送时本就会再校验 health)。简单、显著省往返。**纳入 PR4**。

### A5. 配置在多处重复读取 ANTHROPIC_*（ws-server `config` + worker `config`）
- **现状**：`ws-server.mjs` 和 `ws-query-worker.mjs` 各自从 env 读 `ANTHROPIC_BASE_URL/MODEL/...`。多模型后,真相在 DB,但 worker 仍读单值 env 作兜底。
- **风险**：多模型生效后,worker 里的旧单值逻辑成了"看似还在用"的死路径,易误导。
- **建议**：PR4 落地后,**worker 只信 ws-server 传入的 env**(由 buildWorkerEnv 设),清理 worker 内的 `ANTHROPIC_MODEL` 兜底读取,避免双源。

---

## 🟡 低（卫生/护栏，顺手做）

### A6. `src/` 里的"纯 JS 岛"绕过了 TS 检查
- **现状**：ws-server 直接 import 的 `src/**.js`(`preview/*.js`、`server/concurrency/*.js`、新加的 `build-worker-env.js`)是手写 JS,不过 tsc。
- **建议**：① 这些文件加 **JSDoc 类型**(本次 `build-worker-env.js` 已带);② 可考虑 tsc `checkJs` 纳入这些文件做轻量校验;③ 长期:给 ws-server 一个构建步骤直接消费编译后的 TS(与 A1 的 TS-ify 一并)。

### A7. 非阻塞门禁长期红着（typecheck / validate-routes / test）
- **现状**：[已在路线图 Phase 0] 这三个 gate 因历史债非阻塞。
- **建议**：随各功能推进**增量收敛**(本多模型线的新代码都保持 tsc 干净 + 带单测,先不扩大债)。`drizzle generate --check`(A2)可作为新增的小硬门禁先上。

### A8. changedoc / CI（已修复，记录）
- 已切 ARK + 去掉吵闹的 auto-PR 步骤,现全绿。无需动作。

---

## 一句话总结
架构主干健康(单 SDK + 沙盒 + per-session + 真预览 + 三路部署都验证过)。**最值得动的两件**:**A1**(内部 API typed 化,正好借多模型 resolve 端点立规范)和 **A2**(drizzle 同步的 CI 护栏 + 补 mastra_thread drop)。其余多为"记录 + 按需"。多模型实施会顺手吃掉 A4/A5,并为 A1 提供样板。
