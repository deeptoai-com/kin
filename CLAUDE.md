# OxyGenie - 开发规则

## 项目背景

本项目基于 **TanStack Start** 构建，提供 SSR、路由、服务端函数等现代全栈能力。

### 双 SDK 架构

项目集成了两套 AI Agent SDK，各有分工：

| 特性 | Claude Agent SDK | Mastra AI SDK |
|------|-----------------|---------------|
| **主要职责** | 交互式聊天 + 代码执行 | 文件分析 + 工作流编排 |
| **通信方式** | WebSocket（持久连接） | HTTP/SSE（请求-响应） |
| **LLM** | Claude (Anthropic API) | 可配置（OpenAI 兼容） |
| **执行模型** | 子进程隔离 | 进程内 |
| **沙盒环境** | ✅ 支持（Per-Session） | ❌ 不支持 |
| **会话恢复** | ✅ 原生支持 | ❌ 需自行实现 |
| **文档获取** | 需通过 Web 搜索 | MCP 工具支持 |

### MCP (Model Context Protocol) 状态

**当前状态**: 未配置

- Claude Agent SDK 原生支持 MCP，会在 session metadata 中暴露 `mcp_servers` 字段
- Mastra SDK 的文档可通过 MCP 工具获取（如 `mastraDocs`、`mastraMigration`）
- 项目本身暂未配置 MCP 服务器

---

## 项目状态

本项目基于 **TanStack Start** 构建。

**GitHub 仓库**: https://github.com/foreveryh/oxygenie

**已完成的功能 (Phase 1-4)**:
- Phase 1: WebSocket 服务器 + Claude Agent SDK 集成
- Phase 2: 用户隔离（Child Process + Docker 容器化）
- Phase 3: Per-Session Sandbox（每会话独立配置目录）
- Phase 4: 前端集成（Session 列表、Resume、标题管理）

## 开发目录规则

**正确的开发目录**: 项目根目录（仓库 clone 后的目录）

**禁止在以下目录开发**:
- 父目录（仅用于文档和参考）
- 其他项目目录（原始参考代码等）
- 任何临时开发目录（如历史 phase 目录，已清理）

## 项目结构

```
OxyGenie/
├── src/
│   ├── components/claude-chat/   # Claude Chat UI 组件
│   ├── lib/                      # 工具库和适配器
│   ├── routes/                   # TanStack Router 路由
│   ├── server/                   # 服务端逻辑
│   └── db/                       # 数据库 schema
├── ws-server.mjs                 # WebSocket 服务器入口
├── ws-query-worker.mjs           # Worker 进程
├── docker-compose.yml            # Docker 部署配置
└── Dockerfile                    # 容器镜像定义
```

## 技术栈

- **前端**: TanStack Start + React + Assistant UI
- **后端**: WebSocket Server + Claude Agent SDK
- **数据库**: PostgreSQL + Drizzle ORM
- **认证**: Better Auth
- **部署**: Docker Compose

## 开发命令

```bash
# 启动开发服务器
pnpm dev

# 启动 WebSocket 服务器（开发/生产统一使用）
node ws-server.mjs

# Docker 部署
docker-compose up -d
```

## Git 工作流

- 主分支: `main`
- 远程仓库: `origin` → https://github.com/foreveryh/oxygenie
- 直接在 `main` 分支开发，或创建 feature 分支后合并

---

## Claude Agent SDK 集成

### 版本信息
- `@anthropic-ai/claude-agent-sdk`: `^0.1.76`

### 核心文件

| 文件 | 职责 |
|------|------|
| `ws-server.mjs` | WebSocket 服务器主入口，处理认证、会话管理、进程生命周期 |
| `ws-query-worker.mjs` | 子进程 Worker，调用 SDK 的 `query()` 函数 |
| `src/claude/adapters/ws-adapter.ts` | 前端 WebSocket 适配器，将 SDK 事件转换为 Assistant UI 格式 |
| `src/db/schema/agent-session.schema.ts` | Session 元数据持久化 Schema (claudeHomePath, sdkSessionId 等) |
| `src/db/schema/session-document.schema.ts` | Session 文档关联 Schema (workspace knowledge-base) |

### 架构流程

