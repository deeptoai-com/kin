# 開源文檔規劃與環境變數完備性討論

**日期**: 2026-01-27  
**目的**: 供討論用的方案草稿，涵蓋 .env 完備性、開發文檔、文檔目錄結構

---

## 已實施（2026-01-27）

- **.env.example**：補充 ANTHROPIC_BASE_URL/MODEL、APP_URL、WS_PORT、RESEND_API_KEY、S3_ENABLE_PATH_STYLE、SKILLS_STORE_SEED_MODE、BETTER_AUTH_TRUSTED_ORIGINS、CLAUDE_PERMISSION_*、ENABLE_STRUCTURED_OUTPUTS
- **docs/**：採用方案 B，新增 README.md、development/local-setup.md、troubleshooting.md
- **README / README_CN**：新增「文檔」章節，引導至 docs/

---

## 一、.env.example 環境變數完備性審核

### 1.1 已覆蓋且正確

| 分組 | 變數 | 說明 |
|------|------|------|
| 應用 | VITE_BASE_URL, APP_HOSTNAME | ✓ |
| AI | ZHIPU_API_KEY, ANTHROPIC_API_KEY | ✓ |
| Claude | CLAUDE_SESSIONS_ROOT, SANDBOX_ENABLED, VITE_WS_URL | ✓ |
| 數據庫 | DATABASE_URL, POSTGRES_* | ✓ |
| 認證 | BETTER_AUTH_*, SESSION_COOKIE_NAME (可選) | ✓ |
| 郵件 | EMAIL_*, MAILHOG_*, SMTP_*, RESEND 隱式 | ✓ |
| 存儲 | S3_*, MINIO_* | ✓ |
| 搜索 | MEILI_* | ✓ |
| 任務 | REDIS_URL, BULLMQ_*, JOBS_*, JOB_* | ✓ |
| OAuth | GITHUB_*, GOOGLE_* | ✓ |
| 可觀測 | SENTRY_*, VITE_POSTHOG_* | ✓ |
| MCP | CLAUDE_MCP_STORE_DIR, MCP_STORE_DIR, PYTHON_* | ✓ |

### 1.2 建議補充（代碼中實際使用）

| 變數 | 用途 | 建議默認值 |
|------|------|------------|
| **ANTHROPIC_BASE_URL** | Claude API 自定義網關（如 GLM） | 空（使用官方） |
| **ANTHROPIC_MODEL** | 模型覆蓋（如 claude-3-5-sonnet） | 空 |
| **APP_URL** | ws-server 認證主應用 URL（start:hybrid 等） | http://localhost:3000 |
| **WS_PORT** | WebSocket 埠 | 3001 |
| **RESEND_API_KEY** | Resend 郵件供應商 | 空 |
| **S3_ENABLE_PATH_STYLE** | MinIO 路徑風格（file.ts 使用） | 1 |
| **S3_SECRET_ACCESS_KEY** | file.ts 使用此名（與 S3_ACCESS_KEY 對應） | 見 S3 |
| **BETTER_AUTH_TRUSTED_ORIGINS** | 可信源（CORS 等） | 空 |
| **BETTER_AUTH_BASE_PATH** | 認證路徑前綴 | /api/auth |
| **CLAUDE_PERMISSION_MODE** | 權限模式 | default |
| **CLAUDE_ALLOW_BASH** | 是否允許 bash | false |
| **CLAUDE_BYPASS_USER_IDS** | 繞過權限的用戶 ID | 空 |
| **SKILLS_STORE_DIR** | 技能商店目錄（生產） | /data/skills-store |
| **SKILLS_STORE_SEED_MODE** | seed 行為 | skip |
| **ENABLE_STRUCTURED_OUTPUTS** | Artifact 結構化輸出 | false |

### 1.3 可選（進階 / 調試）

| 變數 | 說明 |
|------|------|
| SCHEMA_GENERATION_DEBUG | 調試 |
| SCHEMA_GENERATION_TRACE | 調試 |
| CLAUDE_CODE_EXECUTABLE | 自定義可執行 |
| CLAUDE_READ_ALLOWED_PREFIXES | 路徑白名單 |
| CLAUDE_WRITE_ALLOWED_PREFIXES | 路徑白名單 |
| CLAUDE_BLOCKED_PREFIXES | 路徑黑名單 |
| AUTO_MIGRATE | 是否自動遷移 |
| SEARCH_REINDEX_ON_BOOT | 啟動時重建搜索索引 |
| GITHUB_TOKEN | Skills 安裝用 |
| OPENAI_API_KEY, OPENAI_BASE_URL | 圖像生成 Skill |
| GOOGLE_API_KEY, GOOGLE_BASE_URL | 圖像生成 Skill |

### 1.4 建議

- 在 `.env.example` 中補充 **1.2** 中列出的變數（帶註釋與默認值）。
- **1.3** 可放在單獨的「進階配置」小節或 `docs/` 下的說明文件中。

---

## 二、pnpm 便攜開發環境教程（開發文檔內容草稿）

建議撰寫一篇 **「便攜開發環境指南」**，涵蓋：

1. **前置條件**：Node ≥22.12、pnpm、Docker（基礎設施）
2. **三種運行模式對照**：
   - 全 Docker
   - 混合模式（Docker 基礎設施 + 本地 App）
   - 全本地（需自建 PostgreSQL/Redis/Meilisearch/MinIO）
3. **混合模式步驟**：
   - `ex0 init` 或 `docker compose up -d db minio provision-minio redis meilisearch`
   - `.env` 配置（localhost 指向、VITE_WS_URL 等）
   - `pnpm dev` + `node ws-server.mjs` 或 `pnpm build` + `pnpm start:hybrid`
4. **常見問題**：HeadersTimeoutError → 使用 start:hybrid；構建 OOM → NODE_OPTIONS
5. **環境變數清單**：連結到 .env.example 或專門的 env 說明頁

---

## 三、開源文檔目錄結構方案

### 3.1 現狀

```
constructa-starter/
├── README.md, README_CN.md
├── CONTRIBUTING.md
├── docs/                    # 僅 2 個文件
│   ├── MODIFICATION_AUDIT.md
│   └── DEPLOYMENT_MEMORY_FIX.md
├── infra/deploy/            # 部署相關（Dokploy 等）
└── (無專門的 docs 體系)
```

### 3.2 方案 A：扁平 `docs/`（簡潔）

```
docs/
├── README.md                # 文檔索引，README 引導入口
├── development.md          # 便攜開發環境指南
├── environment-variables.md # 環境變數完整說明（可選，或指向 .env.example）
├── deployment.md           # 部署概述 + 連結 infra/deploy
└── troubleshooting.md      # 常見問題（HeadersTimeout、OOM 等）
```

**優點**：結構簡單，易維護。  
**缺點**：文檔變多時會略顯雜亂。

### 3.3 方案 B：分組 `docs/`（推薦）

```
docs/
├── README.md                # 文檔索引
├── getting-started.md       # 快速開始（精簡版，詳見主 README）
├── development/
│   └── local-setup.md       # 便攜開發環境（pnpm + Docker 混合）
├── deployment/
│   ├── overview.md          # 部署方式概覽
│   └── docker-compose.md    # Docker Compose 說明
├── configuration/
│   └── environment-variables.md
└── troubleshooting.md
```

**優點**：結構清晰，之後擴充空間大。  
**缺點**：目錄多一層。

### 3.4 方案 C：與根級並行（docs + 頂層）

```
README.md                    # 主入口，含「文檔」章節連結
CONTRIBUTING.md
DEVELOPMENT.md               # 開發環境（頂層，便於發現）
docs/                        # 其余詳細文檔
├── README.md
├── deployment/
├── configuration/
└── ...
```

**優點**：DEVELOPMENT.md 顯眼。  
**缺點**：根目錄文件變多。

### 3.5 建議

- 採用 **方案 B**，並在 `docs/README.md` 中做索引與說明。
- 在 **主 README** 末尾新增「文檔」章節，連結到 `docs/README.md` 及各子文檔。

---

## 四、README 引導設計

在 README 末尾或適當位置新增：

```markdown
## Documentation

- **[Documentation Index](docs/README.md)** – Full documentation hub
- [Local Development Setup](docs/development/local-setup.md) – pnpm + Docker hybrid mode
- [Environment Variables](docs/configuration/environment-variables.md) – All env vars explained
- [Deployment](docs/deployment/overview.md) – Docker, cloud, self-host
- [Troubleshooting](docs/troubleshooting.md) – Common issues
```

或更精簡：

```markdown
## Further Reading

See [docs/README.md](docs/README.md) for development guides, deployment, and troubleshooting.
```

---

## 五、待討論要點

1. **方案選擇**：文檔目錄用 A、B 還是 C？或有其他偏好？
2. **環境變數**：是否一次性補充 1.2 所有變數，還是分階段？
3. **多語言**：開發文檔是否同時提供中英文（如 development.zh.md）？
4. **現有 docs**：`MODIFICATION_AUDIT.md`、`DEPLOYMENT_MEMORY_FIX.md` 歸入新結構還是保留原位？

---

請依此討論，確認後可開始具體實施。
