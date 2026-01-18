---
name: filesystem
description: Access and read files from the local filesystem
category: data
tags: ["files", "filesystem", "io"]
icon: file
defaultEnabled: false

mcp:
  type: stdio
  name: filesystem
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/data/workspace"]

# Read-only filesystem access
allowedTools:
  - "mcp__filesystem__read_file"
  - "mcp__filesystem__list_directory"
  - "mcp__filesystem__search_files"
  - "mcp__filesystem__get_file_info"

# No credentials required for filesystem access
credentials: []
---

# Filesystem MCP

Read-only access to files and directories within the workspace.

## Available Tools

| Tool | Description | Allowed |
|------|-------------|---------|
| read_file | Read file contents | ✅ |
| write_file | Write to a file | ❌ |
| create_directory | Create a directory | ❌ |
| list_directory | List directory contents | ✅ |
| search_files | Search for files by name/pattern | ✅ |
| get_file_info | Get file metadata | ✅ |

## Usage Examples

- "List files in the current directory"
- "Read the contents of config.json"
- "Search for all TypeScript files"
- "Get the size of README.md"

## Security

This MCP has read-only access to the workspace directory: `/data/workspace`