```
Frontend (Browser)
    ↓ WebSocket (/ws/agent)
ws-server.mjs (主进程)
    ├─ 认证验证 (Better Auth)
    ├─ 会话管理 (workspaceSessionId ↔ sdkSessionId 映射)
    └─ 进程管理 (spawn/kill)
        ↓
ws-query-worker.mjs (子进程)
    └─ query() from @anthropic-ai/claude-agent-sdk
        ├─ 沙盒环境 (CLAUDE_HOME, cwd)
        ├─ Skills 加载 (.claude/skills)
        └─ 结构化输出 (JSON Schema)
```

### 关键配置选项

```javascript
// ws-query-worker.mjs 中的 query() 调用
const result = await query({
  prompt: userMessage,
  cwd: sessionWorkspace,                    // Per-Session 工作目录
  settingSources: ['project'],              // 加载 .claude/skills
  tools: { preset: 'claude_code' },         // 工具集
  systemPrompt: { preset: 'default', append: customPrompt },
  outputFormat: { schema: jsonSchema },     // 可选：结构化输出
  resumeSessionId: previousSdkSessionId,    // 可选：会话恢复
});
```

### 文档获取方式

Claude Agent SDK 文档相对较新，**无法通过 MCP 工具获取**，需要：
1. 通过 Web 搜索获取最新文档
2. 查看 SDK 源码和 TypeScript 类型定义

### 环境变量

```bash
# Anthropic API
ANTHROPIC_API_KEY=<your-api-key>
ANTHROPIC_BASE_URL=<optional-base-url>
ANTHROPIC_MODEL=<optional-model-override>

# WebSocket 服务器
WS_PORT=3001
APP_URL=http://localhost:5000
CLAUDE_SESSIONS_ROOT=/data/users
ENABLE_STRUCTURED_OUTPUTS=true  # 可选
```

---

## Mastra AI SDK 集成注意事项

