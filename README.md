# OxyGenie

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

OxyGenie is an **extensible, enterprise-ready AI agent platform for small and medium teams**. It replaces generic GPT products (ChatGPT, 豆包, DeepSeek) with advanced capabilities like Skills Store, MCP integration, Artifacts generation, and Python code execution - all deployable on-premises with support for cost-effective models like GLM 5.0.

Built with Claude Agent SDK and TanStack Start, OxyGenie provides a web-first alternative to desktop AI tools, featuring one-click Skills and MCP integration, real-time streaming, session persistence, and a beautiful, fluid UI.

**Key Differentiators**:
- 🎯 **Enterprise-Ready**: On-premises deployment, data security, team collaboration
- 🔌 **One-Click Skills & MCP**: Extend capabilities instantly, no complex setup
- 🎨 **Artifacts System**: Generate web pages, documents, and visualizations
- 🐍 **Python Code Execution**: Full sandboxed code execution environment
- 💰 **Cost-Effective Models**: Support for GLM 5.0 and other affordable models
- 🚀 **Production-Ready**: Built with modern full-stack principles, SSR, type-safe routing

## Features

### Core Capabilities

- **🎯 Skills Store & MCP Integration**: One-click enable/disable of custom skills and MCP servers to extend agent capabilities dynamically - inspired by craft-agents desktop
- **🎨 Artifacts System**: Generate and preview web pages, documents (HTML, Markdown, React, SVG) with live editing capabilities
- **🐍 Python Code Execution**: Full sandboxed Python execution environment for code generation, data analysis, and automation
- **🏢 On-Premises Deployment**: Deploy in your own infrastructure for data security and compliance
- **💰 Multi-Model Support**: Support for cost-effective models like GLM 5.0, in addition to Claude and other providers

### Enterprise Features

- **👥 Team Collaboration**: Multi-user support with session management, knowledge base sharing
- **📚 Knowledge Base**: Upload and manage documents for context-aware conversations
- **💾 Session Management**: Create, resume, and switch between multiple chat sessions with full persistence
- **🔐 Authentication**: Better Auth with email/password, OAuth (GitHub, Google)
- **📊 Usage Tracking**: Monitor token usage and costs per user/session

### Technical Features

- **🌐 Multi-language (i18n)**: Built-in internationalization with Intlayer (EN, 简体中文, 繁體中文, and more)
- **⚡ Real-time Streaming**: WebSocket-based bidirectional communication for complex state management
- **🔧 Tool Visualization**: See tool calls, arguments, and results in real-time
- **🎨 Beautiful UI**: Built with shadcn/ui components, Tailwind CSS v4, dark mode
- **🔄 Mastra AI Chat**: Alternative chat interface using Mastra Agent Framework + SSE

## Installation

### Build from Source

```bash
git clone https://github.com/foreveryh/oxygenie.git
cd OxyGenie
pnpm install
```

## Quick Start

**The fastest way to run OxyGenie is with Docker Compose.** The project provides `docker-compose.yml` and `.env.docker` for one-command setup.

### Option A: Docker Compose (recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/foreveryh/oxygenie.git
   cd OxyGenie
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set the **minimum required** variables. [.env.docker](.env.docker) provides `POSTGRES_*` and Docker overrides; migrate/app/worker build `DATABASE_URL` from `POSTGRES_*` with host `db`, so you only need to add secrets and optional keys in `.env`:

   ```bash
   # MinIO (S3-compatible storage)
   MINIO_ROOT_USER="minioadmin"
   MINIO_ROOT_PASSWORD="minioadmin"
   MINIO_BUCKET="oxygenie-files"

   # Meilisearch
   MEILI_MASTER_KEY="changeme-master-key"

   # Auth (use http://localhost:5050 when using Docker; app is on 5050)
   BETTER_AUTH_SECRET="your-secret-key-here"
   BETTER_AUTH_URL="http://localhost:5050"

   # AI (required for Claude Chat and Mastra)
   ANTHROPIC_API_KEY="sk-ant-..."
   ZHIPU_API_KEY="your-zhipu-api-key"   # Optional for Mastra/GLM models
   ```

   See [.env.example](.env.example) for all options. [.env.docker](.env.docker) overrides `.env` with Docker-specific values (`POSTGRES_*`, container hostnames, `VITE_WS_URL`, etc.). Docker builds `DATABASE_URL` from `POSTGRES_*` with host `db` — **do not** set `DATABASE_URL` in `.env` when using Docker, or migrate will try to connect to localhost and fail. **Never commit `.env`.**

   **Troubleshooting:** If you see `database "oxygenie" does not exist`, the stack runs a `create-db` step that creates it when missing (e.g. old volumes from ex0/constructa). If it still fails, run `docker compose --profile selfhost down -v` then `up -d --build` again to reset volumes.

   **Keeping existing database data:** If you already have data in `ex0` or `constructa`, **do not** run `down -v`. In `.env`, set **only** `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` to match your **existing** DB (e.g. `POSTGRES_DB=ex0` — same user/pass as when the volume was created). **Do not** set `DATABASE_URL` in `.env` for Docker; it is built from `POSTGRES_*` with host `db`. Use the env order below so `.env` overrides `.env.docker`. The `create-db` step will see the DB exists and skip; migrations run against your existing DB and your data is preserved.

