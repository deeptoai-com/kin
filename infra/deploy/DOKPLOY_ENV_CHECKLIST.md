# Dokploy 环境变量检查清单

> **日期**: 2025-12-31  
> **用途**: 快速检查必需环境变量是否已配置  
> **参考**: `.env.dokploy.example` - 完整环境变量示例

---

## 📋 必需变量清单（必须填写）

### ✅ 应用基础配置

- [ ] `APP_NAME` - 应用名称（如：claude-agent-chat）
- [ ] `APP_HOSTNAME` - 应用域名（如：app.example.com）
- [ ] `APP_IMAGE` - 应用镜像（如果使用镜像仓库）
- [ ] `APP_TAG` - 镜像标签（如：latest）

---

### ✅ 数据库配置（PostgreSQL）

- [ ] `POSTGRES_USER` - 数据库用户名
- [ ] `POSTGRES_PASSWORD` - 数据库密码（强密码）
- [ ] `POSTGRES_DB` - 数据库名称
- [ ] `DATABASE_URL` - 数据库连接字符串
  ```
  格式：postgresql://username:password@db:5432/database
  示例：postgresql://claude_user:password123@db:5432/claude_agent_chat
  ```

---

### ✅ MinIO / S3 对象存储

- [ ] `MINIO_ROOT_USER` - MinIO 管理员用户名
- [ ] `MINIO_ROOT_PASSWORD` - MinIO 管理员密码（强密码）
- [ ] `MINIO_BUCKET` - S3 存储桶名称（如：constructa-files）

---

### ✅ Redis 配置

- [ ] `REDIS_URL` - Redis 连接 URL（默认：redis://redis:6379）

---

### ✅ Meilisearch 配置

- [ ] `MEILI_MASTER_KEY` - Meilisearch 主密钥（强密钥）

---

### ✅ 认证配置（Better Auth）

- [ ] `BETTER_AUTH_SECRET` - 认证密钥（至少 32 个字符）
  ```
  生成方式：openssl rand -base64 32
  ```
- [ ] `BETTER_AUTH_URL` - 外部认证 URL
  ```
  格式：https://your-domain.com
  ```
- [ ] `BETTER_AUTH_INTERNAL_URL` - 内部认证 URL
  ```
  格式：http://localhost:5000
  ```

---

### ✅ AI 服务配置

- [ ] `ANTHROPIC_API_KEY` - Claude Agent SDK API 密钥
- [ ] `ZHIPU_API_KEY` - Zhipu AI API 密钥（Mastra AI SDK）

---

### ✅ WebSocket 配置

- [ ] `VITE_WS_URL` - WebSocket URL（前端配置）
  ```
  格式：wss://your-domain.com/ws/agent（HTTPS）
  或：  ws://your-domain.com/ws/agent（HTTP）
  ```

---

### ✅ 节点环境

- [ ] `NODE_ENV` - 固定为 `production`

---

## ⚠️ 重要变量（强烈建议填写）

- [ ] `EMAIL_PROVIDER` - 邮件提供商（smtp | resend | console）
- [ ] `EMAIL_FROM` - 发件人邮箱地址
- [ ] `SMTP_HOST` - SMTP 服务器地址（如果使用 SMTP）
- [ ] `SMTP_USER` - SMTP 用户名（如果使用 SMTP）
- [ ] `SMTP_PASSWORD` - SMTP 密码（如果使用 SMTP）

---

## 🔵 可选变量（根据需要填写）

### Claude Agent 高级配置

- [ ] `ANTHROPIC_BASE_URL` - Claude API 自定义端点（可选）
- [ ] `ANTHROPIC_MODEL` - Claude 模型名称（可选）
- [ ] `SANDBOX_ENABLED` - 启用沙盒环境（默认：false）
- [ ] `ENABLE_STRUCTURED_OUTPUTS` - 启用结构化输出（默认：false）

### Worker 后台任务

- [ ] `BULLMQ_PREFIX` - 任务队列前缀（默认：constructa）
- [ ] `DAILY_CREDIT_REFILL_CRON` - 每日信用额度补充 Cron（默认：0 3 * * *）
- [ ] `JOBS_SECRET` - 任务密钥（可选）

### Polar 计费（如果使用）

- [ ] `POLAR_SERVER` - Polar 环境（production | sandbox）
- [ ] `POLAR_ACCESS_TOKEN` - Polar Access Token
- [ ] `POLAR_WEBHOOK_SECRET` - Polar Webhook Secret
- [ ] `POLAR_ORGANIZATION_ID` - Polar Organization ID
- [ ] `POLAR_PRODUCT_PRO_MONTHLY` - Pro 月度订阅产品 ID
- [ ] `POLAR_PRODUCT_BUSINESS_MONTHLY` - Business 月度订阅产品 ID
- [ ] `POLAR_PRODUCT_CREDITS_50` - 50 积分产品 ID
- [ ] `POLAR_PRODUCT_CREDITS_100` - 100 积分产品 ID

### Sentry 错误监控（如果使用）

- [ ] `SENTRY_DSN` - Sentry DSN（后端）
- [ ] `VITE_SENTRY_DSN` - Sentry DSN（前端）
- [ ] `SENTRY_LOGGING` - 启用 Sentry 日志（默认：false）

---

## 🚀 快速验证脚本

部署后，使用以下命令验证环境变量是否配置正确：

```bash
# 检查必需变量
docker exec claude-agent-chat-app env | grep -E "APP_NAME|APP_HOSTNAME|DATABASE_URL|ANTHROPIC_API_KEY|ZHIPU_API_KEY|BETTER_AUTH_SECRET"
```

---

## 📝 配置步骤

1. ✅ 复制 `.env.dokploy.example` 中的变量
2. ✅ 在 Dokploy UI 中逐一添加环境变量
3. ✅ 使用此清单逐个检查
4. ✅ 确认所有必需变量都已填写
5. ✅ 保存并部署应用

---

## 🔒 安全提醒

- ⚠️  **所有密码和密钥应使用强随机字符串**
- ⚠️  **不要将敏感信息写入文档或提交到版本控制**
- ⚠️  **`BETTER_AUTH_SECRET` 必须至少 32 个字符**
- ⚠️  **数据库密码、MinIO 密码应至少 16 个字符**
- ⚠️  **定期轮换密钥和密码**

---

## 📚 参考文档

- **完整环境变量示例**：`.env.dokploy.example`
- **部署指南**：`DOKPLOY_DEPLOYMENT.md`
- **WebSocket 配置**：`dokploy-traefik-labels.yml`

---

**状态**: 检查清单完成  
**下一步**: 使用此清单检查环境变量配置
