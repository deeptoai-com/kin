---
name: markitdown-mcp
description: 将 PDF、Office 等文档转换为 Markdown
category: document
tags: ["markdown", "document", "pdf", "docx", "pptx", "xlsx"]
icon: file-text
defaultEnabled: true

mcp:
  type: stdio
  name: markitdown-mcp
  command: markitdown-mcp

allowedTools:
  - "mcp__markitdown-mcp__convert_to_markdown"
---

# MarkItDown MCP

将多种文档格式转换为 Markdown 的 MCP 服务。

## 可用工具

| 工具 | 描述 |
|------|------|
| convert_to_markdown | 把指定 URI 的文档转换为 Markdown |

## 工具参数

### convert_to_markdown

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `uri` | string | 是 | 文档 URI（支持 `file:` / `http:` / `https:` / `data:` 等） |

## 使用示例

- "将 file:/path/to/report.pdf 转为 Markdown"
- "读取 file:/path/to/slides.pptx 并总结"