3. **Start with Docker Compose:**
   ```bash
   docker compose --env-file .env.docker --env-file .env --profile selfhost up -d --build
   ```
   `.env` is loaded **last** and overrides `.env.docker` (use this to keep an existing DB). This starts PostgreSQL, MinIO, Redis, Meilisearch, runs migrations, then the app and worker. The app is served on **port 5050**, WebSocket on **3051**.

4. **Open the app:**
   - **App:** http://localhost:5050  
   - **Claude Agent Chat:** http://localhost:5050/agents/c  

   **Verify:** `curl -s http://localhost:5050/health` → `{"status":"ok"}`  
   **Logs:** `docker compose --profile selfhost logs -f app`

### Option B: Local development (without Docker)

1. **Clone and install:**
   ```bash
   git clone https://github.com/foreveryh/oxygenie.git
   cd OxyGenie
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   Set at least:
   ```bash
   DATABASE_URL="postgresql://user:password@localhost:5432/oxygenie"
   ANTHROPIC_API_KEY="sk-ant-..."
   BETTER_AUTH_SECRET="your-secret-key-here"
   BETTER_AUTH_URL="http://localhost:3000"
   ```
   See [.env.example](.env.example) for all options.

3. **Set up the database:**
   ```bash
   pnpm db:migrate
   ```

4. **Start the application:**
   ```bash
   # Terminal 1: main app
   pnpm dev

   # Terminal 2: WebSocket server (required for Claude Chat)
   node ws-server.mjs
   ```

5. **Open the app:**  
   http://localhost:3000/agents/c

### Option C: One-command hybrid dev (recommended for local) ⭐

Runs the **dependency services in Docker** (Postgres, Redis, MinIO, Meilisearch) and the
**app as a local Node process** (Nitro :3000 + WebSocket :3001). This is the fastest way
to a running app and is the recipe verified end-to-end (see `docs/project/WORKLOG.md`).

```bash
# One-time setup
cp .env.example .env            # then edit .env (see the LOCAL values below)
cp .env.docker.example .env.docker

# Bring everything up: deps → migrate → build → start
./scripts/dev-up.sh             # http://localhost:3000

# Faster iterations (reuse the existing build):
./scripts/dev-up.sh --no-build

# Only start deps + run migrations (then run the app yourself):
./scripts/dev-up.sh --deps-only

# Tear down the dependency containers:
./scripts/dev-down.sh
```

**Required LOCAL `.env` values** (these differ from the Docker port-mapping defaults):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/oxygenie"
BETTER_AUTH_URL="http://localhost:3000"      # must match the local port, NOT :5050
VITE_BASE_URL="http://localhost:3000"
VITE_WS_URL="ws://localhost:3001/ws/agent"   # WebSocket server runs on :3001
ENABLE_EXEC_SANDBOX="0"                        # macOS dev (srt Seatbelt breaks python); Linux prod uses 1
ANTHROPIC_BASE_URL="https://ark.cn-beijing.volces.com/api/coding"  # or your Anthropic-compatible gateway
ANTHROPIC_MODEL="ark-code-latest"
```

> Note: the app runs as a **local Node process**, so only the 4 dependency containers
> appear in Docker/OrbStack — that's expected for hybrid mode.

