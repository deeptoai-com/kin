# 数据库迁移错误分析

> **错误**: `TypeError: Cannot read properties of undefined (reading 'searchParams')`  
> **发生位置**: `drizzle-kit migrate` 执行时

---

## 🔍 错误原因分析

### 核心问题

错误发生在 `pg-connection-string` 尝试解析 `DATABASE_URL` 时：

```
TypeError: Cannot read properties of undefined (reading 'searchParams')
at parse (/app/node_modules/.pnpm/pg-connection-string@2.9.1/node_modules/pg-connection-string/index.js:39:30)
```

**根本原因**：
1. `drizzle.config.ts` 中直接使用 `process.env.DATABASE_URL as string`
2. 如果 `DATABASE_URL` 未设置或为空，`process.env.DATABASE_URL` 是 `undefined`
3. `as string` 只是 TypeScript 类型断言，不会实际转换值
4. `undefined` 被传递给 `pg-connection-string` 的 `parse` 函数，导致错误

### 可能的原因

1. **环境变量未设置**：
   - 在 Dokploy 中未配置 `DATABASE_URL` 环境变量
   - Docker Compose 变量替换失败（`${DATABASE_URL:?}` 应该会报错，但可能在某些情况下不会）

2. **环境变量格式错误**：
   - `DATABASE_URL` 值格式不正确
   - 包含特殊字符导致解析失败

3. **环境变量传递问题**：
   - Docker Compose 的环境变量未正确传递到容器内
   - 多行值或引号问题

---

## ✅ 已实施的修复

### 1. 修复 `drizzle.config.ts`

添加了 `DATABASE_URL` 的验证和错误提示：

```typescript
// Validate DATABASE_URL is set
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error(
        'DATABASE_URL environment variable is not set. ' +
        'Please set DATABASE_URL in your environment variables or Docker Compose configuration.'
    );
}

// Validate DATABASE_URL format (basic check)
if (!databaseUrl.startsWith('postgresql://') || !databaseUrl.startsWith('postgres://')) {
    throw new Error(
        `DATABASE_URL must start with "postgresql://" or "postgres://". ` +
        `Current value: ${databaseUrl.substring(0, 20)}...`
    );
}
```

**好处**：
- 提供清晰的错误信息
- 在配置阶段就能发现问题
- 避免传递 `undefined` 给连接字符串解析器

### 2. 添加调试信息

在 `docker-compose.dokploy.yml` 的 migrate 服务中添加了调试输出：

```yaml
entrypoint: >
  sh -c "
  echo '=== Migration Debug Info ===' &&
  echo 'DATABASE_URL is set: '$$([ -z \"$$DATABASE_URL\" ] && echo 'NO' || echo 'YES') &&
  echo 'DATABASE_URL length: '$$(echo -n \"$$DATABASE_URL\" | wc -c) &&
  echo 'DATABASE_URL preview: '$$(echo \"$$DATABASE_URL\" | sed 's/:[^:@]*@/:****@/') &&
  echo '===========================' &&
  pnpm run db:migrate
  "
```

**好处**：
- 在迁移执行前验证环境变量
- 显示环境变量的状态（是否设置、长度、预览）
- 帮助快速定位问题

---

## 🔧 排查步骤

### Step 1: 检查环境变量

在 Dokploy 中确认 `DATABASE_URL` 已设置：

```bash
# 格式应该是：
DATABASE_URL=postgresql://username:password@db:5432/database_name
```

### Step 2: 检查 Docker Compose 配置

确认 `docker-compose.dokploy.yml` 中 migrate 服务配置正确：

```yaml
migrate:
  environment:
    DATABASE_URL: ${DATABASE_URL:?}  # ? 表示如果未设置会报错
```

### Step 3: 查看调试输出

重新部署后，查看 migrate 服务的日志，应该看到：

```
=== Migration Debug Info ===
DATABASE_URL is set: YES
DATABASE_URL length: 45
DATABASE_URL preview: postgresql://user:****@db:5432/dbname
===========================
```

如果看到 `DATABASE_URL is set: NO`，说明环境变量未正确传递。

### Step 4: 验证连接字符串格式

确保 `DATABASE_URL` 格式正确：

```bash
# ✅ 正确格式
postgresql://user:password@host:5432/database
postgres://user:password@host:5432/database

# ❌ 错误格式
postgresql://user:password@host:5432  # 缺少数据库名
postgresql://user@host:5432/database  # 缺少密码
```

---

## 🆘 常见问题

### Q: 为什么 Docker Compose 的 `${DATABASE_URL:?}` 没有报错？

A: `${DATABASE_URL:?}` 只在 Docker Compose 解析时检查，如果环境变量在 Dokploy 中设置为空字符串，Docker Compose 不会报错，但容器内的 `process.env.DATABASE_URL` 会是空字符串或 `undefined`。

### Q: 如何验证环境变量是否正确传递？

A: 使用调试输出（已在 migrate 服务中添加），或手动执行：

```bash
docker exec -it <migrate-container> sh -c 'echo $DATABASE_URL'
```

### Q: 如果 DATABASE_URL 包含特殊字符怎么办？

A: 确保在 Dokploy 中正确设置，特殊字符通常不需要转义，但确保整个连接字符串格式正确。

---

## 📚 相关文档

- **环境变量配置**：`env.dokploy.example`
- **部署指南**：`DOKPLOY_DEPLOYMENT.md`
- **数据库配置**：`drizzle.config.ts`

---

## ✅ 验证修复

修复后，重新部署应该：

1. **看到调试输出**：确认 `DATABASE_URL` 已设置
2. **不再出现 `searchParams` 错误**：`drizzle.config.ts` 会提前验证
3. **迁移成功执行**：如果 `DATABASE_URL` 正确，迁移应该能正常执行

如果仍然失败，查看新的错误信息（应该更清晰），然后根据错误信息进一步排查。

---

**状态**: 问题分析和修复完成  
**最后更新**: 2026-01-14
