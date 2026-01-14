# DATABASE_URL 特殊字符处理指南

> **问题**: 密码包含特殊字符（如 `#`, `@`, `%` 等）导致数据库连接失败

---

## 🔍 问题原因

在 PostgreSQL 连接字符串（URL 格式）中，某些字符有特殊含义：

| 字符 | URL 含义 | 需要编码为 |
|------|---------|-----------|
| `#` | Fragment 标识符 | `%23` |
| `@` | 用户信息分隔符 | `%40` |
| `:` | 协议/端口分隔符 | `%3A` |
| `/` | 路径分隔符 | `%2F` |
| `?` | 查询字符串开始 | `%3F` |
| `&` | 查询参数分隔符 | `%26` |
| `=` | 键值对分隔符 | `%3D` |
| `%` | 编码前缀 | `%25` |
| 空格 | 特殊字符 | `%20` 或 `+` |

**示例问题**：
```
# ❌ 错误：密码中的 # 会被当作 URL fragment
DATABASE_URL=postgresql://user:2wsx#EDC2026db@db:5432/database
# 实际解析的密码：2wsx（#EDC2026db 被丢失）

# ✅ 正确：使用 URL 编码
DATABASE_URL=postgresql://user:2wsx%23EDC2026db@db:5432/database
# 实际解析的密码：2wsx#EDC2026db
```

---

## ✅ 解决方案

### 方法 1: 手动 URL 编码（推荐）

**你的配置**：
```bash
POSTGRES_USER=deeptoai
POSTGRES_PASSWORD=2wsx#EDC2026db
POSTGRES_DB=deeptoai_agents
```

**正确的 DATABASE_URL**：
```bash
DATABASE_URL=postgresql://deeptoai:2wsx%23EDC2026db@db:5432/deeptoai_agents
```

**编码规则**：
- `#` → `%23`
- 其他特殊字符也需要相应编码

---

### 方法 2: 使用在线工具

1. 访问：https://www.urlencoder.org/
2. 输入密码：`2wsx#EDC2026db`
3. 复制编码结果：`2wsx%23EDC2026db`
4. 构建完整的 `DATABASE_URL`

---

### 方法 3: 使用命令行工具

**Python**：
```bash
python3 -c "import urllib.parse; print(urllib.parse.quote('2wsx#EDC2026db', safe=''))"
# 输出：2wsx%23EDC2026db
```

**Node.js**：
```bash
node -e "console.log(encodeURIComponent('2wsx#EDC2026db'))"
# 输出：2wsx%23EDC2026db
```

**完整示例**：
```bash
# 设置变量
PASSWORD="2wsx#EDC2026db"
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PASSWORD', safe=''))")
echo "postgresql://deeptoai:${ENCODED}@db:5432/deeptoai_agents"
```

---

## 📝 完整配置示例

### 你的情况

**原始配置**（❌ 错误）：
```bash
POSTGRES_USER=deeptoai
POSTGRES_PASSWORD=2wsx#EDC2026db
POSTGRES_DB=deeptoai_agents
DATABASE_URL=postgresql://deeptoai:2wsx#EDC2026db@db:5432/deeptoai_agents
```

**修复后配置**（✅ 正确）：
```bash
POSTGRES_USER=deeptoai
POSTGRES_PASSWORD=2wsx#EDC2026db
POSTGRES_DB=deeptoai_agents
DATABASE_URL=postgresql://deeptoai:2wsx%23EDC2026db@db:5432/deeptoai_agents
```

**注意**：
- `POSTGRES_PASSWORD` 保持原样（Docker Compose 环境变量不需要编码）
- `DATABASE_URL` 中的密码部分需要 URL 编码

---

## 🔍 验证配置

### 方法 1: 检查 URL 解析

使用 Python 验证：
```python
from urllib.parse import urlparse

url = "postgresql://deeptoai:2wsx%23EDC2026db@db:5432/deeptoai_agents"
parsed = urlparse(url)
print(f"用户名: {parsed.username}")
print(f"密码: {parsed.password}")
print(f"主机: {parsed.hostname}")
print(f"端口: {parsed.port}")
print(f"数据库: {parsed.path.lstrip('/')}")
```

**预期输出**：
```
用户名: deeptoai
密码: 2wsx#EDC2026db  ✅ 正确！
主机: db
端口: 5432
数据库: deeptoai_agents
```

### 方法 2: 测试连接

在容器中测试：
```bash
docker exec -it <migrate-container> sh -c 'echo $DATABASE_URL'
# 应该看到：postgresql://deeptoai:2wsx%23EDC2026db@db:5432/deeptoai_agents
```

---

## ⚠️  常见错误

### ❌ 错误 1: 忘记编码

```bash
# 错误
DATABASE_URL=postgresql://user:pass#word@db:5432/db
# 实际密码：pass（#word 被丢失）
```

### ❌ 错误 2: 双重编码

```bash
# 错误（如果密码已经是编码后的）
DATABASE_URL=postgresql://user:pass%23word@db:5432/db
# 如果再次编码会变成：pass%2523word（错误）
```

### ❌ 错误 3: 编码整个 URL

```bash
# 错误：只编码密码部分，不要编码整个 URL
DATABASE_URL=postgresql%3A%2F%2Fuser%3Apass%23word%40db%3A5432%2Fdb  # ❌
```

### ✅ 正确做法

```bash
# 正确：只编码密码中的特殊字符
DATABASE_URL=postgresql://user:pass%23word@db:5432/db  # ✅
```

---

## 🛠️  快速修复脚本

创建一个脚本来自动生成正确的 `DATABASE_URL`：

```bash
#!/bin/bash
# generate-database-url.sh

USERNAME="deeptoai"
PASSWORD="2wsx#EDC2026db"
HOST="db"
PORT="5432"
DATABASE="deeptoai_agents"

# URL 编码密码
ENCODED_PASSWORD=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PASSWORD', safe=''))")

# 生成 DATABASE_URL
DATABASE_URL="postgresql://${USERNAME}:${ENCODED_PASSWORD}@${HOST}:${PORT}/${DATABASE}"

echo "POSTGRES_USER=${USERNAME}"
echo "POSTGRES_PASSWORD=${PASSWORD}"
echo "POSTGRES_DB=${DATABASE}"
echo "DATABASE_URL=${DATABASE_URL}"
```

**使用方法**：
```bash
chmod +x generate-database-url.sh
./generate-database-url.sh
```

---

## 📚 相关文档

- **环境变量配置**：`env.dokploy.example`
- **迁移错误分析**：`MIGRATION_ERROR_ANALYSIS.md`
- **部署指南**：`DOKPLOY_DEPLOYMENT.md`

---

## ✅ 总结

**你的修复步骤**：

1. **在 Dokploy 中更新 `DATABASE_URL`**：
   ```bash
   DATABASE_URL=postgresql://deeptoai:2wsx%23EDC2026db@db:5432/deeptoai_agents
   ```

2. **保持其他配置不变**：
   ```bash
   POSTGRES_USER=deeptoai
   POSTGRES_PASSWORD=2wsx#EDC2026db
   POSTGRES_DB=deeptoai_agents
   ```

3. **重新部署**，迁移应该能成功执行

---

**状态**: 问题分析和解决方案完成  
**最后更新**: 2026-01-14
