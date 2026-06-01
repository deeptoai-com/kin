# 权限模式 + Bash + Sandbox — 模块系统设计（PR-A 对标小结 + 方案）

> 日期：2026-05-31 · 状态：**PROPOSAL — 待负责人审批后再写代码**（单向门 + 安全敏感）
> 关联：`2026-05-permission-modes-design.md`（三档模型）、`2026-05-execution-runtime-design.md`（ExecutionRuntime）、`PHASE3-PLAN.md` ③ HITL
> 范围：把「权限模式 / Bash / Sandbox」三块**作为一个整体**重设计，对标 deer-flow / hermes-agent。

---

## 0. TL;DR（一句话方案）

**禁用 SDK 原生 `Bash`，改用一个走 `ExecutionRuntime`（srt / Docker）的自定义 `bash` MCP 工具——它是现有 Python 工具的近似克隆。**
Bash 是否可用 = `默认档 或 执行档` **且** `沙箱后端可用`（Linux+srt 或任意平台+Docker）。两条都不满足就不注册该工具。守卫（canUseTool / 路径校验）在所有非裸-bypass 档位始终在线。

> **§7 决策已锁定（2026-05-31 负责人审定）**：①默认档也允许沙箱内 bash（非仅执行档）；②HITL 融进默认档做「智能 Auto，危险才问」，不新增第四档；③macOS 本地用 bash **必须** `EXEC_RUNTIME=docker`。下文表格/判定已据此更新。

这一条解决了交接文档里的「核心张力」：用户要 Bash，但 Bash + 无沙箱 = 危险。**关键纠偏**：交接文档 PR-C 写的「让 SDK Bash 工具的执行经过 srt」在当前架构下**不可行**——见 §2。

---

## 1. 对标小结（deer-flow / hermes-agent 怎么做 Bash + Sandbox + 审批）

两个成熟项目得出**同一个核心结论**：**它们都不用厂商原生的 shell 工具，而是自定义一个 shell 工具，让它流经自己的沙箱抽象。** 这正是 oxygenie 该走的路。

### 1.1 deer-flow（web-based 多 agent，最直接同类参考）

- **Bash 是自定义工具**：`@tool("bash")`（`backend/.../sandbox/tools.py:1328`），不是 LangChain/厂商原生 shell。执行体走自己的 `sandbox.execute_command()`。
- **两档沙箱**：
  - `LocalSandboxProvider`——直接在宿主跑，**不是安全边界**；靠「虚拟路径前缀 + 路径校验/翻译/输出脱敏」做逻辑隔离。
  - `AioSandboxProvider`——**真 Docker 容器**隔离（网络/FS/进程），与 Local 共享同一套虚拟路径接口。
- **Host bash 默认禁**：`allow_host_bash: false`（`sandbox/security.py`）。Local 沙箱下跑 bash 直接返回错误：「不是安全边界，请切到 Aio(Docker) 沙箱，或仅在完全可信本地环境显式开启」。→ **与本方案「macOS 无 Docker 时禁 bash」完全同构。**
- **审批 = 两层**：
  - 预执行 **Guardrail 中间件**（可插拔 allowlist/denylist provider，`fail_closed` 默认拦），对每个 tool_call 鉴权。
  - 中途 **ClarificationMiddleware** → `Command(goto=END)` 打断 → 前端展示问题 → 用户回答后**从 checkpoint 恢复**。
- **路径安全链（Local）**：`validate → translate → execute → mask`，拒 `..`、`file://`、越界 `cd`，只放行 `/mnt/user-data/*` 等白名单。

### 1.2 hermes-agent（Sandbox 抽象 + 多后端）

- **`BaseEnvironment` ABC**：统一 `execute(command, cwd, timeout) → {output, returncode}`；每个后端实现 `_run_bash(cmd_string)`。
- **多后端**：Docker（`docker exec`）/ Modal / Daytona / SSH / Local / Singularity，靠 `env_type` + config 选择。
- **隔离**：Docker 后端 `--network=none`、cap-drop ALL、no-new-privileges、CPU/mem/pids/disk 限额、非 root、tmpfs。
- **生命周期**：每 `(task, profile)` 一个长生命周期容器，跨命令复用；session 快照（env/alias/cwd）一次捕获、每命令重放。

### 1.3 对 oxygenie 的三条启示

