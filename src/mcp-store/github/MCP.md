---
name: github
description: GitHub integration for issues, pull requests, and repositories
category: development
tags: ["git", "code-review", "issues", "pr"]
icon: github
defaultEnabled: false

mcp:
  type: stdio
  name: github
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github"]
  env:
    GITHUB_TOKEN: "${GITHUB_TOKEN}"

# Read-only GitHub access - no write operations
allowedTools:
  - "mcp__github__list_issues"
  - "mcp__github__search_issues"
  - "mcp__github__get_issue"
  - "mcp__github__list_pull_requests"
  - "mcp__github__get_pull_request"
  - "mcp__github__get_file_contents"
  - "mcp__github__list_branches"
  - "mcp__github__get_branch"
  - "mcp__github__list_commits"

credentials:
  - key: GITHUB_TOKEN
    label: GitHub Personal Access Token
    description: Create at https://github.com/settings/tokens with repo scope
    required: true
    sensitive: true
---

# GitHub MCP

Integrate with GitHub to browse issues, pull requests, and repository contents.

## Available Tools

| Tool | Description | Allowed |
|------|-------------|---------|
| list_issues | List issues in a repository | ✅ |
| search_issues | Search issues across repositories | ✅ |
| get_issue | Get details of a specific issue | ✅ |
| create_issue | Create a new issue | ❌ |
| update_issue | Update an existing issue | ❌ |
| list_pull_requests | List pull requests | ✅ |
| get_pull_request | Get PR details | ✅ |
| create_pull_request | Create a new PR | ❌ |
| get_file_contents | Get file contents from a repo | ✅ |
| list_branches | List branches in a repository | ✅ |
| get_branch | Get branch details | ✅ |
| list_commits | List commits in a repository | ✅ |

## Usage Examples

- "List open issues in owner/repo"
- "Search for issues about authentication"
- "Show me the details of issue #123"
- "List pull requests in a repository"
- "Get the contents of README.md from a repo"
- "List all branches in a repository"

## Token Creation

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (for private repos) or `public_repo` (for public only)
4. Generate and copy the token