## Why OxyGenie?

### vs. Generic GPT Products (ChatGPT, 豆包, DeepSeek)

| Feature | Generic GPT Products | OxyGenie |
|---------|---------------------|----------|
| **Deployment** | Cloud-only, SaaS | ✅ On-premises, self-hosted |
| **Data Security** | Data sent to third-party | ✅ Your data stays in your infrastructure |
| **Skills & MCP** | Limited or none | ✅ One-click Skills Store & MCP integration |
| **Artifacts** | Basic text output | ✅ Rich Artifacts: web pages, documents, visualizations |
| **Code Execution** | Limited or none | ✅ Full Python sandbox execution |
| **Model Choice** | Fixed models | ✅ Support for GLM 5.0 and other cost-effective models |
| **Team Features** | Limited collaboration | ✅ Multi-user, knowledge base, session sharing |
| **Customization** | Fixed features | ✅ Extensible with Skills and MCP |

### vs. Desktop AI Tools (Claude Desktop, craft-agents)

| Feature | Desktop Tools | OxyGenie |
|---------|--------------|----------|
| **Platform** | Desktop app | ✅ Web app, cross-platform |
| **Deployment** | Local installation | ✅ Server deployment, team access |
| **Access** | Single device | ✅ Any device with browser |
| **Skills & MCP** | ✅ Supported | ✅ Supported (one-click) |
| **Artifacts** | ✅ Supported | ✅ Supported (web-optimized) |

## Web App Features

### Skills Store & MCP Integration

- **One-Click Enable**: Enable/disable skills and MCP servers instantly through the UI
- **Dynamic Loading**: Skills are dynamically loaded into agent sessions without restart
- **Skill Discovery**: Browse and discover available skills from the store
- **MCP Support**: Full Model Context Protocol integration for extended capabilities
- **User-Level Control**: Enable/disable skills per user or team

### Artifacts System

- **Web Page Generation**: Generate complete HTML pages with live preview
- **Document Creation**: Create Markdown, HTML, and formatted documents
- **Visualizations**: Generate React components, SVG graphics, and charts
- **Live Preview**: Real-time preview and editing of generated artifacts
- **Artifact Panel**: Dedicated panel for viewing and managing all artifacts

### Live Preview & Sharing (Sandbox)

Multi-file web apps (HTML that references relative JS/CSS siblings) run in a **per-session sandbox container** served on a dedicated subdomain (`<preview-id>.<domain>`), so scripts, `localStorage`, and forms work for real — unlike the inline single-file blob preview.

- **On-demand, not always-on**: a sandbox starts when you click **Run Preview (运行预览)**; it is never kept warm.
- **Idle lifecycle — when it gets destroyed**: a running preview is reaped after **5 minutes of inactivity** (`PREVIEW_IDLE_TIMEOUT_MS`, default `300000`). The idle clock resets on **every HTTP request to the preview**, and the reaper scans every **30 s**, so actual teardown is ~5–5.5 min after the *last* request. ⚠️ An open-but-idle tab does **not** keep it alive — a static SPA stops making requests after it loads; only refreshes / new requests extend it.
- **Capacity cap**: at most **4** active previews at once (`MAX_ACTIVE_PREVIEWS`). Starting a 5th does **not** evict an older one — it returns "capacity reached, try again after one goes idle".
- **Other teardown triggers**: manual stop (`stop_preview`), and any app/stack restart or redeploy (in-memory preview state is lost).
- **Share = public link**: **Share (分享)** copies a token-free `https://<preview-id>.<domain>/` link and marks the preview **public** — it bypasses the per-browser auth gate (so anyone can open it) and is **pinned alive (no idle reap)** while shared, until manually stopped or the stack restarts. External access requires a **publicly-resolvable** preview domain (e.g. `*.oxygenie.cc`); a local-only domain (e.g. `*.oxygenie.local`) resolves only on the host that configured it.

### Python Code Execution

- **Sandboxed Environment**: Secure, isolated Python execution per session
- **Full Python Support**: Access to standard library and common packages
- **Real-time Output**: See code execution results in real-time
- **Error Handling**: Clear error messages and debugging support
- **Session Persistence**: Code execution state persists across sessions

### Session Management

