# 单入口路由结构健康验证报告（/agents/c + /agents/projects/*）

> 日期：2026-06-10 ｜ 验证人：Claude ｜ 分支：`feat/projects-ui-shell`（未提交工作区）
> 背景：Codex 物理删除旧 `/agents/claude-chat` route，聊天内核迁至
> `src/components/claude-chat/claude-chat-controller.tsx`，单入口收口为 ChatGPT 风格。
> 本报告按 Owner 下发的 7 项验证清单逐项核验：**全部通过**，另附 4 条非阻断观察。

## 验证方式

- **静态**：routeTree.gen.ts（含 `pnpm build` 后再生成比对）、全 src 旧引用扫描、
  新旧文件 diff（`git show HEAD:src/routes/agents/claude-chat/route.tsx` vs 新 controller）、
  controller 生命周期逐段审读、`pnpm typecheck` 基线对比。
- **运行时**：`scripts/local-fullstack.sh`（Nitro :3100 + ws :3201，连共享 Docker 后端，
  新鲜构建），用 alice/bob 两个测试账号实测全部 URL 流，DB 经 `oxygenie-db` psql 直查。

## 逐项结论

### 1. 路由树健康 ✅
- `routeTree.gen.ts`（构建再生成后）`claude-chat` 0 残留，`AgentsClaudeChat` 0 残留。
- 6 条目标路由齐全：`/agents/c/`、`/agents/c/$sessionId`、`/agents/projects`(+`/`)、
  `/agents/projects/$projectId`(+`/`)、`/agents/projects/$projectId/c/`、
  `/agents/projects/$projectId/c/$sessionId`。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` 通过（33.9s）。

### 2. 导航入口健康 ✅
- Header / marketing CTA / AdminLayout back / auth redirect 默认值 / __root redirectTo /
  admin.server 全部指 `/agents/c`；`src/routes/agents/index.tsx` redirect `/agents/projects`。
- 运行时：`/agents/` → 302 到 `/agents/projects`（workspace home + ProjectsRail）✅；
  Bob 无 redirect 参数登录 → 落 `/agents/c` → 镜像 `/agents/c/72c1b5db-…` ✅。
- `site-header.tsx` 标题映射 `/agents/c`、`/agents/c/*` → claudeChat ✅。

### 3. 新建单聊 ✅
- Rail「New chat」→ `/agents/c`（newChat 路由）→ createSession → session_init →
  URL `replace` 镜像为 `/agents/c/86e65c1b-…`。无旧路由闪现。
- DB：该 session `project_id` 为 NULL（loose chat）✅。

### 4. 项目内新建聊天 ✅
-「New chat in test」→ `/agents/projects/f463a13f…/c` → session_init →
  `/agents/projects/f463a13f…/c/f25d0bf9-…`，全程项目路径内，未闪到 `/agents/c`。
- DB：`f25d0bf9` 行 `project_id = f463a13f`（**创建时即绑定**，经
  `create_session{projectId}` → `handleCreateSession` 链路）✅。

### 5. 深链 ✅
- 刷新 `/agents/c/$id`：URL 持续观察 4.8s 无跳变，composer 就位；服务端日志确认
  `Resuming session: 86e65c1b → SDK f0db61a3` + JSONL 加载。
- 刷新 `/agents/projects/$pid/c/$id`：URL、ProjectsRail（双项目链接）、项目上下文全保留。
- 旧 mount-resume 不再覆盖 URL session：controller 在 `urlSessionId || newChat ||
  pendingProjectId` 时跳过 store 恢复（landmine #1 修复已核读）。

### 6. 分支后端/前端回归 ✅
实测链路：Alice 在项目 `test` 建 D1（f25d0bf9）发消息得到 ARK 回复 → Bob（非会话 owner，
项目成员）从项目 Chats 标签打开 D1：
- **图1 banner** 渲染："Viewing a shared conversation — replying will create your own branch."
- Bob 回复 → 150ms 采样的 URL 日志显示**单次干净切换**：
  `…/c/f25d0bf9`（t=0）→ `…/c/6ab5fa02-…`（t=2.9s），无中间闪跳。
- **streaming 未被 bootstrap 二次 switch 清掉**：D2 线程含继承消息 + Bob 消息 +
  完整流式回复（"地球有 1 个自然卫星"）。机制 = onSessionInit 在 navigate 前先写
  `currentSessionIdRef` + store（remount 场景由 `getSessionId()` 兜底）。
- DB：D1 行**不变**（owner Alice、title 原样、branched_from NULL）；
  D2 = `6ab5fa02`，owner Bob，project test，`branched_from_session_id = 43fb7077`
  （= D1 行**主键** —— 该列按 PK 引用，非 sdkSessionId，属 schema 设计而非 bug），
  title「分支·请用一句话回答…」。
- D2 深链刷新后：**BranchedFromDivider**（"Branch from <D1 标题>"）+ **L8 逐条作者头像**
  （继承轮次 Alice (Owner) ×2，新轮次 Bob (Member) ×1）均正确渲染。
- 附带修复确认：项目 Chats 标签的会话链接现在带 session id（06-08 指南 §5 的已知缺陷已消除）。

### 7. 旧 URL 行为 ✅
- 登录态访问 `/agents/claude-chat` → 应用内 NotFound（"The page you are looking for does
  not exist." + GO BACK / START OVER），符合 TanStack `notFoundComponent` 预期。
- 未登录访问 → `/agents` 层 auth guard 先接管跳登录（登录后回跳同样落 NotFound）。
- 无任何可用旧入口。

## 内核搬移完整性（diff 审计）

旧 route 文件 vs 新 controller（diff -w）：**被删的只有 route 壳**
（`createFileRoute`/loader/`RouteComponent` 包装 + 对应 import）；loader 职责
（getPermissionInfo + ensureDefaultSkillsFn）由 4 个新路由文件原样承接。其余全为增强：
URL bootstrap、onSessionInit URL 镜像、项目绑定、分支指示器、`showInternalSessionList`。
聊天逻辑零删减。

## 非阻断观察（不影响验收，建议后续处理）

1. **每次访问 `/agents/c` 即建会话 + 触发一次 1 字符 init 模型调用**（登录默认落点、
   Header、marketing CTA 同理）。空"未命名"会话会在 RECENT 累积，且每次登录都打一次
   ARK。这是"入口=新建落地页"拍板与既有 eager-create 模式叠加的后果，建议后续改
   lazy-create（首条消息才建）。本次验证期间即产生 3 个空会话。
2. **typecheck**（全库基线本就 ~200 错，CI 不跑 tsc）：4 个新路由文件有同一处
   `getPermissionInfo` 返回类型字面量拓宽 vs `PermissionInfo` 收紧的报错（功能无碍，
   一行 cast/类型对齐可消）；controller 9 处为全库通病的 IntlayerNode-vs-string 噪音。
3. `site-header.tsx` 留有死映射 `"/agents/chat": "chat"`（无此路由），纯化石可顺手删。
4. 本地环境噪音（与路由无关）：`getCuratedSkillSchemaFn` 500 ×7
   （"Curated skill not found: update-config/debug/simplify/batch/loop/claude-api/
   less-permission-prompts"）— 本地 skills store 缺策展条目，技能域问题。

## 测试遗留物（已于同日收尾，Codex 验收后）

- ~~共享 DB 新增 4 条测试会话~~ → **已删除**（`DELETE … RETURNING` 精确命中 4 行；
  alice/bob 账号、项目 `test`、06-08 的旧会话未触碰；session_document/message_attachment
  为 CASCADE，自动清理）。
- ~~本地 fullstack 仍在跑~~ → **已停止**（:3100/:3201 已释放）。socat 桥
  （oxygenie-devbridge-*）与 `.env.local` 早于本次验证存在，按常驻开发夹具保留，
  收工可用 `scripts/local-backend.sh down`。
- 父仓 `.claude/launch.json` 的 `oxygenie-fullstack` 启动配置**保留**（复用于后续 preview 验证）。
- 测试账号见 `2026-06-08-branch-live-verification-guide.md` §1。

## 验收后顺手修复（Codex 点名，同日完成）

1. **PermissionInfo 字面量拓宽**：4 个新路由文件 loader 内
   `permissionInfo as PermissionInfo`（server-fn RPC 类型链把 `mode` 拓宽为 string，
   运行时值实为 PermissionMode）。typecheck 由 196 → 192，改动文件零报错。
   同类报错还有一处 pre-existing 于 `settings/permissions/route.tsx:27`（HEAD 即有，
   未在点名范围，留待基线治理）。
2. **site-header 死映射**：删 `"/agents/chat": "chat"`。同表还有 `/agents/image-chat`、
   `/agents/workflow` 两个更早的同类化石（HEAD 即有），未在点名范围，留待顺手清。
3. **（补验时发现）`tests/unit/projects-access.test.ts` 从未执行过**：vitest 全局默认
   jsdom 环境被 pre-existing 依赖问题（jsdom→html-encoding-sniffer@6 require ESM-only
   `@exodus/bytes` → ERR_REQUIRE_ESM）弄坏，纯函数测试被连坐、0 用例运行。按房子惯例
   （其余 9 个存活测试同款）补 `// @vitest-environment node` 一行 → **10/10 绿**。
   这是 P1 安全关键测试（"非成员看不到"回归）。另有 14 个旧 jsdom 测试文件仍被该
   依赖问题挡住（HEAD 即有，与本分支无关），建议另立环境治理项。

lazy-create（P1.5）已作为独立后续任务移交，不混入本分支已验收的改动。
