# 续聊即分支 — Live 验证操作指南（两个用户走完整链路）

> 配套执行报告：`2026-06-08-branch-on-reply-execution-report.md`（§8 是这份 guide 的来源）。
> 目标：在本地起的**完整栈**（Nitro + ws-server + worker，连共享 Docker 后端）上，用
> **两个真实用户**走完 `B 看 A 的会话 → B 回复自动分支 → D2 带「分支·」标题 → A 看得到 D2`，
> 并在**数据层**核对不变量。

---

## 0. 现在的状态（我已经替你起好了）

| 组件 | 地址 / 值 | 状态 |
|---|---|---|
| 应用（Nitro，前端+API） | http://127.0.0.1:3100 | ✅ Listening |
| WebSocket 服务（分支逻辑在这） | ws://127.0.0.1:3201/ws/agent | ✅ 426（WS 正常） |
| 桥（共享后端 DB/Redis） | 127.0.0.1:15432 / 16379 → oxygenie-db / oxygenie-redis | ✅ socat |
| 迁移 0025（branched_from_session_id） | 已套用到共享库 | ✅ 列已存在 |
| 会话存储（本机，仅本地会话） | `~/.oxygenie-local-sessions` | ✅ |
| ARK 网关 | 从 `oxygenie-app` 容器拉的 `ANTHROPIC_*`（Bearer） | ✅ models seed OK |
| 邮箱验证 | 关（注册即用） | ✅ |

**打开 http://127.0.0.1:3100 就能用。** 下面是起停命令（你想重启时用）：

```bash
cd <repo>/oxygenie
scripts/local-fullstack.sh --build   # 首次 / 改了代码：建桥 + 注入 ARK + 构建 + 起 Nitro+ws
scripts/local-fullstack.sh           # 之后免构建重启
scripts/local-backend.sh down        # 收工：删桥 + 删 .env.local（不影响 Docker 栈）
```

> ⚠️ 与 `local-prod.sh` 的区别：`local-prod.sh` 只起 Nitro（够点 UI），**不能跑聊天/分支**。
> 验证分支必须用 `local-fullstack.sh`（它额外起 ws-server + 注入 ARK token + 把前端 WS 指到 3201）。

---

## 1. 两个测试用户（已建好，直接登录）

| 角色 | 邮箱 | 密码 | userId（DB 里） |
|---|---|---|---|
| **A = Alice**（会话 owner） | `alice@oxy.local` | `Passw0rd!` | `GfStac15ebGb3DnDQaT7HM4oCvOqBi86` |
| **B = Bob**（成员，来分支的人） | `bob@oxy.local` | `Passw0rd!` | `tWonrUVepf7EKy9fWpE9r71uJqu9lrch` |

**怎么同时当两个用户**（cookie 按浏览器隔离）——任选其一：
- **同一浏览器：一个普通窗口登 Alice + 一个隐身窗口登 Bob**（最简单）。
- 或 **两个浏览器 profile**（Chrome「个人/访客」），各登一个。
- 登录入口：http://127.0.0.1:3100 → 顶部/侧边的登录；没登录会跳到 `/auth`。用上面的邮箱密码登。

---

## 2. 怎么把两个人放进一个「team」

这个产品里**协作的单元 = 项目（Project）**（Model A：项目 = 权限容器，无逐文件 ACL）。
把两人放进一个 team = **Alice 建一个项目，然后把 Bob 加进来**：

**Alice 这边：**
1. 左侧导航进 **项目（Projects）** → 「**新建项目**」，给它起个名（如 `合同审查`）。
2. 进入该项目主页，右上角点 「**分享**」（Share2 图标）。
3. 在弹窗输入框填 **`bob@oxy.local`** → 「**添加成员**」。
   - 后端是 `addProjectMember`（owner-only，按邮箱在用户表里查人，单组织即时生效、零重嵌入）。
   - 成功后 Bob 出现在成员头像/列表里。

**Bob 这边：** 登录后，左侧 **项目** 列表里就能看到 `合同审查`（成员可见）。