- **Session List**: View and manage all your chat sessions
- **Session Resume**: Continue previous conversations seamlessly
- **Session Switching**: Switch between multiple active sessions
- **Session Naming**: AI-generated titles or manual naming
- **Session Persistence**: Full conversation history saved to database

### Knowledge Base

- **Document Upload**: Upload documents (PDF, Markdown, text files) to your knowledge base
- **Context-Aware**: Documents are automatically included in conversation context
- **Document Management**: Organize and manage your knowledge base documents
- **Team Sharing**: Share knowledge base documents across team members

### Real-time Communication

- **WebSocket Streaming**: Real-time bidirectional communication for complex state management
- **Tool Visualization**: See tool calls, arguments, and results in real-time
- **Usage Statistics**: Track token usage and cost information per user/session

## Architecture

This project features **two independent chat systems**:

### 1. Claude Chat (Main Feature) `/agents/c`

**Backend**:
- WebSocket Server (`ws-server.mjs`) - Real-time bidirectional communication
- Claude Agent SDK integration for full agent capabilities
- Worker process isolation for user sandboxing

**Frontend**:
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

**Backend**:
- Uses `handleChatStream` from `@mastra/ai-sdk`
- Returns SSE stream via `createUIMessageStreamResponse`
- Agent: `assistant-agent` with file reading capability

**Frontend**:
- Uses `useChat` hook from `@ai-sdk/react`
- AI Elements: PromptInput, Actions, Suggestions, Sources, Reasoning

