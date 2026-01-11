# Dokploy 部署指南

> **日期**: 2025-12-31  
> **适用文件**: `docker-compose.dokploy.yml`  
> **目的**: 在 Dokploy 平台上部署 Claude Agent Chat 应用

---

## 📋 前提条件

1. ✅ 已安装并配置 Dokploy
2. ✅ Traefik 已启用（Dokploy 默认使用 Traefik）
3. ✅ 有可用的域名
4. ✅ 已准备好所有必需的环境变量

---

## 🚀 部署步骤

### Step 1: 在 Dokploy 中创建应用

1. 登录 Dokploy 控制台
2. 进入你的项目
3. 点击 "New Application" 或 "新建应用"
4. 选择 "Docker Compose" 或 "Docker Compose File"
5. 应用名称：`claude-agent-chat`（或你喜欢的名称）

---

### Step 2: 上传 docker-compose 文件

1. 在应用配置中，选择 "Use Docker Compose File"
2. 上传或粘贴 `docker-compose.dokploy.yml` 文件内容
3. 保存配置

---

### Step 3: 配置环境变量

**在 Dokploy 的 "Environment Variables" 中添加环境变量**：

#### 方法 1: 使用环境变量示例文件（推荐）⭐

1. **打开文件**：`infra/deploy/env.dokploy.example`
2. **复制所有变量**到 Dokploy 的 "Environment Variables" 配置中
3. **替换所有占位符值**（`your-xxx`）为实际值
4. **删除或注释掉不需要的可选变量**

#### 方法 2: 使用检查清单

1. **打开检查清单**：`infra/deploy/DOKPLOY_ENV_CHECKLIST.md`
2. **按照清单逐个添加环境变量**
3. **确认所有必需变量都已填写**

#### 快速参考：必需变量最小配置

**最少必需的变量**：

```bash
# 应用配置
APP_NAME=claude-agent-chat
APP_HOSTNAME=your-domain.com

# 数据库
POSTGRES_USER=your_db_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=claude_agent_chat
DATABASE_URL=postgresql://your_db_user:your_secure_password@db:5432/claude_agent_chat

# MinIO / S3
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=your_minio_password
MINIO_BUCKET=constructa-files

# Redis
REDIS_URL=redis://redis:6379

# Meilisearch
MEILI_MASTER_KEY=your_meili_master_key

# 认证
BETTER_AUTH_SECRET=your_random_secret_key_here_minimum_32_characters
BETTER_AUTH_URL=https://your-domain.com
BETTER_AUTH_INTERNAL_URL=http://localhost:5000

# AI 服务
ANTHROPIC_API_KEY=your_anthropic_api_key
ZHIPU_API_KEY=your_zhipu_api_key

# WebSocket URL
VITE_WS_URL=wss://your-domain.com/ws/agent

# 节点环境
NODE_ENV=production
```

**完整变量列表**：参见 `infra/deploy/env.dokploy.example`

**检查清单**：参见 `infra/deploy/DOKPLOY_ENV_CHECKLIST.md`

---

### Step 4: 配置 Traefik Labels（可选）

**注意**：`docker-compose.dokploy.yml` 已经包含了 Traefik labels。如果你的 Dokploy 环境需要额外的配置，可以在 Dokploy UI 中添加或修改 labels。

**参考配置**：见 `infra/deploy/dokploy-traefik-labels.yml`

**关键 Labels**：
- `traefik.enable=true`
- HTTP 路由：端口 5000
- WebSocket 路由：端口 3001，优先级 10

---

### Step 5: 配置端口暴露

**注意**：`docker-compose.dokploy.yml` 使用 `expose` 而不是 `ports`，因为 Traefik 会处理外部访问。

如果 Dokploy 要求配置端口，可以忽略或设置为内部端口：
- 5000 (HTTP)
- 3001 (WebSocket)

---

### Step 6: 部署应用

1. 点击 "Deploy" 或 "部署"
2. 等待所有服务启动
3. 查看日志确认服务正常运行

---

### Step 7: 验证部署

#### 1. 检查服务状态

在 Dokploy 中查看应用状态，确认所有服务都是 "Running"：
- ✅ db
- ✅ minio
- ✅ redis
- ✅ meilisearch
- ✅ migrate (completed)
- ✅ provision-minio (completed)
- ✅ app
- ✅ worker (如果启用)

#### 2. 检查 HTTP 访问

```bash
curl https://your-domain.com/health
```

应该返回健康状态。

#### 3. 检查 WebSocket 连接

