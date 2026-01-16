---
title: Python MCP Workspace Output Visibility
---

# Python MCP Workspace Output Visibility

## Overview

When Python code writes files into the session workspace (for example, a PNG plot),
the output should be visible in the chat UI and downloadable without relying on
Artifacts. This feature surfaces workspace files produced by the Python MCP tool
directly in the tool-call UI with previews and links.

## Flow

1. **Python runner snapshots workspace**
   - Before execution: scan the workspace tree.
   - After execution: scan again and diff.
   - Produce `filesCreated` / `filesUpdated` lists in the tool result.

2. **Tool-call UI renders outputs**
   - Parse the tool result JSON.
   - If `filesCreated` or `filesUpdated` exists, show a "Generated Files" section.
   - Image files render an inline preview.
   - Each file gets `Open` and `Download` links.

3. **Raw workspace file endpoint**
   - Supports binary responses with `?raw=1`.
   - Supports forced download with `?download=1`.
   - Content-Type is inferred from file extension.

## Workspace File API (raw mode)

`GET /api/workspace/:sessionId/file/:filePath?raw=1`

Optional:
- `download=1` adds `Content-Disposition: attachment` to the response.

The endpoint still supports JSON text reads (default behavior without `raw=1`).

## Files Changed

- `src/claude/python/runner.js`
  - Adds workspace snapshots and diffs.
  - Returns `filesCreated`, `filesUpdated`, and `trackingSkipped`.
- `src/routes/api/workspace/$sessionId.file.$filePath.ts`
  - Adds `raw` / `download` query support and Content-Type mapping.
  - Decodes URL path segments for file names with spaces.
- `src/components/agent-chat/tool-call-part.tsx`
  - Renders generated files list and image previews.
  - Builds raw/download links for workspace files.

## Limits and Safety

- Snapshot is capped (`MAX_TRACKED_FILES`) to avoid heavy traversal.
- Common large directories are ignored (`node_modules`, `.output`, `.git`, `__python__`).
- If snapshot tracking is skipped, no generated file list is shown.

## Manual Test

1. Run a Python MCP tool call that writes `plot.png` to workspace.
2. The tool call UI expands and shows:
   - `plot.png`
   - Inline preview
   - Open / Download links
3. Confirm `raw=1` loads the image in a new tab and `download=1` triggers a download.