**Features**:
- SSE-based streaming
- Simple chat interface
- File reading from S3/MinIO

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 22.12+ |
| **AI (Primary)** | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - Claude models |
| **AI (Alternative)** | [Mastra](https://mastra.ai) - GLM 5.0, GLM 4.6, and other cost-effective models |
| **Framework** | [TanStack Start](https://tanstack.com/start) - Full-stack React framework |
| **Routing** | [TanStack Router](https://tanstack.com/router) - Type-safe file-based routing |
| **UI** | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4 |
| **Real-time** | [WebSocket](https://github.com/websockets/ws) |
| **Database** | PostgreSQL + [Drizzle ORM](https://orm.drizzle.team/) |
| **Auth** | [Better Auth](https://better-auth.com/) |
| **State** | [Zustand](https://zustand-demo.pmnd.rs) |
| **Build** | Vite + Nitro |

## Configuration

### Environment Variables

**Required (local dev):**
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/oxygenie"
ANTHROPIC_API_KEY="sk-ant-..."
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"
```

**Required for Docker (see [Quick Start → Option A](#option-a-docker-compose-recommended)):**  
Use `.env` plus [.env.docker](.env.docker). Set `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, `MINIO_*`, `MEILI_MASTER_KEY`, `BETTER_AUTH_*`, `ANTHROPIC_API_KEY`, `ZHIPU_API_KEY`. Ensure they match [.env.docker](.env.docker) (e.g. DB `oxygenie`, bucket `oxygenie-files`).

**Optional:**
```bash
# WebSocket URL — local dev: not needed; Docker: .env.docker sets ws://localhost:3051/ws/agent
VITE_WS_URL="wss://your-domain.com/ws/agent"

# Multi-Model Support (GLM 5.0, etc. via Mastra)
ZHIPU_API_KEY="your-zhipu-api-key"

# OAuth Providers
GITHUB_CLIENT_ID="..." GITHUB_CLIENT_SECRET="..."
GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..."
```

See [.env.example](.env.example) for all options. **Never commit `.env`.** [.env.docker](.env.docker) is versioned and overrides Docker-specific values.

### Multi-Model Support

OxyGenie supports multiple AI models for cost optimization:

**Claude Models** (via Claude Agent SDK):
- Claude 3.5 Sonnet
- Claude 3 Opus
- Claude 3 Haiku

**GLM Models** (via Mastra, cost-effective):
- GLM 5.0 (205K context)
- GLM 4.6 (205K context)
- GLM 4.5 (131K context)
- GLM 4 Air/Flash (lightweight versions)

**Configuration**:
- Claude models: Set `ANTHROPIC_API_KEY` in `.env`
- GLM models: Set `ZHIPU_API_KEY` in `.env`, use `zhipuai/glm-5.0` in Mastra agents

### On-Premises Deployment

OxyGenie is designed for on-premises deployment, giving you full control over your data:

**Benefits**:
- ✅ **Data Security**: All data stays in your infrastructure
- ✅ **Compliance**: Meet enterprise security and privacy requirements
- ✅ **Cost Control**: Use cost-effective models like GLM 5.0
- ✅ **Customization**: Full control over Skills, MCP servers, and configurations

**Deployment Options**:
- **Docker Compose** (recommended): See [Quick Start → Option A: Docker Compose](#option-a-docker-compose-recommended) and [docker-compose.yml](docker-compose.yml). Use `.env` + [.env.docker](.env.docker) with `--profile selfhost`.
- **Kubernetes**: For larger deployments (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **Traditional server**: Run `pnpm build`, `node .output/server/index.mjs`, and `node ws-server.mjs` behind a reverse proxy.

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed deployment instructions.

### Sizing & Concurrency

OxyGenie runs each chat turn in an isolated Claude Agent SDK worker process (per-message
spawn, sandboxed). What consumes resources is the number of **simultaneously executing**
workers (~150–300 MB each), not the number of open sessions — most sessions sit idle or
await the model.

| | Status |
|---|---|
| **Today** | Runs well for individuals / small teams on a single host. ⚠️ **No built-in concurrency cap yet** — a burst of many simultaneous active workers can exhaust RAM (OOM risk under heavy load). |
| **Target (in progress)** | A single **16 GB / 8-core** VPS sustaining **~50 concurrent sessions**, via a bounded worker pool (≈ cores in parallel, the rest queued), per-worker memory/CPU caps, idle reaping, and WebSocket backpressure. See [ROADMAP](docs/project/ROADMAP.md) Phase 0.5 (S1–S5) and [research/2026-05-single-host-50-concurrency.md](docs/project/research/2026-05-single-host-50-concurrency.md). |
| **Future** | Multi-machine horizontal scale (stateless gateway + queue-driven worker pool + shared storage) for hundreds–thousands of sessions. Design in [research/2026-05-tier-decoupling-design.md](docs/project/research/2026-05-tier-decoupling-design.md); not required for the single-host target. |

> **Heads-up for operators:** until the worker cap (S1) lands, size your host for your
> expected *peak simultaneous* active chats (budget ~300 MB per active worker on top of
> Postgres/Redis/MinIO/Meilisearch), or limit how many users chat at once.

## Development

```bash
# Start development server
pnpm dev

# Start WebSocket server (required for Claude Chat)
node ws-server.mjs

# Run database migrations
pnpm db:migrate

# Quality checks (run before committing)
pnpm typecheck    # TypeScript type checking
pnpm lint         # Code linting
pnpm validate-routes  # TanStack Start route validation
pnpm test         # Run tests
```

For detailed development guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## CI/CD

This project uses GitHub Actions for continuous integration. The CI pipeline runs on every push and pull request, checking:

- ✅ **Type checking** (`pnpm typecheck`)
- ✅ **Linting** (`pnpm lint`)
- ✅ **Route validation** (`pnpm validate-routes`)
- ✅ **Tests** (`pnpm test`)

See [.github/workflows/ci.yml](.github/workflows/ci.yml) for the complete CI configuration.

## Routes

| Route | Description | Type |
|-------|-------------|------|
| `/agents/c` | **Main** - Claude Agent Chat with full features | WebSocket |
| `/agents/ai-chat` | Secondary - Mastra-powered simple chat | SSE |
| `/agents/skills` | Skills Store management page | - |
| `/api/chat` | Mastra chat API endpoint | POST, SSE |
| `/api/skills/*` | Skills API endpoints | REST |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Third-Party Licenses

This project uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which is subject to [Anthropic's Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms).

Other key dependencies:
- **Better Auth** - Authentication library
- **Mastra** - AI Agent Framework
- **TanStack Start** - Full-stack React framework
- **Drizzle ORM** - PostgreSQL ORM

See [NOTICE](NOTICE) for complete third-party license information.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## Links

- **GitHub**: https://github.com/foreveryh/oxygenie
- **Claude Agent SDK**: https://github.com/anthropics/claude-agent-sdk
- **Mastra Docs**: https://mastra.ai
- **Assistant UI**: https://assistant-ui.com
- **TanStack Start**: https://tanstack.com/start