---

## 3. 核心验证：B 续聊 → 自动分支

### Step 1 — Alice 在项目里建一个会话 D1，并发一条消息
- Alice 进入项目 `test` → 点项目页里的 **「➕ 在 test 里新建对话」按钮**。
  > ⚠️ 它是个**按钮**（不是能直接输入的框）。点它会打开一个**已绑定到该项目**的全新会话页
  > （创建时即绑定，见下方「修复说明」），再在那个聊天页里输入。
- 在打开的聊天页输入一条消息，例如 `帮我列一个采购合同的审查清单`，发送，等模型回复完
  （这一步真的走 ARK → 有回复说明 ws+worker+网关都通）。
- 这条会话就是 **D1**（owner = Alice，已绑定到 `test`）。回到项目 `test` 的 **Chats 标签**
  （或刷新）应能看到它 —— 这是之前「项目下没有会话」的修复点。

### Step 2 — Bob 打开 D1（只读视角 + 分支提示）
> ⚠️ **不要**从「项目 → Chats 标签」里点 D1 —— 那个链接当前不带 session id，打不开具体会话（见 §5 已知限制）。走下面这条**会话历史列表**的路：

- Bob 进 **聊天页**（`/agents/claude-chat`）→ 展开左侧 **会话历史/最近 列表**。
- 列表里会出现 **Alice 的 D1**（成员可见：`GET /api/agent-sessions` 无 scope 会带上你有权限的项目会话）。按标题找到它，**点击打开**。
- ✅ **预期(图1)**：composer 上方出现提示横幅 **"正在查看共享会话——回复将创建你的分支"**（`BranchReplyBanner`）。这说明系统识别出 Bob 不是 owner。

### Step 3 — Bob 发表回复 → 自动开分支 D2
- Bob 在这条会话里**输入一条回复并发送**，例如：`再补充一条关于违约金条款的检查项`。
- ✅ **预期**：
  1. 系统**不写入 D1**，而是 fork 出一条新会话 **D2**（worker 内 `forkSession`，把 D1 的上文复制成新 JSONL）。
  2. D2 标题自动加 **「分支·」** 前缀（如 `分支·合同审查清单`）。
  3. 当前线程顶部出现 **"— 从 <D1 标题> 建立的分支 —"** 分割符（图2，`BranchedFromDivider`，v1 在顶部）。
  4. Bob 的这条回复 + 模型应答都落在 **D2** 里。

### Step 4 — Alice 看得到 D2
- Alice 回到项目 `合同审查` → **Chats 标签**（或刷新）→ 应能看到新增的 **`分支·…`** 会话。
  - 注：新建分支后 `onSessionInit` 会失效 `project-sessions` 查询，Alice 端**理论上自动刷新**；
    若没刷出来，手动刷新页面即可（实时性非本次重点）。
- Alice 打开自己的 **D1**，内容**不变**（Bob 的回复**没有**进 D1）——这是最关键的不变量。

---

## 4. 数据层核对（最硬的证据）

跑这几条 SQL（直接连共享库的容器），确认不变量：

```bash
docker exec -it oxygenie-db psql -U oxygenie -d oxygenie
```

```sql
-- 看 Alice / Bob 最近的会话：D1 应 owner=Alice 且 branched_from 为空；
-- D2 应 owner=Bob、branched_from_session_id = D1.id、title 带「分支·」、project_id 与 D1 相同。
SELECT id, user_id, project_id, branched_from_session_id, title, created_at
FROM agent_session
WHERE user_id IN ('GfStac15ebGb3DnDQaT7HM4oCvOqBi86','tWonrUVepf7EKy9fWpE9r71uJqu9lrch')
ORDER BY created_at DESC
LIMIT 10;
```

**期望（PASS 标准）：**
| 不变量 | 期望 |
|---|---|
| D2.user_id | = Bob（`tWonrUVepf...`） |
| D2.branched_from_session_id | = D1.id |
| D2.project_id | = D1.project_id（同一项目） |
| D2.title | 以 `分支·` 开头 |
| D1.user_id | 仍 = Alice，且 D1.branched_from_session_id 为 NULL |
| D1 的内容（JSONL） | 不含 Bob 的回复（R1 不变量：源会话零污染） |