1. **自定义 shell 工具 > 原生 shell 工具**——这是「Bash 进沙箱」唯一干净的实现路径。
2. **逻辑隔离（路径校验/脱敏）+ 物理隔离（容器/srt）双层**——我们已有 srt（物理）+ path-security（逻辑），缺的是把 bash 接进去。
3. **「不可信沙箱时禁 bash」是业界默认**（deer-flow `allow_host_bash:false`）——给我们的 macOS-dev 策略背书。

---

## 2. 当前现状（已核实）+ 核心纠偏

| 关注点 | 现状（file:line） |
|---|---|
| 权限映射 | `ws-query-worker.mjs:196-224`：`plan→plan`；其它→`acceptEdits`；`bypass+CLAUDE_DANGEROUS_DISABLE_GUARD=true`→裸 `bypassPermissions` |
| canUseTool 守卫 | `path-security.js:267-331`：跨租户 / 系统路径 / 读写边界校验；非裸-bypass 档位均生效（`ws-query-worker.mjs:467-468`） |
| Bash 开关 | `resolveDisallowedTools`（`:70-79`）：默认 `['Bash']`；仅 `bypassPermissions && allowBash` 才放行 |
| 自定义工具机制 | Python 工具 = `tool()` + `createSdkMcpServer()`（`:256-300`）→ `runner.js:121 runPython` → `getExecutionRuntime().exec()`。GLM 图像工具同模式（`:304-351`）。 |
| ExecutionRuntime | `execution/index.js:20-38`（`EXEC_RUNTIME=local|docker`）；`sandbox.js:51-62 isEnabled()`（Linux 默认开，macOS/Win 默认关，`ENABLE_EXEC_SANDBOX=0/1` 覆盖）；secret-strip 永远生效。 |
| **关键缺口** | **srt 只包住 Python**（`runner.js:157-171` 走 runtime.exec）。**SDK 原生 Bash 来自 `tools:{preset:'claude_code'}`（`:476`），在 SDK 内部执行，根本不经过我们的 ExecutionRuntime。** |

### 核心纠偏 ⚠️
交接文档 PR-C：「让 SDK Bash 工具的执行经过 srt/Docker 后端」。
**实测：做不到。** 原生 Bash 由 SDK 自己 spawn，我们无拦截点（`canUseTool` 只能 allow/deny，不能改执行体）。
**正解（两个对标项目一致）：禁原生 Bash，自定义 `bash` MCP 工具，工具体内调 `getExecutionRuntime().exec({command})`。** 后端（`local-process-backend.js:45-64`）已支持 `cmd.command` 字符串形态 + srt 包裹，几乎零改动即可复用。

> 命名注意：自定义工具名是 `mcp__<server>__bash`，**不被 `disallowedTools:['Bash']` 命中**（不同命名空间）。因此「关 bash」必须靠**条件性不注册该 MCP server**，不能靠 disallowedTools。原生 `['Bash']` 继续保留（永久禁原生）。

---

## 3. 目标架构

### 3.1 三档权限模型（沿用并收敛既有设计）

| 用户档 | SDK 映射 | 文件编辑 | 自定义 Bash | 守卫 | HITL（危险操作） |
|---|---|---|---|---|---|
| **Explore（探索）🔍** | `plan` | ❌ 只读 | ❌ | n/a | — |
| **默认（Auto）⚡** | `acceptEdits` + canUseTool | ✅ 自动 | ✅ **仅沙箱内** | ✅ 路径/租户守卫 | **危险才问**（Wave 2：智能 Auto 审批往返） |
| **执行（Act）🚀** | `acceptEdits` + canUseTool | ✅ 自动 | ✅ **仅沙箱内** | ✅ 路径/租户守卫 | 放手干，少打断（仅最高危可选问） |

> 默认 vs 执行的差别 = **打断策略**：默认档危险操作弹审批（智能 Auto，HITL 融于此，不设第四档）；执行档放手跑、尽量不打断。两档都有沙箱化 bash + 守卫。对标 Claude Code 的 Auto vs 更放权模式。

- **执行档 ≠ 裸 bypass**：仍走 `acceptEdits`+canUseTool（守卫在），只是**额外注册沙箱化 bash 工具**。裸 `bypassPermissions` 仅 `CLAUDE_DANGEROUS_DISABLE_GUARD=true` 调试可达。→ 对齐交接决策④建议「始终带沙箱兜底」。

### 3.2 Bash 可用性判定（tier × sandbox 矩阵）

