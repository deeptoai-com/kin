# OxyGenie

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

OxyGenie 是一个**面向中小团队的可扩展企业级 AI Agent 平台**。它替代通用型 GPT 产品（ChatGPT、豆包、DeepSeek），提供 Skills Store、MCP 集成、Artifacts 生成和 Python 代码执行等高级能力 - 支持私有化部署，兼容 GLM 5.0 等性价比高的模型。

基于 Claude Agent SDK 和 TanStack Start 构建，OxyGenie 提供 Web 优先的 AI 工具替代方案，具备一键式 Skills 和 MCP 集成、实时流式传输、会话持久化，以及美观流畅的 UI。

**核心差异化**：
- 🎯 **企业就绪**：私有化部署、数据安全、团队协作
- 🔌 **一键式 Skills & MCP**：即时扩展能力，无需复杂配置
- 🎨 **Artifacts 系统**：生成网页、文档和可视化内容
- 🐍 **Python 代码执行**：完整的沙盒代码执行环境
- 💰 **性价比模型**：支持 GLM 5.0 等经济实惠的模型
- 🚀 **生产就绪**：基于现代全栈原则，SSR、类型安全路由

## ✨ 功能特性

### 核心能力

- **🎯 Skills Store & MCP 集成**：一键启用/禁用自定义技能和 MCP 服务器，动态扩展 Agent 能力 - 参考 craft-agents 桌面版
- **🎨 Artifacts 系统**：生成和预览网页、文档（HTML、Markdown、React、SVG），支持实时编辑
- **🐍 Python 代码执行**：完整的沙盒 Python 执行环境，用于代码生成、数据分析和自动化
- **🏢 私有化部署**：在自有基础设施中部署，保障数据安全和合规性
- **💰 多模型支持**：支持 GLM 5.0 等性价比高的模型，以及 Claude 和其他提供商

### 企业功能

- **👥 团队协作**：多用户支持，会话管理，知识库共享
- **📚 知识库**：上传和管理文档，实现上下文感知对话
- **💾 会话管理**：创建、恢复和切换多个聊天会话，完整持久化
- **🔐 身份认证**：Better Auth，支持邮箱/密码、OAuth (GitHub, Google)
- **📊 使用统计**：按用户/会话监控 token 使用和成本

### 技术特性

- **🌐 多语言 (i18n)**：内置 Intlayer 国际化，支持英文、简体中文、繁体中文等
- **⚡ 实时流式传输**：基于 WebSocket 的双向通信，用于复杂状态管理
- **🔧 工具可视化**：实时查看工具调用、参数和结果
- **🎨 美观 UI**：基于 shadcn/ui 组件，Tailwind CSS v4，支持暗色模式
- **🔄 Mastra AI Chat**：使用 Mastra Agent Framework + SSE 的替代聊天界面

## 🚀 快速开始

1. **克隆并安装:**
   ```bash
   git clone https://github.com/foreveryh/oxygenie.git
   cd OxyGenie
   pnpm install
   ```

2. **配置环境变量:**
   ```bash
   cp .env.example .env
   ```
   
   **最小必填环境变量:**
   ```bash
   # 数据库
   DATABASE_URL="postgresql://user:password@localhost:5432/oxygenie"
   
   # Claude Agent SDK（主聊天功能必需）
   ANTHROPIC_API_KEY="sk-ant-..."
   
   # Better Auth（身份认证必需）
   BETTER_AUTH_SECRET="your-secret-key-here"
   BETTER_AUTH_URL="http://localhost:3000"
   ```
   
   查看 [.env.example](.env.example) 了解所有可用配置选项。

3. **设置数据库:**
   ```bash
   pnpm db:migrate
   ```

4. **启动应用:**
   ```bash
   # 终端 1: 启动主应用
   pnpm dev
   
   # 终端 2: 启动 WebSocket 服务器（Claude Chat 必需）
   node ws-server.mjs
   ```