### 版本信息
- `@mastra/core`: `1.0.0-beta.19` (v1 Beta)
- `@mastra/ai-sdk`: `1.0.0-beta.12` (用于 AI SDK UI 集成)
- `ai`: `^5.0.47` (Vercel AI SDK 核心包)
- `@ai-sdk/react`: `^3.0.11` (Vercel AI SDK React 集成)

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/mastra/index.ts` | Mastra 实例，注册 Agent 和 Workflow |
| `src/mastra/agents/chat-agent.ts` | Chat Agent 定义 |
| `src/mastra/tools/*.ts` | 自定义工具（如 S3 文件获取） |
| `src/mastra/workflows/*.ts` | 工作流定义 |

### 文档获取方式

Mastra SDK 支持通过 **MCP 工具** 获取文档：
- `mastraDocs`: 获取官方文档
- `mastraExamples`: 获取代码示例
- `mastraMigration`: 获取迁移指南
- `mastraChanges`: 获取 changelog

### API 变化 (v1 重要！)

Mastra v1 的 Agent API 发生了重大变化：

| 旧 API (v0.x) | 新 API (v1) | 说明 |
|---------------|-------------|------|
| `streamVNext()` | `stream()` | 标准流式 API |
| `generateVNext()` | `generate()` | 标准生成 API |
| `stream()` | `streamLegacy()` | 仅支持 AI SDK v4 模型 |
| `generate()` | `generateLegacy()` | 仅支持 AI SDK v4 模型 |

### 正确的集成方式 (v1)

**后端 API 路由** (`/src/routes/api/chat.tsx`):
```typescript
import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';
import { mastra } from '~/mastra';

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const params = await request.json();
        const stream = await handleChatStream({
          mastra,
          agentId: 'chat-agent',
          params,
        });
        return createUIMessageStreamResponse({ stream });
      },
    },
  },
});
```

**前端组件** (`/src/components/ai-sdk-chat.tsx`):
```typescript
import { useChat } from '@ai-sdk/react';

const { messages, sendMessage, status, regenerate } = useChat({
  api: '/api/chat',
});
```

### 常见错误和陷阱

❌ **错误方式** - 直接使用 Agent 的流式方法：
```typescript
// v1 中这些方法签名变了，不能直接这样用
agent.streamVNext(messages)  // v1 中已改名为 stream()
stream.toUIMessageStreamResponse()  // 不存在
```

✅ **正确方式** - 使用 `@mastra/ai-sdk` 的工具函数：
```typescript
import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';

const stream = await handleChatStream({
  mastra,
  agentId: 'your-agent-id',
  params,  // { messages: [...] }
});
return createUIMessageStreamResponse({ stream });
```

### 官方文档参考

集成 AI SDK UI 时，**必须先查阅官方文档**：
- [Using AI SDK UI](https://mastra.ai/guides/v1/build-your-ui/ai-sdk-ui)
- [Migration: VNext to Standard APIs](https://mastra.ai/guides/v1/migrations/vnext-to-standard-apis)
- [Agent Upgrade Guide](https://mastra.ai/guides/v1/migrations/upgrade-to-v1/agent)

### 流式响应格式

API 返回的 Server-Sent Events (SSE) 格式：
- `{"type":"start","messageId":"..."}` - 消息开始
- `{"type":"reasoning-start","id":"..."}` - 推理开始
- `{"type":"text-delta","id":"...","delta":"..."}` - 文本增量
- `{"type":"tool-input-start",...}` - 工具调用开始
- `{"type":"finish"}` - 完成

### GLM-5.0 模型配置

Mastra v1 内置智谱 AI 支持，使用 `zhipuai/` 前缀：

**Agent 定义** (`/src/mastra/agents/chat-agent.ts`):
```typescript
import { Agent } from '@mastra/core/agent';

export const chatAgent = new Agent({
  name: 'chat-agent',
  instructions: '...',
  model: 'zhipuai/glm-5.0',  // Mastra 内置 model gateway
  tools: { /* ... */ },
});
```

**环境变量** (`.env`):
```bash
# Zhipu AI API Key (Mastra 内置网关)
ZHIPU_API_KEY=your_api_key_here
```

**可用模型**：
- `zhipuai/glm-4.5` (131K context)
- `zhipuai/glm-4.6` (205K context)
- `zhipuai/glm-5.0` (205K context)
- 以及 air、flash 等轻量版本

---

## TanStack Start 核心规则（来自 .ruler/AGENTS.md）

### 数据加载规则
1. **Fetch on navigation**：在 route loaders 中获取数据（SSR + streaming）
2. **Server work**：通过 TanStack Start server functions 在服务端完成
3. **URL as state**：将页面/UI 状态保持在 URL 中（typed search params）
4. **Effects for external only**：useEffect 只用于真实的外部副作用（DOM、订阅、分析）
5. **数据分层**：
   - Server-synced domain data → TanStack DB collections
   - Ephemeral UI/session → zustand 或 localStorage
   - Derived views → render 时计算或 live queries

### 服务端函数（Server Functions）最佳实践

> **官方文档**: [Server Functions | TanStack Start](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)

Server Functions 是 TanStack Start 推荐的 **类型安全的 RPC 机制**，用于替代传统 REST API。

#### 核心优势

| 特性 | REST API | Server Functions |
|------|----------|------------------|
| **类型安全** | ❌ 手动维护类型定义 | ✅ 自动推导 |
| **调用方式** | `fetch('/api/...')` | `await fn()` |
| **序列化** | ❌ 手动 `JSON.stringify/parse` | ✅ 自动处理 |
| **错误处理** | ❌ 手动检查 `response.ok` | ✅ 自动处理 |
| **认证** | ❌ 每个路由单独检查 | ✅ 统一 `requireUser()` |
| **Redirect** | ❌ 手动处理 30x 响应 | ✅ `throw redirect()` |
| **Validation** | ❌ 需要中间件 | ✅ 内置 `inputValidator` |
| **Bundle 安全** | ⚠️ 需要手动配置 | ✅ 自动隔离 |

#### 基本用法

**定义 Server Function**：
```typescript
// src/server/function/skills.server.ts
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// GET 请求（默认）
export const listSkillsStore = createServerFn({ method: 'GET' })
  .handler(async () => {
    return await getSkillsStore();  // 返回类型自动推导
  });

// POST 请求 + 输入验证
export const enableUserSkill = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    skillName: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await enableSkill(user.id, data.skillName);
    return { success: true };
  });