```
注册沙箱化 bash 工具  ⇔  tier ∈ {默认(Auto), 执行(Act)}  AND  沙箱后端可用
沙箱后端可用  ⇔  (platform==linux && srt isEnabled())  OR  (EXEC_RUNTIME==docker)
```

| 平台 / 配置 | 默认/执行档 bash | 说明 |
|---|---|---|
| Linux + srt（生产默认） | ✅ srt 兜底 | deny-net + FS-fence + secret-strip |
| 任意平台 + `EXEC_RUNTIME=docker` | ✅ 容器兜底 | macOS dev 也能安全开 bash |
| macOS/Win 本地 + 无 Docker | ❌ 禁 | srt 在 macOS 会误杀；裸跑不安全（= deer-flow `allow_host_bash:false`） |

### 3.3 自定义 bash 工具内的逻辑守卫（借鉴 deer-flow）

物理沙箱之上再加一层（纵深防御）：
- 命令字符串扫描：拒 `..` 越界、`file://`、越出 workspace 的绝对路径 `cd`；
- 强制 `cwd` 锚定到 session workspace；
- 输出按 `maxOutputBytes` 截断（复用 runner 既有逻辑）；
- 复用 `buildSafeEnv` secret-strip（runtime 已内置）。

---

## 4. 建议 PR 序列（小步、可验证、可回滚）

> 每步：`test:unit` 绿 + **真实启动验证**（起 ws-server 或 smoke-agent 真跑该档 / bash）。提交说明只写验证为真的内容。

- **PR-A（本文，无代码）** 对标小结 + 方案 → 负责人审 §7 决策。
- **PR-B 前端三档选择器**：Explore/默认/执行，对接 `permission-badge.tsx` + Coze 风底部下拉；后端透传（#62 已铺底）。纯 UI + 透传，低风险。
- **PR-C 沙箱化 bash 工具（核心安全工作）**：
  1. 新增 `src/claude/bash/runner.js`（克隆 `python/runner.js`：参数 `{command,cwd,timeoutMs,maxOutputBytes}` → `getExecutionRuntime().exec({command})` + §3.3 逻辑守卫）。
  2. worker 注册 `bashMcpServer = createSdkMcpServer({ tools:[bashTool] })`，**仅当 §3.2 判定通过**才加入 `mcpServers`。
  3. 原生 `Bash` 继续永久禁（`disallowedTools` 保留 `['Bash']`）。
  4. 验证：Linux+srt 真跑 `bash` 工具确认 deny-net/FS-fence；macOS 无 docker 确认工具未注册；`EXEC_RUNTIME=docker` 确认容器内执行。
- **PR-D HITL（真 Ask，Wave 2，单向门）**：worker 命中危险操作时发 `permission_request` 帧 → 前端审批卡 → 响应回传 → 继续。**动 worker/ws 协议，实施前单独出小设计稿。** 自定义 bash 工具比原生更易接审批（工具体内可直接 await 前端响应）。
- **PR-E 收尾**：env 文档化、默认值确认、`tier × sandbox 状态`矩阵测试、ROADMAP/STATUS 更新。

---

## 5. 安全不变量（验收红线）

1. 原生 `Bash` 在所有档位永久禁（`disallowedTools` 含 `'Bash'`）。
2. 自定义 bash 仅在「执行档 + 沙箱可用」注册；其余一律不可达。
3. 非裸-bypass 档位：canUseTool 路径/租户守卫始终在线。
4. 裸 `bypassPermissions` 仅 `CLAUDE_DANGEROUS_DISABLE_GUARD=true`（生产禁开）。
5. secret-strip（`buildSafeEnv`）永远生效，与沙箱开关无关。
6. 凡因沙箱不可用而禁 bash，给用户明确提示（对标 deer-flow 的禁用文案）。

---

## 6. 风险

- **R1 自定义 bash 绕过 disallowedTools**：靠条件性不注册 MCP server 控制（§2 命名注意）。需单测覆盖「macOS 无 docker → server 不在 mcpServers」。
- **R2 srt 对任意 shell 命令的兼容性**：srt 此前只验证过 `python3 file`，任意 bash 命令可能触发 Seatbelt/bwrap 边界。PR-C 需在 Linux 真跑一组代表性命令（ls/cat/git/curl 被 deny-net 拦）验证。
- **R3 Docker 后端冷启动开销**：每 session 容器；与 ExecutionRuntime per-session 计划耦合，按既有 execution-runtime-design §6 处理。

---

## 7. 决策记录（2026-05-31 负责人审定）