5. **打开应用:**
   访问 `http://localhost:3000/agents/c` 进入主 Claude Agent Chat 界面。

## 为什么选择 OxyGenie？

### vs. 通用 GPT 产品（ChatGPT、豆包、DeepSeek）

| 功能 | 通用 GPT 产品 | OxyGenie |
|------|-------------|----------|
| **部署方式** | 仅云端，SaaS | ✅ 私有化，自托管 |
| **数据安全** | 数据发送给第三方 | ✅ 数据保留在自有基础设施 |
| **Skills & MCP** | 有限或没有 | ✅ 一键式 Skills Store & MCP 集成 |
| **Artifacts** | 基础文本输出 | ✅ 丰富的 Artifacts：网页、文档、可视化 |
| **代码执行** | 有限或没有 | ✅ 完整的 Python 沙盒执行 |
| **模型选择** | 固定模型 | ✅ 支持 GLM 5.0 等性价比高的模型 |
| **团队功能** | 有限的协作 | ✅ 多用户、知识库、会话共享 |
| **定制化** | 固定功能 | ✅ 通过 Skills 和 MCP 可扩展 |

### vs. 桌面 AI 工具（Claude Desktop、craft-agents）

| 功能 | 桌面工具 | OxyGenie |
|------|---------|----------|
| **平台** | 桌面应用 | ✅ Web 应用，跨平台 |
| **部署** | 本地安装 | ✅ 服务器部署，团队访问 |
| **访问** | 单设备 | ✅ 任何带浏览器的设备 |
| **Skills & MCP** | ✅ 支持 | ✅ 支持（一键式） |
| **Artifacts** | ✅ 支持 | ✅ 支持（Web 优化） |

## Web 应用功能

### Skills Store & MCP 集成

- **一键启用**：通过 UI 即时启用/禁用技能和 MCP 服务器
- **动态加载**：技能动态加载到 Agent 会话中，无需重启
- **技能发现**：浏览和发现商店中的可用技能
- **MCP 支持**：完整的 Model Context Protocol 集成，扩展能力
- **用户级控制**：按用户或团队启用/禁用技能

### Artifacts 系统

- **网页生成**：生成完整的 HTML 页面，带实时预览
- **文档创建**：创建 Markdown、HTML 和格式化文档
- **可视化**：生成 React 组件、SVG 图形和图表
- **实时预览**：生成 Artifacts 的实时预览和编辑
- **Artifacts 面板**：用于查看和管理所有 Artifacts 的专用面板

### 实时预览与分享（沙盒）

多文件 Web 应用（HTML 引用相对路径的 JS/CSS）会在**每会话独立的沙盒容器**里运行，并通过专属子域名（`<preview-id>.<域名>`）对外提供，因此脚本、`localStorage`、表单都能真正生效——区别于单文件内联 blob 预览。

- **按需启动，非常驻**：点「运行预览」时才起沙盒,**不保活**。
- **空闲销毁时机（关键）**：运行中的预览在**空闲满 5 分钟**后被回收（`PREVIEW_IDLE_TIMEOUT_MS`，默认 `300000`）。计时基准是**对预览的每一次 HTTP 请求**，回收器每 **30 秒**扫一次,所以实际销毁发生在**最后一次访问后约 5~5.5 分钟**。⚠️「标签页开着」≠「在访问」：静态 SPA 加载后就不再发请求，开着但闲置的标签页同样会被回收；只有刷新 / 产生新请求才会续命。
- **容量上限**：同时最多 **4 个**活跃预览（`MAX_ACTIVE_PREVIEWS`）。开第 5 个**不会挤掉旧的**，而是返回「容量已满，等某个空闲回收后再试」。
- **其他销毁触发**：手动停止（`stop_preview`）；以及任何 app / 栈重启或重部署（内存中的预览状态丢失）。
- **分享 = 公开链接**：点「分享」会复制一个无 token 的 `https://<preview-id>.<域名>/` 链接，并把该预览标记为 **public**——绕过逐浏览器的鉴权闸（任何人都能打开），且在分享期间**钉住常驻（不再被空闲回收）**，直到手动停止或栈重启。对外访问需要**可公网解析**的预览域名（如 `*.oxygenie.cc`）；仅本机解析的域名（如 `*.oxygenie.local`）只在配置它的那台机器上有效。

