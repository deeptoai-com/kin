# S5 设计:容量压测 + 默认值校准 + 部署文档

> 日期:2026-05-30 · 作者:agent · 状态:**设计稿,待负责人确认后进 Phase A**
> 目标:S 系列收官。用模拟客户端压测,量内存/延迟/排队曲线,**校准** S1/S2/S3 的默认值
> (`MAX_CONCURRENT_WORKERS` / `WORKER_MAX_OLD_SPACE_MB` / `WS_IDLE_TIMEOUT_MS`),写进部署文档。
> 关联:[`2026-05-single-host-50-concurrency.md`](./2026-05-single-host-50-concurrency.md)(S 系列母文档)

## 0. 负责人已确认的决定(影响实施,落档)
1. **先本地跑通流程**:先在本地 Mac 验证压测工具能跑、能出图。
   ⚠️ **本地数字不代表生产**(Mac ARM64 ≠ 16G/8核 AMD64);真·校准默认值必须等上代表性真机。
   本地阶段产出 = 「可复现的压测工具 + 方法学」,不是「生产默认值」。
2. **LLM 走真实 Ark**(不做 mock stub)。
   ⚠️ 因此本地验证**刻意压小规模 + 短 prompt + 短输出**,控制 token 花费、避免触发云端限流。
3. **时序**:S3 已合并(PR #52),现进入 S5。
4. **压测鉴权**:`auth-setup.mjs` **走 Better Auth 注册 API** 批量造临时测试用户 + 收 cookie
   (不改运行时鉴权代码、不加测试旁路;最贴近真实链路)。

## 1. 被测系统关键事实(已核实)
- WS 端点 `ws://host:PORT/ws/agent`;鉴权靠 cookie → `${APP_URL}/api/auth/get-session` 必须返回 `{user:{id}}`。
- 帧协议(压测客户端据此驱动):
  - `create_session` → 回 `session_init`(带新 `sessionId`)。
  - `chat {content, sessionId}` → 流式 `session_metadata` / `message`(首 token)→ `done`(终态);
    失败 `error`;满载 `queued {position}`;中止 `aborted`。
  - S3:长期空闲 → `idle_timeout` 帧 + close 4002。
- 三个待校准旋钮(默认值):`MAX_CONCURRENT_WORKERS=8`、`WORKER_MAX_OLD_SPACE_MB=1536`、`WS_IDLE_TIMEOUT_MS=900000`。
- worker 每 `chat` 即起即退(per-message),所以「并发执行」由 S1 信号量限到 ≤N。

## 2. Phase A — 压测工具 + 埋点(本地可开发,小 PR)
产物放 `scripts/loadtest/`(新目录,不碰运行时代码):
- **`auth-setup.mjs`**:env-gated 批量造临时测试用户 + 收 cookie(走 Better Auth signup API)。
  仅在显式 `LOADTEST=1` 下可用;绝不进生产路径。**(touches auth/DB,实现前需单独确认范围)**
- **`load-client.mjs`**:N 个虚拟用户。每个 connect→鉴权→`create_session`→循环{`chat`→等 `done`→think-time}。
  可配:`USERS`、`RAMP`(爬坡秒)、`THINK_MS`、`PROMPT`(短)、`DURATION`。
  记录:发出→首 `message`(首 token 延迟)、发出→`done`(完成延迟)、`queued` 等待、错误/断连。
- **`metrics.mjs`**:每 Ns 采样 server 主进程 RSS + 子 worker 数 + 各 worker RSS(`ps`/`pidusage`);
  汇总 p50/p95/p99 延迟、吞吐、错误率、峰值内存、最大队列深度;输出 CSV + 简单图(可选)。
- **`README.md`**:一键跑法 + 各 env 含义 + 「数字仅在真机有校准意义」的醒目提示。
- 先翻 `references/` 看有无现成压测骨架可借(hermes-agent/deer-flow 有 batch_runner 类工具)。

**本地验收(省钱版)**:`USERS=3 DURATION=60s PROMPT="say hi in 3 words"`——证明工具链通、能出 CSV/图,
而非压出生产数字。

## 3. Phase B — 真机测试矩阵(等真机,本设计先就位)
在代表性 16G/8核 AMD64 上(随完整 docker 栈 pg/redis/minio/meili,贴近生产内存预算):
| 场景 | 目的 | 关注指标 |
|---|---|---|
| 基线:50 空闲连接 | 内存地板 | 主进程 RSS |
| 稳态:50 并发 + 真实 think-time | 校准 `MAX_CONCURRENT_WORKERS ∈ {4,6,8,10,12}` | 峰值 RSS / p95 延迟 / 排队等待 / 错误 |
| 压力:50 同时发(惊群) | 验排队(S1)+ 背压(S4) | 队列深度 / 缓冲 / 无 OOM |
| worker 内存:近失控 worker | 验 `WORKER_MAX_OLD_SPACE_MB`(S2)在 cap 处杀而非拖垮整机 | worker 被杀 / 主机存活 |
| idle 回收 | 验 S3 回收空闲连接、释放槽位/内存 | 连接数/内存回落 |

## 4. Phase C — 校准 + 文档
- 选默认值:峰值 RSS 压在 ~12–13G 内(给 pg/redis/minio/meili + OS 留余量),同时满足目标 p95 延迟。
- README/部署文档加「容量与调优」章:实测表 + 按机器规格的推荐 env 值 + 可复现方法。
- 回填母文档 §5「给用户的承诺」用实测数替换估算。

## 5. 风险 / 边界
- **真实 Ark 成本/限流**:Phase A 严格压小;Phase B 在真机若用真 Ark,需预算 token 或临时切短输出模型。
- **本地 ≠ 生产**:所有本地数字在文档里标注「非校准基线」。
- **auth-setup 触碰认证**:env-gated + 仅测试用户 + 不进生产构建;实现前单独确认。
- **同机服务争内存**:Phase B 必须带完整栈测,否则内存预算偏乐观。

## 5.5 Phase A 已完成(本地跑通,2026-05-31)
工具落在 `scripts/loadtest/`:`auth-setup.mjs`(真 Better Auth 注册收 cookie)、
`metrics.mjs`(**按 WS 端口** lsof 定位服务进程——兼容 standalone `ws-server.mjs` 与
集成式 `start-production.mjs`;附 RSS 采样 + 延迟分位)、`load-client.mjs`(N 虚拟用户驱动
create_session→chat→等 done)、`README.md`。结果写 `loadtest-results/`(已 gitignore)。

**本地小规模实跑结论(非校准基线)**:1 用户 / 75s / 短 prompt:7 完成 0 失败;
完成延迟 p50 ≈ **12s**,首 token p50 ≈ **8s**;peak RSS ≈ 337MB / 1 worker。
**关键发现**:per-message worker 即起即退 → **每条消息都付一次冷启动**,本地首 token ≈8s;
Phase B 真机校准要把「冷启动占比」单列(它直接影响用户感知延迟,且与 `MAX_CONCURRENT_WORKERS`
排队叠加)。

**踩坑记录**:① 集成式部署里 WS 在 `start-production.mjs` 进程内(非独立 `ws-server.mjs`),
按端口定位才对;② 客户端勿在每个 `session_init` 重启循环(`chat` 自身也会发 `session_init`);
③ 窗口要给足冷启动(短窗口会把在途请求误判为失败)。

## 6. 待确认
- [ ] Phase A 是否现在就开工?(尤其 `auth-setup.mjs` 触碰 Better Auth 注册路径,需你点头范围)
- [ ] 真机什么时候/在哪有?(决定 Phase B 何时能拿到可校准数据)
