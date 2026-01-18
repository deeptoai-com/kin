---
name: postgres
description: PostgreSQL database query and inspection
category: data
tags: ["database", "sql", "postgresql"]
icon: database
defaultEnabled: false

mcp:
  type: stdio
  name: postgres
  command: npx
  args: ["-y", "@modelcontextprotocol/server-postgres"]
  env:
    POSTGRES_CONNECTION_STRING: "${DATABASE_URL}"

# Read-only database access (SELECT queries only)
allowedTools:
  - "mcp__postgres__query"
  - "mcp__postgres__list_tables"
  - "mcp__postgres__describe_table"
  - "mcp__postgres__read_query"

credentials:
  - key: DATABASE_URL
    label: PostgreSQL Connection String
    description: >
      Connection string format: postgresql://user:password@host:port/database
    required: true
    sensitive: true
---

# PostgreSQL MCP

Connect to PostgreSQL databases for querying and schema inspection.

## Available Tools

| Tool | Description | Allowed |
|------|-------------|---------|
| query | Execute a SQL query (read-only) | ✅ |
| list_tables | List all tables in the database | ✅ |
| describe_table | Get table schema and columns | ✅ |
| read_query | Execute a read-only SELECT query | ✅ |

## Usage Examples

- "List all tables in the database"
- "Show me the schema for the users table"
- "Count the number of users in the database"
- "Get the last 10 orders from the orders table"

## Connection String Format

```
postgresql://username:password@hostname:5432/database_name
```

Example:
```
postgresql://postgres:secret@localhost:5432/mydb
```