### Python 代码执行

- **沙盒环境**：每个会话的安全、隔离 Python 执行
- **完整 Python 支持**：访问标准库和常用包
- **实时输出**：实时查看代码执行结果
- **错误处理**：清晰的错误消息和调试支持
- **会话持久化**：代码执行状态在会话间持久化

### 会话管理

- **会话列表**：查看和管理所有聊天会话
- **会话恢复**：无缝继续之前的对话
- **会话切换**：在多个活动会话之间切换
- **会话命名**：AI 生成的标题或手动命名
- **会话持久化**：完整的对话历史保存到数据库

### 知识库

- **文档上传**：上传文档（PDF、Markdown、文本文件）到知识库
- **上下文感知**：文档自动包含在对话上下文中
- **文档管理**：组织和管理知识库文档
- **团队共享**：在团队成员间共享知识库文档

### 实时通信

- **WebSocket 流式传输**：实时双向通信，用于复杂状态管理
- **工具可视化**：实时查看工具调用、参数和结果
- **使用统计**：按用户/会话追踪 token 使用和成本信息

## 架构

本项目包含**两个独立的聊天系统**：

### 1. Claude Chat（主要功能）`/agents/c`

**后端**:
- WebSocket 服务器 (`ws-server.mjs`) - 实时双向通信
- Claude Agent SDK 集成，提供完整的 Agent 能力
- Worker 进程隔离，实现用户沙盒

**前端**:
- Assistant UI 组件，Claude 风格设计
- Skills Store 用于动态能力扩展
- Artifacts 面板（HTML、Markdown、React、SVG）
- 会话列表，支持恢复/创建/切换
- 知识库面板，用于文档上下文
- 使用统计卡片

**特性**:
- 基于 WebSocket 的实时流式传输
- 技能管理（按用户启用/禁用）
- Artifact 检测和渲染
- 会话持久化和历史记录
- 工具调用可视化

### 2. Mastra AI Chat（次要功能）`/agents/ai-chat`

**后端**:
- 使用 `@mastra/ai-sdk` 的 `handleChatStream`
- 通过 `createUIMessageStreamResponse` 返回 SSE 流
- Agent: `assistant-agent`，具备文件读取能力

**前端**:
- 使用 `@ai-sdk/react` 的 `useChat` hook
- AI Elements: PromptInput、Actions、Suggestions、Sources、Reasoning

