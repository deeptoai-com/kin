# 管理员权限恢复指南

> **适用场景**：管理员权限丢失、数据库重置后需要重新赋权、首次部署创建管理员

---

## 问题说明

当以下情况发生时，您可能需要手动恢复管理员权限：

- 数据库被重置或迁移后，用户角色丢失
- 首次部署系统，需要创建第一个管理员
- 开发环境中误操作导致管理员权限丢失

---

## 快速恢复（3 种方式）

### 方式 1：直接 SQL（最快，推荐）⭐

直接在数据库中执行 SQL 语句：

```sql
-- 恢复管理员权限
UPDATE "user"
SET system_role = 'admin'
WHERE email = 'your-email@example.com';

-- 验证结果
SELECT id, name, email, system_role FROM "user" WHERE email = 'your-email@example.com';
```

**通过 Docker 执行**：
```bash
docker compose exec -T db psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c \
  'UPDATE "user" SET system_role = '\''admin'\'' WHERE email = '\''your-email@example.com'\'';'
```

---

### 方式 2：使用恢复脚本（推荐用于自动化）

项目提供了自动化脚本 `scripts/grant-admin.ts`：

#### 在 Dokploy / Docker 环境中运行

```bash
# 进入 app 容器执行
docker compose exec app npx tsx scripts/grant-admin.ts your-email@example.com
```

#### 本地运行（需要数据库连接）

```bash
# 设置数据库连接
export DATABASE_URL="postgresql://user:pass@host:port/db"

# 运行脚本
npx tsx scripts/grant-admin.ts your-email@example.com
```

**脚本输出示例**：
```
Looking for user with email: your-email@example.com
Found user: { id: 'xxx', name: 'Your Name', email: 'your-email@example.com', systemRole: 'user' }

✅ Successfully granted admin role to "your-email@example.com"
Updated user: { id: 'xxx', name: 'Your Name', email: 'your-email@example.com', systemRole: 'admin' }
```

---

### 方式 3：通过数据库管理工具

使用 pgAdmin、DBeaver、Prisma Studio 等工具：

1. 连接到数据库
2. 找到 `user` 表
3. 定位目标用户的邮箱
4. 将 `system_role` 字段改为 `admin`

---

## 用户表结构

```sql
CREATE TABLE "user" (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN DEFAULT FALSE,
  image        TEXT,
  system_role  TEXT DEFAULT 'user',  -- 'admin' | 'user'
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);
```

---

## 重要提示

### ⚠️ 执行前确认

1. **用户必须先登录过**
   - 脚本通过邮箱查找用户
   - 如果用户未通过 OAuth 登录过，数据库中不存在该记录

2. **邮箱大小写敏感**
   - 确保 `email` 字段与 OAuth 提供的邮箱完全一致
   - GitHub 账号默认使用主邮箱地址

3. **权限范围**
   - `system_role = 'admin'` 拥有系统级管理权限
   - 不要随意授予未验证用户

---

## 预防措施

### 开发环境

使用数据库迁移时保留用户数据：

```bash
# 仅重置特定表，保留用户表
pnpm run db:reset  # 检查脚本是否保留 user 表
```

### 生产环境

1. **定期备份数据库**
   ```bash
   # PostgreSQL 备份示例
   pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
   ```

2. **记录管理员账号**
   - 在安全的地方记录所有管理员邮箱
   - 使用环境变量配置默认管理员

3. **监控权限变更**
   - 设置审计日志记录 `system_role` 变更

---

## 故障排查

### 用户未找到

```
User with email "xxx@example.com" not found
```

**原因**：用户未登录过，数据库中无记录

**解决**：先通过 OAuth（GitHub/Google）登录一次，再运行恢复脚本

---

### 数据库连接失败

```
Error: connect ECONNREFUSED
```

**检查**：
- `DATABASE_URL` 环境变量是否正确
- 数据库容器是否运行中：`docker compose ps db`

---

### 权限未生效

**验证步骤**：
1. 检查数据库中 `system_role` 是否为 `'admin'`
2. 退出登录后重新登录
3. 清除浏览器缓存 / localStorage

---

## 自动化：首次部署时创建管理员

在部署脚本中添加管理员初始化：

```bash
#!/bin/bash
# deploy.sh

# 等待服务启动
sleep 30

# 自动授予第一个用户管理员权限
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
docker compose exec -T app npx tsx scripts/grant-admin.ts "$ADMIN_EMAIL"
```

使用方式：
```bash
ADMIN_EMAIL="foreveryh@gmail.com" ./deploy.sh
```

---

## 相关文档

- [CLAUDE.md](../CLAUDE.md) - 项目开发规则
- [README.md](../README.md) - 项目说明
- [CONTRIBUTING.md](../CONTRIBUTING.md) - 贡献指南
