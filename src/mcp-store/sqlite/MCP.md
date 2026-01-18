---
name: sqlite
description: SQLite database query and inspection
category: data
tags: ["database", "sql", "sqlite"]
icon: database
defaultEnabled: false

mcp:
  type: stdio
  name: sqlite
  command: npx
  args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "${DATABASE_PATH}"]

# Read-only database access (SELECT queries only)
allowedTools:
  - "mcp__sqlite__query"
  - "mcp__sqlite__list_tables"
  - "mcp__sqlite__describe_table"
  - "mcp__sqlite__read_query"

credentials:
  - key: DATABASE_PATH
    label: SQLite Database File Path
    description: Absolute path to the .sqlite or .db file
    required: true
    sensitive: false
---

# SQLite MCP

Connect to SQLite databases for querying and schema inspection.

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

## Database Path

Provide the absolute path to your SQLite database file:
- `/data/workspace/myapp.db`
- `/home/user/data/archive.sqlite`