**特性**:
- 基于 SSE 的流式传输
- 简洁的聊天界面
- 从 S3/MinIO 读取文件

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Node.js 22.12+ |
| **AI（主要）** | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - Claude 模型 |
| **AI（替代）** | [Mastra](https://mastra.ai) - GLM 5.0、GLM 4.6 等性价比高的模型 |
| **框架** | [TanStack Start](https://tanstack.com/start) - 全栈 React 框架 |
| **路由** | [TanStack Router](https://tanstack.com/router) - 类型安全的文件路由 |
| **UI** | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4 |
| **实时通信** | [WebSocket](https://github.com/websockets/ws) |
| **数据库** | PostgreSQL + [Drizzle ORM](https://orm.drizzle.team/) |
| **认证** | [Better Auth](https://better-auth.com/) |
| **状态管理** | [Zustand](https://zustand-demo.pmnd.rs) |
| **构建** | Vite + Nitro |

## 配置

### 环境变量

**必填:**
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/oxygenie"
ANTHROPIC_API_KEY="sk-ant-..."
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"
```

**可选:**
```bash
# WebSocket URL（生产环境反向代理时使用）
VITE_WS_URL="wss://your-domain.com/ws/agent"

# 多模型支持（性价比高的模型）
# 通过 Mastra 使用 GLM 5.0 等模型
ZHIPU_API_KEY="your-zhipu-api-key"  # 用于 GLM 5.0、GLM 4.6、GLM 4.5

# OAuth 提供商
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

查看 [.env.example](.env.example) 了解完整配置选项。

### 多模型支持

OxyGenie 支持多种 AI 模型以优化成本：

**Claude 模型**（通过 Claude Agent SDK）：
- Claude 3.5 Sonnet
- Claude 3 Opus
- Claude 3 Haiku

**GLM 模型**（通过 Mastra，性价比高）：
- GLM 5.0（205K 上下文）
- GLM 4.6（205K 上下文）
- GLM 4.5（131K 上下文）
- GLM 4 Air/Flash（轻量版本）

**配置**：
- Claude 模型：在 `.env` 中设置 `ANTHROPIC_API_KEY`
- GLM 模型：在 `.env` 中设置 `ZHIPU_API_KEY`，在 Mastra agents 中使用 `zhipuai/glm-5.0`

### 私有化部署

OxyGenie 专为私有化部署设计，让您完全控制数据：

**优势**：
- ✅ **数据安全**：所有数据保留在自有基础设施中
- ✅ **合规性**：满足企业安全和隐私要求
- ✅ **成本控制**：使用 GLM 5.0 等性价比高的模型
- ✅ **定制化**：完全控制 Skills、MCP 服务器和配置

**部署选项**：
- Docker Compose（推荐小团队使用）
- Kubernetes（适用于大型部署）
- 传统服务器部署

详细的部署说明，请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

```bash
# 启动开发服务器
pnpm dev

# 启动 WebSocket 服务器（Claude Chat 必需）
node ws-server.mjs

# 运行数据库迁移
pnpm db:migrate

# 质量检查（提交前运行）
pnpm typecheck        # TypeScript 类型检查
pnpm lint            # 代码检查
pnpm validate-routes  # TanStack Start 路由验证
pnpm test            # 运行测试
```

详细的开发指南，请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## CI/CD

本项目使用 GitHub Actions 进行持续集成。CI 流水线在每次推送和拉取请求时运行，检查：

- ✅ **类型检查** (`pnpm typecheck`)
- ✅ **代码检查** (`pnpm lint`)
- ✅ **路由验证** (`pnpm validate-routes`)
- ✅ **测试** (`pnpm test`)

完整的 CI 配置，请查看 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

## 路由

| 路由 | 描述 | 类型 |
|------|------|------|
| `/agents/c` | **主要** - 功能完整的 Claude Agent Chat | WebSocket |
| `/agents/ai-chat` | 次要 - Mastra 驱动的简单聊天 | SSE |
| `/agents/skills` | Skills Store 管理页面 | - |
| `/api/chat` | Mastra 聊天 API 端点 | POST, SSE |
| `/api/skills/*` | Skills API 端点 | REST |

## 📄 许可

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

### 第三方许可

本项目使用 [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)，受 [Anthropic 商业服务条款](https://www.anthropic.com/legal/commercial-terms) 约束。

其他关键依赖：
- **Better Auth** - 身份认证库
- **Mastra** - AI Agent 框架
- **TanStack Start** - 全栈 React 框架
- **Drizzle ORM** - PostgreSQL ORM

完整第三方许可信息，请查看 [NOTICE](NOTICE)。

## 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

## 安全

报告安全漏洞，请查看 [SECURITY.md](SECURITY.md)。

## 链接

- **GitHub**: https://github.com/foreveryh/oxygenie
- **Claude Agent SDK**: https://github.com/anthropics/claude-agent-sdk
- **Mastra 文档**: https://mastra.ai
- **Assistant UI**: https://assistant-ui.com
- **TanStack Start**: https://tanstack.com/start