```

**在路由 loader 中调用**：
```typescript
// src/routes/agents/skills/route.tsx
export const Route = createFileRoute('/agents/skills')({
  loader: async () => {
    // 并行加载数据（SSR + streaming）
    const [skills, enabledSkills] = await Promise.all([
      listSkillsStore(),
      listUserSkills(),
    ]);
    return { skills, enabledSkills };
  },
  component: () => {
    const { skills, enabledSkills } = Route.useLoaderData();
    return <SkillsPageComponent skills={skills} enabledSkills={enabledSkills} />;
  },
});
```

**在组件中调用**：
```typescript
import { useServerFn } from '@tanstack/react-start';

export const SkillsPageComponent = ({ skills, enabledSkills }) => {
  const enableSkill = useServerFn(enableUserSkill);

  const handleToggle = async (skillSlug: string) => {
    // 类型安全的调用
    await enableSkill({ data: { skillName: skillSlug } });
  };
};
```

#### 规范要求

1. **❌ 禁止使用 REST API 路由**
   - 不要创建 `/routes/api/skills/*.ts` 文件
   - 不要使用 `server: { handlers: { GET: ... } }` 模式
   - 不要在前端使用 `fetch('/api/...')`

2. **✅ 必须使用 Server Functions**
   - 所有服务端操作定义为 `createServerFn()`
   - 前端通过 `useServerFn()` 或直接调用
   - 输入验证使用 Zod schemas

3. **✅ 数据加载在 loader 中**
   - 页面初始数据在 `loader` 中预加载
   - 使用 `Promise.all()` 并行加载
   - 组件通过 `Route.useLoaderData()` 获取数据

4. **✅ 认证统一处理**
   ```typescript
   const requireUser = async () => {
     const { headers } = getRequest();
     const session = await auth.api.getSession({ headers });
     if (!session?.user) throw new Error('UNAUTHORIZED');
     return session.user;
   };
   ```

#### 重构示例

**Before（❌ 不推荐）**：
```typescript
// REST API 路由
export const Route = createFileRoute('/api/skills/store')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await getSkillsStore());
      },
    },
  },
});

// 前端 fetch 调用
loadAvailableSkills: async () => {
  const response = await fetch('/api/skills/store');
  const data = await response.json();
  set({ availableSkills: data });
}
```

**After（✅ 推荐）**：
```typescript
// Server Function
export const listSkillsStore = createServerFn({ method: 'GET' })
  .handler(async () => {
    return await getSkillsStore();
  });

// 路由 loader
export const Route = createFileRoute('/agents/skills')({
  loader: async () => {
    const skills = await listSkillsStore();
    return { skills };
  },
});

// 组件使用 props
export const SkillsPageComponent: FC<{ skills: SkillInfo[] }> = ({ skills }) => {
  // 数据已通过 loader 加载
};
```

#### 认证和错误处理

```typescript
// Server Function 自动处理 redirect/notFound
export const requireAuth = createServerFn()
  .handler(async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw redirect({ to: '/login' });  // 自动重定向
    }
    return user;
  });

// 前端调用：自动处理响应
const user = await requireAuth();  // 未认证时自动跳转
```

#### 环境变量安全

```typescript
// ❌ 危险：可能泄露到客户端
const apiKey = process.env.SECRET_KEY;

// ✅ 安全：使用 Server Function
const getApiKey = createServerOnlyFn(() => {
  return process.env.SECRET_KEY;  // 永远只在服务端
});
```

#### 参考文档

- [Server Functions 官方文档](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [Code Execution Patterns](https://tanstack.com/start/latest/docs/framework/react/guide/code-execution-patterns)
- [Static Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/static-server-functions)

### 项目约束
- ✅ 使用 pnpm
- ✅ 所有路由文件必须是 TypeScript React (`.tsx`)
- ✅ 使用 alias imports：`~` 解析为 `./src` 根目录
- ❌ **禁止**更新 `.env`（应更新 `.env.example`）
- ❌ **禁止**使用 `pnpm run dev` 或 `npm run dev` 启动
- ❌ **禁止**创建本地 pnpm store

### 路由验证工具

项目提供了自动化路由验证工具，用于检查代码是否符合 TanStack Start 最佳实践。

#### 使用方法

```bash
# 运行路由验证
pnpm validate-routes

# 查看验证脚本
cat scripts/validate-routes.mjs

# 查看使用指南
cat scripts/README.md
```

#### 验证内容

**错误级别（必须修复）**：
- ❌ 禁止 REST API 路由（`server: { handlers: { GET } }`）
- ❌ 禁止在 loader 中使用 `fetch()`
- ❌ 禁止在 zustand store 中获取数据

**警告级别（建议优化）**：
- ⚠️  推荐使用 Server Functions 而不是 `fetch()`
- ⚠️  避免在 `useEffect` 中获取数据
- ⚠️  Loader 应使用 `Promise.all()` 并行加载数据

#### 集成到开发流程

**提交前检查**：
```bash
# 1. 验证路由
pnpm validate-routes

# 2. 运行 linter
pnpm lint

# 3. 运行测试
pnpm test
```

**当前项目状态**：
- 总文件数：48 个路由文件
- 通过验证：21 个
- 需要优化：29 个（主要是旧的 REST API 路由）

**参考文档**：
- [验证工具使用指南](scripts/README.md)
- [手动检查清单](docs/ROUTE_VALIDATION_CHECKLIST.md)

### Hydration + Suspense 规则
- 同步更新导致 suspend → fallback 替换 SSR 内容
- 解决：用 `startTransition` 包装同步更新（直接 import）
- hydration 期间避免：`useTransition` 的 `isPending`、`useSyncExternalStore` mutation

### 嵌套路由规则（重要！）

> **官方文档参考**: https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing

TanStack Router 使用文件系统来表示路由层级。当子目录包含 `route.tsx` 时，会形成嵌套路由关系。

**官方定义**（摘自 TanStack Router 文档）：
- **Layout Routes**: 用于包装子路由的组件和逻辑，内部使用 `<Outlet />` 作为嵌套内容的占位符
- **`route.tsx`**: 在目录中定义该路径的组件（如 `/account` 对应 `account/route.tsx`）
- **`index.tsx`**: 当路由精确匹配且没有子路由匹配时激活
- **`<Outlet />`**: 渲染下一个可能匹配的子路由，不接受任何 props，可放置在路由组件树的任何位置

**核心规则**：
1. 父路由（Layout Route）必须提供 `<Outlet />` 组件来渲染子路由内容
2. 如果路由没有定义组件，会自动渲染 `<Outlet />`
3. 如果没有子路由匹配，`<Outlet />` 返回 `null`

**目录结构示例**：
```
routes/
├── parent/
│   ├── route.tsx      ← Layout Route（包装子路由，需要 Outlet）
│   ├── index.tsx      ← /parent 的默认内容
│   └── child/
│       └── route.tsx  ← /parent/child 的内容
```

**常见错误**：
❌ 错误：`parent/route.tsx` 不包含 `<Outlet />`，导致访问 `/parent/child` 时子路由无法显示
✅ 正确：父路由使用 `<Outlet />` 或条件渲染

**条件渲染模式**（当父路由既有自己的内容，又需要渲染子路由时）：
```typescript
import { Outlet, useMatch } from '@tanstack/react-router';

function RouteComponent() {
  const childMatch = useMatch({
    from: '/parent/child',
    shouldThrow: false,
  });

  if (childMatch) {
    return <Outlet />;  // 渲染子路由
  }

  return <ParentContent />;  // 渲染父路由自己的内容
}
```

**替代方案**（更符合官方推荐的 Layout 模式）：
```typescript
// parent/route.tsx - 作为纯 Layout
function ParentLayout() {
  return (
    <div className="parent-wrapper">
      <Outlet />  {/* 子路由或 index 内容在此渲染 */}
    </div>
  );
}

