---
name: fetch
description: Make HTTP requests to fetch web content and APIs
category: integration
tags: ["http", "api", "web", "fetch"]
icon: globe
defaultEnabled: true

mcp:
  type: stdio
  name: fetch
  command: npx
  args: ["-y", "@modelcontextprotocol/server-fetch"]

# All fetch operations allowed
allowedTools:
  - "mcp__fetch__*"

# No credentials required (API keys passed via tool arguments)
credentials: []
---

# Fetch MCP

Make HTTP requests to fetch web content, APIs, and other resources.

## Available Tools

| Tool | Description | Allowed |
|------|-------------|---------|
| fetch | Make an HTTP GET request | ✅ |
| fetchHead | Make an HTTP HEAD request | ✅ |

## Usage Examples

- "Fetch the content of https://example.com"
- "Get the headers from https://api.github.com"
- "Check if a website is accessible"
- "Fetch JSON data from an API endpoint"

## Features

- Follows redirects automatically
- Returns both headers and body content
- Supports various content types (JSON, HTML, text, etc.)
- Configurable timeout

## Notes

This MCP does not require pre-configured credentials. API keys and auth tokens can be passed directly in tool arguments when needed.