| # | 议题 | 结论 |
|---|---|---|
| 1 | 三档命名 | Explore / 默认(Auto) / 执行(Act)（默认档对外可称 Auto） |
| 2 | **Bash 默认策略** | **默认档也允许沙箱内 bash**（非仅执行档）→ §3.2 判定 tier ∈ {默认, 执行} |
| 3 | **HITL 定位** | **融进默认档做「智能 Auto，危险才问」，不新增第四档** → PR-D 据此设计 |
| 4 | 生产裸 bypass | 否，始终带沙箱/守卫兜底；裸 bypass 仅 `CLAUDE_DANGEROUS_DISABLE_GUARD=true` 调试 |
| 5 | macOS bash 门槛 | **必须 `EXEC_RUNTIME=docker`**；srt 在 macOS 会误杀，不开裸跑 |

---

### 下一步
方案与 §7 决策已锁定。按 §4 的 **PR-B → PR-C → PR-D → PR-E** 小步实施，每步 `test:unit` 绿 + 真机验证。
PR-D（HITL，单向门）实施前另出 worker/ws 协议小设计稿。

---

## 8. PR-B 实施细化（前端三档选择器 + 后端透传）

### 8.1 档位 × 能力矩阵（含 skills / MCP / 脚本能力 —— 回应「skills 多需脚本」顾虑）

> 很多 skill 内置 python/bash 脚本。**默认选中档 = 默认(Auto)**，它带 Python（永远在）+ 沙箱 bash，**所以需要脚本的 skill 开箱即用**。只有 Explore 刻意只读、不跑脚本。

| 档位 | 文件读 | 文件写/编辑 | Python 工具 | 沙箱 Bash | MCP 工具 | Skills 脚本 | 适合场景 |
|---|---|---|---|---|---|---|---|
| **Explore🔍**（plan） | ✅ | ❌ | ❌（只读规划，PR-C 决定是否注册） | ❌ | 只读类（SDK plan 自然约束 mutation） | ❌ 不跑 | 看代码、出方案、不动手 |
| **默认⚡**（acceptEdits+guard） | ✅ | ✅ 自动 | ✅ | ✅ 沙箱可用时 | ✅（用户启用的） | ✅ 含脚本 | 日常，危险才问 |
| **执行🚀**（acceptEdits+guard） | ✅ | ✅ 自动 | ✅ | ✅ 沙箱可用时 | ✅ | ✅ 含脚本 | 放手干，少打断 |

- **Python 工具的档位门控属 PR-C**（当前无条件注册）。PR-B 只传档位；选择器文案需诚实反映上表能力，避免用户在 Explore 跑脚本而困惑。
- **MCP 工具**：当前由用户 `enabled.json` 控制、不按档位门控；保持现状。Explore 下的 mutation 由 SDK plan 模式自然抑制。PR-C 再评估是否需要按档位筛 MCP 写类工具。

### 8.2 后端透传 + **越权钳制（安全要点）**

客户端现在不发 `permissionMode`（`ws-server.mjs:909-925` 纯服务端解析）。PR-B 让客户端发"期望档位"，但**绝不能让客户端越权**：org/API 的 `permissionMode + allowBash` 是**上限（ceiling）**，客户端只能选 ≤ 上限的档位。

```
org 原生模式 → 最高档位上限：
  'plan'                         → 上限 = Explore
  'default' / 'acceptEdits'      → 上限 = 默认(Auto)
  'bypassPermissions'            → 上限 = 执行(Act)
最终档位 = min(客户端期望档位, org 上限)   // 只降不升
allowBash=false 时：执行档的 bash 仍受 §3.2 沙箱门控；org 不允许则不开
```

### 8.3 改动清单（小步、可回滚）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/lib/permission-tier.ts`（新） | 定义产品三档 `PermissionTier = 'explore'|'auto'|'act'`；`tierToSdkRequest()`、`clampTierToCeiling(tier, orgMode)`、`tierDisplay()`（icon/label/desc，含能力提示）。**单一真源**，前后端共享。 |
| 2 | `src/components/claude-chat/permission-tier-selector.tsx`（新） | Coze 风底部下拉，三档单选；默认 Auto；Explore 视觉标"只读"；展示 §8.1 能力提示。复用既有 `getModeDisplay` 风格。 |
| 3 | `chat-composer.tsx` | 在输入框工具条挂载选择器（`PermissionBadge` 旁）。 |
| 4 | `src/lib/chat-session-store.ts` | 加 `selectedTier?: PermissionTier` + setter（ephemeral）。 |
| 5 | `src/claude/adapters/ws-adapter.ts` | `InboundMessage.chat` 加 `permissionTier?`；`run()` send 时带上 store 的 `selectedTier`。 |
| 6 | `ws-server.mjs` | chat 帧读 `permissionTier` → `clampTierToCeiling(tier, orgMode)` → `tierToSdkRequest()` → 透传给 worker 的 `permissionMode`。**钳制是安全红线**。 |