// parent/index.tsx - 父路由的默认内容
function ParentIndex() {
  return <ParentContent />;
}
```

**详细规范**：见 `src/routes/agents/ai-workflow/CLAUDE.md`

---

## Docker 修改规则（强制执行）

### 核心文件修改前的强制检查

**在对 Dockerfile、docker-compose.yml、启动脚本等核心文件做任何修改前，必须：**

#### 1. 对比原始脚手架
```bash
# 在参考目录验证原始行为（若本地有原始脚手架）
cd <path-to-original-starter>
pnpm run build
# 检查输出结构
ls -la .output/
```

#### 2. 确认问题根源
- 问题是否是本地修改导致的？
- 原始脚手架是否有同样问题？
- 如果原始版本正常，找出差异在哪里

#### 3. 最小修改原则
- 优先修复配置，而不是添加新文件
- 优先调整参数，而不是重写逻辑
- 优先复用现有能力（Nitro、Vite），而不是自己实现

#### 4. 禁止的操作
- ❌ 在没对比原始版本前修改 Dockerfile
- ❌ 在没验证 index.mjs 能力前创建包装脚本
- ❌ 在没检查 Nitro 文档前自己实现功能

### 框架能力优先
TanStack Start + Nitro 已提供的能力，**不要重新实现**：
- ✅ 静态资源服务（Nitro 自动处理 `/assets/**`）
- ✅ SSR 渲染
- ✅ 路由处理
- ✅ 中间件

### 具体案例的"正确路径"

**错误路径示例**（实际发生过的）：
```
看到 .output 不存在 → 修改 Dockerfile 复制 dist → 创建 run-server.mjs → ...
```

**正确路径**：
```
1. 对比原始脚手架（若本地有原始脚手架）
   cd <path-to-original-starter>
   pnpm run build
   ls -la .output/  # 发现存在

2. 检查当前版本为什么不同
   git diff vite.config.ts  # 检查配置差异
   pnpm list @tanstack/react-start  # 检查版本

3. 如果版本一致，检查是否是缓存问题
   rm -rf .output dist
   pnpm run build

4. 只有确认原始脚手架也有同样问题时，才考虑修改 Dockerfile
```

### 新文件的门槛
创建新的核心文件（如启动脚本、包装器）前必须证明：
- 现有方案无法解决
- 没有框架内置功能可用
- 已查阅相关文档
- 已在原始脚手架验证

---

## Dokploy 部署规则

### Docker 镜像构建与推送

项目使用 **GHCR (GitHub Container Registry)** 存储 Docker 镜像，Dokploy 从 GHCR 拉取镜像部署。

#### 构建方式优先级

1. **GitHub Actions（推荐）**：推送到 `main` 分支时自动构建
2. **本地构建（备选）**：当 GitHub Actions 不可用时使用

#### 本地构建命令（重要！）

**⚠️ 架构要求**：Dokploy 服务器运行在 **AMD64 (x86_64)** 架构，本地 Mac (Apple Silicon) 是 **ARM64**。

```bash
# ✅ 正确：指定目标平台为 linux/amd64
docker buildx build --platform linux/amd64 \
  -t ghcr.io/foreveryh/oxygenie/app:latest \
  --push .

# ❌ 错误：不指定平台（会构建本机架构 arm64）
docker build -t ghcr.io/foreveryh/oxygenie/app:latest .
docker push ghcr.io/foreveryh/oxygenie/app:latest
```

#### 推送前认证

```bash
# 确保有 write:packages 权限
gh auth refresh -h github.com -s write:packages

# 登录 GHCR
echo $(gh auth token) | docker login ghcr.io -u USERNAME --password-stdin
```

#### 验证镜像架构

```bash
# 拉取并检查架构
docker pull ghcr.io/foreveryh/oxygenie/app:latest
docker inspect ghcr.io/foreveryh/oxygenie/app:latest | jq '.[0].Architecture'
# 应输出: "amd64"
```

### Dokploy 镜像拉取策略

**问题背景**：Docker Compose 默认 `pull_policy: missing`，只在镜像不存在时拉取。导致更新镜像后 Dokploy 仍使用旧的本地缓存。

**解决方案**：在 `docker-compose.dokploy.yml` 中为所有使用应用镜像的服务添加：

```yaml
services:
  app:
    image: *app_image
    pull_policy: always  # 强制每次拉取最新镜像

  migrate:
    image: *app_image
    pull_policy: always

  worker:
    image: *app_image
    pull_policy: always
```

**注意**：多个服务使用同一镜像时，Docker 只会拉取一次，后续服务复用已拉取的镜像。

### 部署检查清单

1. ✅ 确认代码已推送到 GitHub
2. ✅ 确认镜像架构为 `linux/amd64`
3. ✅ 确认 `docker-compose.dokploy.yml` 包含 `pull_policy: always`
4. ✅ 在 Dokploy 触发重新部署
5. ✅ 检查部署日志确认拉取了新镜像（看 digest 是否变化）
