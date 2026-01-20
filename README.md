# Constructa Starter

<div align="center">
  <h2>Claude Agent Chat Application</h2>
  <p>Powered by Claude Agent SDK + Skills Store + Zhipu AI GLM-4.7</p>
</div>

> 🚀 **Claude Desktop-Style Agent Chat** - A full-featured AI agent interface built with Claude Agent SDK and Zhipu AI GLM-4.7, featuring Skills Store, Artifacts, Knowledge Base, and Session Management via WebSocket.

## ✨ Features

### Core Features
- 🤖 **Claude Agent Chat** - Full Claude Desktop replica with Claude Agent SDK integration
- 🛠️ **Skills Store** - Enable/disable custom skills to extend agent capabilities
- 📦 **Artifacts System** - Support for HTML, Markdown, React, and SVG artifacts
- 📚 **Knowledge Base** - Upload and manage documents for context-aware conversations
- 💾 **Session Management** - Create, resume, and switch between multiple chat sessions
- 📊 **Usage Statistics** - Track token usage and cost information
- 🌐 **WebSocket** - Real-time bidirectional communication for complex state management
- 🔧 **Tool Visualization** - See tool calls, arguments, and results in real-time

### Additional Features
- 💬 **Mastra AI Chat** - Simple chat interface using Mastra Agent Framework + SSE
- 🔐 **Authentication** - Better Auth with email/password, OAuth (GitHub, Google)
- 💾 **Database** - PostgreSQL with Docker, Drizzle ORM, migrations
- 🎨 **Beautiful UI** - Built with shadcn/ui components, Tailwind CSS v4, dark mode

## 🚀 Quick Start