- 纯 UI + 透传 + 钳制；不动 worker SDK 调用细节、不动 bash/sandbox（那是 PR-C）。
- 验证：起 ws-server，三档各发一条 chat 真机跑通不 abort；构造"org=plan 但客户端选执行"确认被钳回 Explore（日志 + 行为）。`test:unit` 覆盖 `clampTierToCeiling` 真值表。

### 8.4 安全不变量（PR-B 专属）
- I-B1：客户端档位只能 ≤ org 上限（越权钳制，§8.2）。
- I-B2：缺省/非法 `permissionTier` → 回落 org 解析结果（与今日行为一致，不破坏现状）。
- I-B3：选择器仅改"本次/本会话"档位，不持久化、不改 org 策略。

### 8.5 实施状态（2026-05-31 · 分支 `feat/permission-tier-selector`）

**已完成并验证**：
- `src/lib/permission-tier.js`（共享单一真源：`ceilingFromOrgMode` / `clampTier` / `resolveEffectivePermission`）+ `tests/unit/permission-tier.test.ts`（21 例，含越权/回归真值表）。
- `ws-server.mjs`：chat 帧读 `permissionTier` → 钳制 → 透传（effective mode/bash/disallowedTools/audit 顺序一致）。
- 前端：`chat-session-store`(`selectedTier`) + `ws-adapter`(发送) + `permission-tier-selector.tsx`(Coze 风底部下拉，超上限档位锁定) + `chat-composer` 挂载。
- 验证：`test:unit` 74/74 绿；oxlint 0 错；`tsc` 与 main 同为 209 个既有错误（**新增 0**）；node 真跑钳制矩阵确认 no-escalation + no-regression。

**关键设计取舍（待负责人知会，可否决）**：默认选中档 = **org 上限档**（= 今日实际行为，零回归）。即 bypass 组织用户默认仍显示「执行(Act)」保留 bash；普通组织（default/acceptEdits）默认显示「Auto」符合设计。若要"所有人默认强制 Auto（bypass 组织默认丢 bash，需手选执行）"，是更强的安全默认但属行为变更，留作后续开关。

**未做（环境受限，诚实声明）**：未在真实浏览器渲染下拉做交互冒烟——CLAUDE.md 禁 `pnpm dev`，且 ws-server 全量启动需 DB/auth。逻辑/类型/lint/钳制已真跑验证，视觉交互待联调环境。

---

## 9. 沙盒部署架构：srt vs 独立沙盒容器（方向 ③ 实施参考）

> 本节为**实施方向 ③（独立沙盒容器）时的决策参考**。日期 2026-05-31，结论来自对现有部署的核实 + deer-flow/hermes 对标。

### 9.1 关键发现：生产环境当前**没有真沙盒**（仅密钥剥离）

核实两个 compose：
- 本地 `docker-compose.yml`：**有** `security_opt: seccomp=unconfined`（`:217-218`）→ srt 可跑。
- **生产 `docker-compose.dokploy.yml` 的 `app` 服务：无 `security_opt / seccomp=unconfined`**（全文件 grep 无匹配）。

srt（bubblewrap）**硬依赖** `seccomp=unconfined` 才能用免特权用户命名空间（`src/claude/execution/sandbox.js` 注释明确写明）。因此生产 `ensureSandbox()` 几乎必然初始化失败 → 退化为「仅 `buildSafeEnv` 剥离密钥」。

> **结论**：沙盒能力代码里有、Python 上验证过，但**生产没配置打开它**。今天生产跑用户工具代码，唯一保护是「密钥不进子进程」，**断网/锁目录大概率未生效**。
> ⚠️ 待办：去生产容器日志 grep `[sandbox]`，若见 `env-strip only` 即坐实。Dokploy compose 里的 `SANDBOX_ENABLED: false` 疑为废弃变量（代码实际读 `ENABLE_EXEC_SANDBOX`），决定性因素是缺 seccomp。
> **PR-C 第 0 步**：生产 app 服务补 `seccomp=unconfined`（依赖 bubblewrap/socat/ripgrep 已在 `Dockerfile:72-74`），先把现有沙盒真正打开并验证——独立于 Bash，应立即补。