可选：核对两条会话各自的 JSONL（确认 D2 复制了 D1 上文 + 续写，D1 没被动过）：
```bash
ls -la ~/.oxygenie-local-sessions/*/.claude/projects/*/   # 找到两个 sessionId.jsonl
```

---

## 5. 已知限制 / 注意事项（不影响本次验证结论）

1. **项目 Chats 标签的会话链接打不开具体会话**（`to="/agents/claude-chat"` 没带 session id）。
   → 验证时让 Bob 走「聊天页会话历史列表」打开 D1。已记为待修 polish。
2. **分支分割符 v1 在线程顶部**，不是精确 fork 点（精确版需把 `forkedFrom` 打通到前端，已延后）。
3. **banner 不显示 owner 名字**（v1 name-less，已延后）。
4. **本地会话只在本机**：`CLAUDE_SESSIONS_ROOT=~/.oxygenie-local-sessions`，与容器 `/data/users`
   不共享。所以**用上面新建的 alice/bob 全程在本地栈里操作**——别期望在 oxygenie.cc 里看到这些会话。
   （DB 是共享的，所以这些会话的 DB 行会进共享库；测试完可清理，见 §6。）
5. **3001 端口有个 4 天前的 phasec 遗留进程**（`oxygenie-phasec` 的 `start-production.mjs`）。
   我没动它，本地 WS 用的是 **3201**，互不影响。你想清掉它可以 `kill 23638`（非必须）。
6. **fork 在 model 应答前发生**：即使 ARK 那一轮失败，D2 的创建 + lineage 也已经落库（fork 在 query 之前）。

---

## 排障：聊天报 `Invalid API key` / `Invalid bearer token`

> 已在 `local-fullstack.sh` 里修好（实测发 "pong" 通过），这里留根因，万一复现：

ARK 走 **Bearer**（`ANTHROPIC_AUTH_TOKEN`），且 **base 必须是 `…/api/coding`**。两个坑：
1. **`.env` 里 `ANTHROPIC_API_KEY` 非空** → SDK 改走 x-api-key → ARK 拒（`Invalid API key`）。
   脚本在 `.env.local` 里强制 `ANTHROPIC_API_KEY=`（空）中和它（`.env.local` 最后加载，赢）。
2. **Node `--env-file` 不覆盖「环境里已存在」的变量**。若你的 shell（如 Claude Code 运行时）已
   export `ANTHROPIC_BASE_URL=https://api.anthropic.com`，它会压过文件里的 ARK base → ARK token
   被发到真·Anthropic → `Invalid bearer token`。脚本在启动前 `unset` 所有环境里的 `ANTHROPIC_*`，
   让文件值生效。

自查：`node --env-file=.env --env-file=.env.local -e 'console.log(process.env.ANTHROPIC_BASE_URL)'`
若打印的不是 `https://ark.cn-beijing.volces.com/api/coding`，就是你的 shell 有 `ANTHROPIC_*` 泄漏，
`unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY` 后重跑脚本。

---

## 6. 测试完清理（可选）

```bash
# 停栈：到运行 local-fullstack.sh 的终端按 Ctrl-C
scripts/local-backend.sh down          # 删桥 + .env.local

# 清测试数据（共享库里）：删两个测试用户 → 级联删他们的会话/项目/成员
docker exec -it oxygenie-db psql -U oxygenie -d oxygenie -c \
 "DELETE FROM \"user\" WHERE email IN ('alice@oxy.local','bob@oxy.local');"
rm -rf ~/.oxygenie-local-sessions     # 删本地会话文件
```

> 迁移 0025 是**加性**改动（一个可空列 + 自引用 FK），对旧代码无害，**留着不用回滚**
> （oxygenie.cc 部署的旧镜像会忽略这个列）。
</content>
