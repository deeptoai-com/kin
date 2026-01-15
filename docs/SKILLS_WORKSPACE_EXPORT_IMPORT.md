# Skill Export/Import (UI)

## Purpose

Provide a safe, user-facing way to turn workspace-created skills into downloadable `.skill` packages and import them into the Skills store, without allowing direct writes to `.claude/skills`.

## Problem & Constraints

- The agent runs with strict path security: Write/Edit is limited to the per-session workspace.  
- Skills live in `${CLAUDE_HOME}/.claude/skills/`, which is intentionally read-only for the agent.  
- When users ask to "create a skill", the model may try to write into `.claude/skills`, which is blocked.  
- We still want a Claude Desktop-like flow: create a skill in the conversation, preview/pack it, then download or import.

## Interaction Design

### Location
- Artifact panel header (right side), when the artifact is `SKILL.md`.
- Workspace panel header (right side), next to existing Download and Close buttons (when enabled).
- New icon button: "Package" (box icon) opens a dropdown menu.

### Skill Discovery
- Artifact panel: a skill is detected when the current artifact path ends in `SKILL.md`.
- Workspace panel: a skill is detected when workspace contains `SKILL.md`.
- Each `SKILL.md` defines a skill root (directory) and a skill name:
  - Root = folder containing `SKILL.md` (e.g., `translator/`)
  - Name = `name:` in frontmatter, fallback to folder name

### Actions
- **Download .skill**
  - Packages the skill folder as a zip and downloads as `<skillName>.skill`.
- **Import to Skills**
  - Uses server function to upload the skill directly into user skills.

### States & Feedback
- No `SKILL.md` found → menu shows disabled state.
- Busy state while packaging/importing.
- Toasts for success/failure.

## Implementation Details

### UI Entry Point
- `src/components/claude-chat/artifacts-panel.tsx`
  - Adds a dropdown menu in the Artifact header when the artifact is `SKILL.md`.
  - Scans workspace files via API to collect the skill root contents.
  - Offers download/import for the detected skill.
- `src/components/claude-chat/workspace-sandpack-panel.tsx`
  - Adds a dropdown menu in the Workspace panel header.
  - Scans workspace files for `SKILL.md`.
  - Offers download/import per detected skill root.

### Packaging Flow (Download)
1. Collect files under the skill root (or entire workspace if `SKILL.md` is at root).
2. Use `JSZip` to build an in-memory zip.
3. Download the zip as `<skillName>.skill`.

### Import Flow (Upload)
1. Collect files under the skill root.
2. Enforce limits:
   - Max 100 files
   - Max 10 MB total
3. Call `uploadUserSkillFn` to store the skill in the user’s isolated skill directory.

### Supporting API
- `src/server/function/skills.server.ts` → `uploadUserSkillFn`
  - Validates file count and size.
  - Writes to `${CLAUDE_HOME}/.claude/skills/user/{skillName}/`.

## Security Notes

- No direct writes to `.claude/skills` from the agent.  
- All skill imports go through authenticated server functions and existing size limits.  
- Workspace remains the only write target for agent tool calls.

## Usage Guidance

- Prefer creating skills inside a folder (e.g., `translator/SKILL.md`) so packaging/import does not include unrelated files.
- Ensure `SKILL.md` frontmatter includes a `name:` field; otherwise folder name is used.
- In chat, open the `SKILL.md` artifact and use the package icon to download or import.

## Future Enhancements (Optional)

- Add a backend packager endpoint to avoid large client-side zips.
- Add preview dialog before import (show `SKILL.md`).
- Add "Import All" if multiple skills are detected.