### 9.2 三条路（"app 已在 Docker 部署"前提下）

1. **srt 在 app 容器内**（bubblewrap 嵌套，`enableWeakerNestedSandbox:true` 专为此设）——**不嵌套 Docker**。
2. **DockerBackend = 从 app 容器内 `docker run` 子容器**——需挂宿主 `docker.sock`（DinD/DooD）。**❌ 否决**：谁能碰 socket 谁就能控宿主机，等于把护城河填了，与沙盒目的自相矛盾。
3. **独立沙盒容器 = 旁边单开容器，app 把命令发过去**（deer-flow Aio / hermes 模式）——**兄弟容器，不碰 socket，非 DinD**。

### 9.3 srt vs 独立沙盒容器 — 关键对比

| 维度 | **srt（容器内 bubblewrap）** | **独立沙盒容器（方向 ③）** |
|---|---|---|
| 本质 | app 容器内，用内核命名空间给每条命令套沙盒 | 旁边单独容器，app 把命令/代码发过去执行 |
| 隔离强度 | 中上；断网+锁目录好，但与 app **共享同一容器/内核** | 更强；独立 rootfs + 容器边界，逃逸更难 |
| **爆炸半径** | ⚠️ 逃逸 = 进入**你的 app 容器**（密钥已剥离但离 app 最近） | ✅ 逃逸 = 一次性、断网、空沙盒容器，烧不到 app |
| 资源限制(CPU/内存/进程/盘) | ❌ 不自带，需 `prlimit`/cgroups 另补 | ✅ 原生（`--memory/--cpus/--pids-limit`） |
| 与 Docker 部署冲突 | ✅ 不冲突，容器内，不嵌套 | ✅ 不冲突，兄弟容器，不碰 docker.sock |
| 速度/冷启动 | ✅ 极快，包一下进程，无冷启动 | ⚠️ 每次起容器有冷启动；要快需热容器池 |
| 工作目录/文件 | ✅ 直接读本地会话目录 | ⚠️ 需文件搬进搬出（挂载或上传下载，FileSyncManager 类） |
| 扩展性（高并发） | 受限于单个 app 容器资源 | ✅ 可池化、跨机、接云（Modal/Daytona） |
| 工程量 | ✅ 低（基本现成：打开 + 接 Bash + 补 prlimit） | ❌ 高（新服务 + 镜像 + 通信协议 + 文件同步 + 生命周期/池） |
| 仓库现状 | 已写好、Python 验证过，差生产打开 | 未做（现有 DockerBackend 是一次性子容器=DinD，不算此项） |

### 9.4 deer-flow 怎么做（方向 ③ 的现成样板）

- **Local provider**：自声明「非安全边界」，默认 `allow_host_bash:false` 直接禁 host bash，仅虚拟路径校验。
- **Aio provider（真沙盒）**：**独立 Docker 沙盒容器 + 池（默认 3 副本）**，app 把命令发过去执行，网络/文件/进程全隔离，外加路径校验 + 输出脱敏。**不从 app 内 spawn 子容器、不碰 docker.sock。**
- hermes 同思路：Docker/Modal/Daytona 当可插拔独立后端，`BaseEnvironment.execute()` → 后端 `_run_bash()`。
- 实施方向 ③ 时，**deer-flow 的 AioSandboxProvider + hermes 的 BaseEnvironment 抽象是最直接的代码样板**。

### 9.5 结论与触发条件

- **近期（PR-C）**：走 **srt + prlimit**——已 80% 现成、快、不嵌套 Docker，几天可落地；隔离对当前阶段够安全（断网+锁目录+剥密钥+资源限制可凑齐）。
- **方向 ③ 触发条件**（满足其一就该上独立沙盒容器）：
  1. 用户是**公开任意注册、完全不可信**，且要跑任意 Bash（爆炸半径必须缩到 app 之外）；
  2. **高并发**需要池化/跨机/弹性扩展；
  3. 需要比 bubblewrap 更强的隔离边界。
- 架构已留口子：`ExecutionRuntime` 抽象（`src/claude/execution/`）就是为换后端设计的，方向 ③ 落地时**只需新增一个 backend，不动 agent loop / web 层**。