### Prerequisites
- Download & Install **[Node.js](https://nodejs.org/en)** 22.12+
- Download & Install **[Docker](https://www.docker.com/)** Desktop
- **pnpm** (recommended package manager)
- **Zhipu AI API Key** - Get from [https://open.bigmodel.cn/](https://open.bigmodel.cn/)

### Installation

```bash
# Clone the repository
git clone https://github.com/foreveryh/constructa-starter.git
cd constructa-starter

# Install dependencies
pnpm install

# Create env file
cp .env.example .env

# Add your Zhipu AI API key to .env
# For Claude Chat (main feature):
# ANTHROPIC_API_KEY="your-zhipuai-api-key"
# ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
# ANTHROPIC_MODEL="glm-4.7"
#
# For Mastra AI Chat (secondary feature):
# ZHIPUAI_API_KEY="your-zhipuai-api-key"

# Start development server
pnpm dev

# Start WebSocket server (required for Claude Chat in all environments)
node ws-server.mjs
```

Open `http://localhost:3000/agents/claude-chat` for the main Claude Agent Chat interface.

**Note**: Claude Chat uses **Zhipu AI GLM-4.7** via their OpenAI-compatible API. The Claude Agent SDK connects to Zhipu AI by setting `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL`.

## Architecture

This project features **two independent chat systems**:

### 1. Claude Chat (Main Feature) `/agents/claude-chat`

**Backend**:
- WebSocket Server (`ws-server.mjs`) - Real-time bidirectional communication
- Claude Agent SDK integration for full agent capabilities
- Worker process isolation for user sandboxing

**Frontend** (`src/routes/agents/claude-chat/route.tsx`):
- Assistant UI components with Claude-style design
- Skills Store for dynamic capability extension
- Artifacts Panel (HTML, Markdown, React, SVG)
- Session List with resume/create/switch
- Knowledge Base Panel for document context
- Usage Card for statistics

**Features**:
- WebSocket-based real-time streaming
- Skills management (enable/disable per user)
- Artifact detection and rendering
- Session persistence and history
- Tool call visualization

### 2. Mastra AI Chat (Secondary) `/agents/ai-chat`

**Backend** (`src/routes/api/chat.tsx`):
- Uses `handleChatStream` from `@mastra/ai-sdk`
- Returns SSE stream via `createUIMessageStreamResponse`
- Agent: `assistant-agent` with file reading capability

**Frontend** (`src/components/ai-sdk-chat.tsx`):
- Uses `useChat` hook from `@ai-sdk/react`
- AI Elements: PromptInput, Actions, Suggestions, Sources, Reasoning

**Features**:
- SSE-based streaming
- Simple chat interface
- File reading from S3/MinIO

## Tech Stack

### Claude Chat (Main)
- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)** - Agent orchestration
- **[Zhipu AI GLM-4.7](https://open.bigmodel.cn/)** - LLM model via OpenAI-compatible API
- **[Assistant UI](https://assistant-ui.com)** - React components for AI chat
- **[WebSocket](https://github.com/websockets/ws)** - Real-time communication
- **[TanStack Start](https://tanstack.com/start)** - Full-stack React framework
- **[Zustand](https://zustand-demo.pmnd.rs)** - State management

### Mastra Chat (Secondary)
- **[Mastra](https://mastra.ai)** - AI Agent Framework (v1.0.0-beta.19)
- **[Zhipu AI GLM-4.7](https://open.bigmodel.cn/)** - LLM model via Mastra's model gateway
- **[Vercel AI SDK](https://sdk.vercel.ai)** - `@ai-sdk/react` with `useChat` hook

### Shared
- **[TanStack Router](https://tanstack.com/router)** - Type-safe file-based routing
- **[shadcn/ui](https://ui.shadcn.com/)** - Beautiful component library
- **[Tailwind CSS v4](https://tailwindcss.com/)** - Modern utility-first CSS
- **[TypeScript](https://typescriptlang.org/)** - Full type safety
- **[Better Auth](https://better-auth.com/)** - Authentication
- **[Drizzle ORM](https://orm.drizzle.team/)** - PostgreSQL ORM

## 📁 Project Structure

```
constructa-starter/
├── src/
│   ├── components/
│   │   ├── claude-chat/       # Claude Chat UI components
│   │   │   ├── artifacts-panel.tsx
│   │   │   ├── session-list.tsx
│   │   │   ├── skills-manager-panel.tsx
│   │   │   ├── knowledge-base-panel.tsx
│   │   │   └── ...
│   │   ├── ai-elements/       # Vercel AI SDK UI components (Mastra)
│   │   └── ui/                # shadcn/ui components
│   ├── lib/
│   │   ├── claude-agent-ws-adapter.ts  # WebSocket adapter
│   │   ├── skills-store.ts            # Skills state management
│   │   └── stores/                    # Various Zustand stores
│   ├── routes/
│   │   ├── agents/
│   │   │   ├── claude-chat/  # Claude Chat route (main)
│   │   │   └── ai-chat/      # Mastra AI Chat route (secondary)
│   │   └── api/
│   │       ├── chat.tsx       # Mastra chat API (SSE)
│   │       └── skills/       # Skills API endpoints
│   └── db/                    # Database schema
├── ws-server.mjs              # WebSocket server (Claude Chat)
├── ws-query-worker.mjs        # Worker process
└── CLAUDE.md                  # Development notes
```

## 🔌 Routes

| Route | Description | Type |
|-------|-------------|------|
| `/agents/claude-chat` | **Main** - Claude Agent Chat with full features | WebSocket |
| `/agents/ai-chat` | Secondary - Mastra-powered simple chat | SSE |
| `/agents/skills` | Skills Store management page | - |
| `/api/chat` | Mastra chat API endpoint | POST, SSE |
| `/api/skills/*` | Skills API endpoints | REST |

## 🔧 Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/constructa"

# Claude Agent Chat (Main Feature) - Uses Zhipu AI GLM-4.7
# The Claude Agent SDK connects to Zhipu AI via their OpenAI-compatible API
ANTHROPIC_API_KEY="your-zhipuai-api-key"
ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
ANTHROPIC_MODEL="glm-4.7"

# Mastra AI Chat (Secondary Feature) - Also uses Zhipu AI GLM-4.7
ZHIPUAI_API_KEY="your-zhipuai-api-key"

# Better Auth
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"

# OAuth Providers (optional)
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

### Model Configuration

Both chat systems use **Zhipu AI GLM-4.7**:

**Claude Chat**:
- Uses Claude Agent SDK with `ANTHROPIC_BASE_URL` pointing to Zhipu AI
- OpenAI-compatible API format: `https://open.bigmodel.cn/api/paas/v4`
- Model: `glm-4.7`

**Mastra AI Chat**:
- Uses Mastra Agent Framework with built-in Zhipu AI integration
- Model gateway automatically routes to `zhipuai/glm-4.7`

## Skills Store

The Skills Store allows users to extend the Claude Agent's capabilities by enabling/disabling custom skills:

- **Available Skills**: Browse and discover available skills
- **User Skills**: Enable/disable skills per user
- **Dynamic Loading**: Skills are dynamically loaded into the agent
- **API Endpoints**:
  - `GET /api/skills/store` - List available skills
  - `GET /api/skills/user/:id` - Get user's enabled skills
  - `POST /api/skills/user/:id/enable/:skill` - Enable a skill
  - `DELETE /api/skills/user/:id/disable/:skill` - Disable a skill

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Links

- **GitHub**: https://github.com/foreveryh/constructa-starter
- **Claude Agent SDK**: https://github.com/anthropics/claude-agent-kit
- **Mastra Docs**: https://mastra.ai
- **Assistant UI**: https://assistant-ui.com

## References

This project is based on:
- [constructa-starter](https://github.com/instructa/constructa-starter) by instructa.ai
- [claude-agent-kit](https://github.com/anthropics/claude-agent-kit) - Reference implementation
- [ui-dojo](https://github.com/mastrajs/ui-dojo) - Mastra + Vercel AI SDK reference