**浏览器控制台**：
```javascript
const ws = new WebSocket('wss://your-domain.com/ws/agent');
ws.onopen = () => console.log('✅ WebSocket connected');
ws.onerror = (e) => console.error('❌ WebSocket error:', e);
ws.onclose = (e) => console.log('WebSocket closed:', e.code, e.reason);
```

#### 4. 访问应用

打开浏览器访问：`https://your-domain.com`

---

## 🔧 常见问题

### 问题 1: WebSocket 连接失败

**症状**：WebSocket 连接返回 426 或立即断开

**解决方案**：
1. 检查 Traefik 版本（建议 3.3.1+）
2. 确认 WebSocket 路由优先级设置为 10
3. 检查应用日志：`docker logs app`
4. 检查 Traefik 日志：`docker logs traefik`

**调试**：
```bash
# 在 Dokploy 中查看应用日志
# 或在服务器上：
docker logs claude-agent-chat-app
```

---

### 问题 2: 数据库连接失败

**症状**：应用无法连接到数据库

**解决方案**：
1. 检查 `DATABASE_URL` 环境变量是否正确
2. 确认数据库服务健康状态
3. 检查网络连接（服务应在同一 Docker 网络）

**验证**：
```bash
# 检查数据库服务
docker exec -it claude-agent-chat-db psql -U your_db_user -d claude_agent_chat
```

---

### 问题 3: MinIO 无法访问

**症状**：文件上传失败或 S3 错误

**解决方案**：
1. 检查 `provision-minio` 服务是否完成
2. 确认 MinIO 凭证正确
3. 检查 S3 环境变量配置

---

### 问题 4: Traefik 路由不工作

**症状**：无法通过域名访问应用

**解决方案**：
1. 检查 `APP_HOSTNAME` 环境变量
2. 确认 Traefik labels 正确配置
3. 检查 DNS 解析（域名应指向服务器 IP）
4. 确认 SSL 证书自动申请（Let's Encrypt）

---

### 问题 5: 迁移失败

**症状**：`migrate` 服务失败

**解决方案**：
1. 检查数据库连接
2. 确认 `DATABASE_URL` 正确
3. 查看迁移日志
4. 手动运行迁移（如果需要）

**手动迁移**：
```bash
docker exec -it claude-agent-chat-app pnpm run db:migrate
```

---

## 📊 服务架构

### 部署架构图

```
Internet
   ↓
Traefik (Dokploy)
   ├─ HTTP (Port 5000) → app
   └─ WebSocket (Port 3001) → app
         ↓
    Docker Network (private)
         ├─ app (Nitro + WebSocket)
         ├─ worker (Background jobs)
         ├─ db (PostgreSQL)
         ├─ redis (Cache/Queue)
         ├─ meilisearch (Search)
         └─ minio (Object Storage)
```

---

## 🔒 安全建议

1. ✅ **使用强密码**：所有密码应使用强随机字符串
2. ✅ **启用 HTTPS**：Traefik 自动配置 Let's Encrypt
3. ✅ **限制访问**：仅暴露必要的端口
4. ✅ **定期备份**：备份数据库和 MinIO 数据
5. ✅ **更新镜像**：定期更新应用镜像以获取安全补丁

---

## 📝 维护和更新

### 更新应用

1. 构建新镜像（CI/CD 或手动）
2. 在 Dokploy 中更新 `APP_TAG` 环境变量
3. 重新部署应用

### 备份数据

**数据库备份**：
```bash
docker exec claude-agent-chat-db pg_dump -U your_db_user claude_agent_chat > backup.sql
```

**MinIO 备份**：
```bash
docker exec claude-agent-chat-minio mc mirror /data /backup
```

### 查看日志

**应用日志**：
```bash
docker logs -f claude-agent-chat-app
```

**所有服务日志**：
在 Dokploy UI 中查看或使用：
```bash
docker compose -f docker-compose.dokploy.yml logs -f
```

---

## 📚 参考文档

### 环境变量配置

- **环境变量示例**：`infra/deploy/env.dokploy.example` - 完整的环境变量列表和说明
- **环境变量检查清单**：`infra/deploy/DOKPLOY_ENV_CHECKLIST.md` - 必需变量快速检查清单

### 部署配置

- **WebSocket 配置**：`docs/5. 研发实施/2. 研发过程/3. 任务中间态/12-31-Dokploy-Traefik-WebSocket配置指南.md`
- **快速配置**：`docs/5. 研发实施/2. 研发过程/3. 任务中间态/12-31-Dokploy-快速配置指南.md`
- **Traefik Labels**：`infra/deploy/dokploy-traefik-labels.yml`

---

**状态**: 部署指南完成  
**下一步**: 按照步骤部署应用
