#!/usr/bin/env node
/**
 * Query Worker for Claude Agent SDK
 *
 * This worker runs in a separate process with its own CLAUDE_HOME environment.
 * Communication happens via stdin/stdout using JSON messages.
 */

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createPathSecurity } from './src/claude/path-security.js';
import { resolveMcpServerConfigs } from './src/claude/mcp/manager.js';
import { runPython } from './src/claude/python/runner.js';
import { generateImage } from './src/claude/glm-image/runner.js';

// Read configuration from environment
const config = {
  model: process.env.ANTHROPIC_MODEL,
  cwd: process.env.WORKER_CWD || process.cwd(),
};

const PERMISSION_MODES = new Set([
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'delegate',
  'bypassPermissions',
]);

const BYPASS_USER_IDS = new Set(
  (process.env.CLAUDE_BYPASS_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const ALLOW_BASH_IN_BYPASS = process.env.CLAUDE_ALLOW_BASH === 'true';

// Agent-loop safety bounds (review Risk #5: no turn/wall-clock cap let a looping
// or abandoned run consume spend and hold the worker indefinitely).
// 0 / unset = unbounded (preserves prior behavior unless explicitly configured).
const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS) || 0;
const WALLCLOCK_TIMEOUT_MS = Number(process.env.AGENT_WALLCLOCK_TIMEOUT_MS) || 0;

function normalizePermissionMode(mode) {
  if (!mode) {
    return 'default';
  }
  if (PERMISSION_MODES.has(mode)) {
    return mode;
  }
  return 'default';
}

function resolvePermissionMode(mode, userId) {
  if (mode !== undefined) {
    return normalizePermissionMode(mode);
  }
  const normalized = normalizePermissionMode(process.env.CLAUDE_PERMISSION_MODE);
  if (normalized === 'bypassPermissions') {
    return userId && BYPASS_USER_IDS.has(userId) ? 'bypassPermissions' : 'default';
  }
  return normalized;
}

function resolveDisallowedTools(permissionMode, requestedDisallowedTools, allowBash) {
  if (Array.isArray(requestedDisallowedTools)) {
    return requestedDisallowedTools;
  }
  const effectiveAllowBash = allowBash === undefined ? ALLOW_BASH_IN_BYPASS : allowBash;
  if (permissionMode === 'bypassPermissions' && effectiveAllowBash) {
    return [];
  }
  return ['Bash'];
}

function normalizeSkillSlug(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9-_]/g, '_');
}

async function loadSkillContext(skillSlug, workspaceCwd) {
  const normalized = normalizeSkillSlug(skillSlug);
  if (!normalized) return null;
  const candidates = [
    path.join(workspaceCwd, '.claude', 'skills', normalized, 'SKILL.md'),
    path.join(workspaceCwd, '.claude', 'skills', 'user', normalized, 'SKILL.md'),
  ];

  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, 'utf8');
      if (content && content.trim()) {
        console.error(`[Worker] Loaded SKILL.md (${content.length} chars) from ${filePath}`);
        return { slug: normalized, content };
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.error(`[Worker] Failed to read SKILL.md at ${filePath}:`, error.message || error);
      }
    }
  }

  console.error(`[Worker] SKILL.md not found for ${normalized}`);
  return null;
}

// Define Artifact Schema for Structured Outputs
// This schema guides Claude to provide metadata for artifacts (HTML, SVG, React, Markdown)
const ArtifactFileSchema = z.object({
  path: z.string().describe('File path (e.g., "App.jsx", "styles.css")'),
  content: z.string().describe('Complete file content'),
  language: z
    .enum(['html', 'css', 'javascript', 'typescript', 'jsx', 'tsx', 'svg', 'markdown', 'json'])
    .describe('Programming language or file type'),
});

const ArtifactMetadataSchema = z.object({
  title: z.string().describe('Descriptive title for the artifact (e.g., "Pomodoro Timer")'),
  description: z
    .string()
    .optional()
    .describe('Detailed description of what the artifact does and how it works'),
  type: z
    .enum(['html', 'svg', 'markdown', 'react'])
    .describe('Type of artifact: html, svg, markdown, or react component'),
  files: z
    .array(ArtifactFileSchema)
    .min(1)
    .describe('Array of files that make up this artifact'),
});

const STRUCTURED_OUTPUT_FILE_REGEX = /(?:^|[^\w])(?:[^\s"'`<>]+)\.(md|html|svg|json|tsx|jsx|css|js)(?=$|[^\w])/i;

function hasStructuredOutputFileHint(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) return false;
  return STRUCTURED_OUTPUT_FILE_REGEX.test(prompt);
}

// Convert Zod schema to JSON Schema for SDK
const artifactJsonSchema = zodToJsonSchema(ArtifactMetadataSchema, {
  name: 'ArtifactMetadata',
  $refStrategy: 'root', // Use 'root' for better compatibility
});

// Track if we're being terminated
let isTerminating = false;

// Handle graceful shutdown signals
process.on('SIGTERM', () => {
  console.error('[Worker] Received SIGTERM, shutting down gracefully');
  isTerminating = true;
  // Give a brief moment for cleanup, then exit
  setTimeout(() => {
    process.exit(0);
  }, 100);
});

process.on('SIGINT', () => {
  console.error('[Worker] Received SIGINT, shutting down');
  isTerminating = true;
  process.exit(0);
});

// Read query request from stdin
let inputData = '';

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  // Declared here (not inside try) so the catch block can clear it.
  let watchdog = null;
  try {
    const request = JSON.parse(inputData);
    const {
      prompt,
      skillSlug,
      sdkResumeId,
      permissionMode: requestedPermissionMode,
      disallowedTools: requestedDisallowedTools,
      allowBash: requestedAllowBash = false,
      userId,
    } = request;
    const permissionMode = resolvePermissionMode(requestedPermissionMode, userId);
    const disallowedTools = resolveDisallowedTools(
      permissionMode,
      requestedDisallowedTools,
      requestedAllowBash
    );
    // Risk #2 fix: the SDK's bypassPermissions mode auto-allows every tool and
    // never consults canUseTool, which disables our cross-user/path-security guard.
    // So we DON'T pass raw bypassPermissions to the SDK.
    //
    // We have NO interactive HITL round-trip yet, so SDK 'default' mode is unusable:
    // it pauses to "ask" on every tool, and with no responder the run aborts
    // (verified: default -> error_during_execution, file never written). Instead we
    // map our 3 product modes to NON-INTERACTIVE SDK modes that keep canUseTool active:
    //   - 'plan'  (Explore) -> SDK 'plan'        : read-only, no edits
    //   - everything else   -> SDK 'acceptEdits' : file edits auto-allowed, but
    //                                              canUseTool STILL runs (path/tenant
    //                                              guard intact; Bash governed by
    //                                              disallowedTools). No abort.
    //   - bypass + CLAUDE_DANGEROUS_DISABLE_GUARD=true -> raw 'bypassPermissions' (debug only).
    // True interactive "Ask" mode arrives with Phase 3 Wave 2 (HITL round-trip).
    const dangerousDisableGuard =
      permissionMode === 'bypassPermissions' &&
      process.env.CLAUDE_DANGEROUS_DISABLE_GUARD === 'true';
    const sdkPermissionMode = dangerousDisableGuard
      ? 'bypassPermissions'
      : permissionMode === 'plan'
        ? 'plan'
        : 'acceptEdits';
    const { canUseTool, debugInfo } = createPathSecurity({
      workspace: config.cwd,
      userId,
      claudeHome: process.env.CLAUDE_HOME,
      sessionsRoot: process.env.CLAUDE_SESSIONS_ROOT,
    });

    console.error(`[Worker] ======================================`);
    console.error(`[Worker] Starting query`);
    console.error(`[Worker]   CLAUDE_HOME: ${process.env.CLAUDE_HOME}`);
    console.error(`[Worker]   CWD (Workspace): ${config.cwd}`);
    console.error(`[Worker]   Model: ${config.model || 'default'}`);
    console.error(`[Worker]   Permission Mode: ${permissionMode}`);
    console.error(`[Worker]   Disallowed Tools: ${disallowedTools.join(', ') || '(none)'}`);
    if (process.env.CLAUDE_SECURITY_DEBUG === 'true') {
      console.error(`[Worker]   Path Security: ${JSON.stringify(debugInfo)}`);
    }
    console.error(`[Worker]   Prompt length: ${prompt.length} chars`);
    if (sdkResumeId) {
      console.error(`[Worker]   SDK Resume ID: ${sdkResumeId}`);
    }
    if (skillSlug) {
      console.error(`[Worker]   Selected Skill: ${skillSlug}`);
    }

    const useStructuredOutputs = process.env.ENABLE_STRUCTURED_OUTPUTS === 'true';
    const shouldUseStructuredOutputs = useStructuredOutputs && hasStructuredOutputFileHint(prompt);

    console.error(`[Worker] Structured Outputs: ${
      useStructuredOutputs
        ? (shouldUseStructuredOutputs ? 'enabled (file hint)' : 'suppressed (no file hint)')
        : 'disabled'
    }`);
    console.error(`[Worker] ======================================`);

    console.error('[Worker] Creating query stream...');

    const pythonRunTool = tool(
      'run',
      'Execute Python code inside the session workspace (no shell).',
      {
        code: z.string().min(1).describe('Python code to execute'),
        timeoutMs: z.number().int().positive().optional().describe('Execution timeout in milliseconds'),
        maxOutputBytes: z.number().int().positive().optional().describe('Maximum stdout/stderr bytes'),
      },
      async (args) => {
        try {
          const result = await runPython({
            code: args.code,
            cwd: config.cwd,
            timeoutMs: args.timeoutMs,
            maxOutputBytes: args.maxOutputBytes,
          });

          const isError = Boolean(
            result.timedOut ||
            result.killedByLimit ||
            (typeof result.exitCode === 'number' && result.exitCode !== 0)
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result),
              isError,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
              isError: true,
            }],
          };
        }
      }
    );

    const pythonMcpServer = createSdkMcpServer({
      name: 'python',
      tools: [pythonRunTool],
    });

    // GLM-Image MCP Tool - Image generation using Zhipu API
    const glmImageGenerateTool = tool(
      'generate',
      'Generate an image using Zhipu GLM-Image API (cogview series models). Returns the saved image path.',
      {
        prompt: z.string().min(1).describe('Image generation prompt (required)'),
        imagePath: z.string().optional().describe('Output image path relative to workspace (default: generated.png)'),
        model: z.literal('glm-image').optional().describe('Model ID (default: glm-image)'),
        size: z.enum([
          '1024x1024', '1280x1280', '768x1344', '1344x768',
          '864x1152', '1152x864', '1024x1792', '1792x1024',
          '960x1280', '1280x960',
        ]).optional().describe('Image size (default: 1024x1024). For slides use 1792x1024 (16:9)'),
        quality: z.enum(['hd', 'standard']).optional().describe('Quality level (default: hd)'),
        watermark: z.boolean().optional().describe('Enable watermark (default: false)'),
      },
      async (args) => {
        try {
          const result = await generateImage({
            prompt: args.prompt,
            imagePath: args.imagePath,
            cwd: config.cwd,
            model: args.model,
            size: args.size,
            quality: args.quality,
            watermark: args.watermark,
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
              isError: true,
            }],
          };
        }
      }
    );

    const glmImageMcpServer = createSdkMcpServer({
      name: 'glm-image',
      tools: [glmImageGenerateTool],
    });

    const { mcpServers, allowedTools } = await resolveMcpServerConfigs({
      userId,
      userHome: process.env.CLAUDE_HOME,
      sdkServers: {
        python: pythonMcpServer,
        'glm-image': glmImageMcpServer,
      },
    });

    console.error(`[Worker] MCP Servers: ${Object.keys(mcpServers).join(', ') || '(none)'}`);
    console.error(`[Worker] Allowed Tools: ${allowedTools.length} entries`);

    // System prompt extension to guide Claude to use relative paths for file operations
    // Using preset form with 'append' to extend Claude Code's default system prompt
    const userRoot = process.env.CLAUDE_HOME || '';
    const workspaceInstructions = `

IMPORTANT - File Access and Path Boundaries:

You have access to FOUR distinct locations:

1. **Session Workspace** (Read/Write, PRIMARY - use this by default)
   - Location: ${config.cwd}
   - Use for: Creating, editing, and managing user files
   - Path style: Relative paths only (e.g., "index.html", "src/App.jsx")
   - Examples: "index.html", "src/components/Header.tsx", "data/results.json"
   - THIS IS YOUR DEFAULT WORKING DIRECTORY for all file operations.

2. **User Home Directory** (Read/Write, for ~/Documents, ~/Downloads, etc.)
   - Location: ${userRoot}
   - Use for: Files that need to persist across sessions or be accessible outside workspace
   - Path style: Absolute paths starting with ${userRoot}
   - Examples: "${userRoot}/Documents/report.md", "${userRoot}/Downloads/data.csv"
   - Use this ONLY when the user explicitly requests a specific location like ~/Documents.

3. **Project Source Code** (Read-Only, Absolute Path)
   - Location: /app
   - Use for: Reading framework code, dependencies, and system files
   - Path style: Must use path="/app/..." parameter
   - Examples: path="/app/src/routes", path="/app/package.json"
   - WARNING: This directory is READ-ONLY. Do not attempt to write here.

4. **User Skills** (Read-Only, via CLAUDE_HOME)
   - Location: ${userRoot}/.claude/skills/
   - Use for: Loading user-defined custom skills
   - Automatically loaded via settingSources: ['project']
   - READ-ONLY: Never Write/Edit here. The workspace .claude path is a symlink.
   - To create a new skill: write files under the workspace (e.g., "my-skill/SKILL.md"),
     then export/import via the Skill actions in the Artifact panel (or Workspace panel),
     and do NOT write into .claude.

SKILL INSTRUCTION OVERRIDE RULE:

When executing skills, if a skill instructs you to write to a specific path like ~/Documents or ~/Desktop:
1. **PREFER workspace**: Unless the user explicitly requested that location, write to the workspace instead.
2. **Transform paths**: Convert "~/Documents/report.md" → "report.md" (workspace-relative)
3. **Ask if unclear**: If unsure, ask the user where they want the file saved.
4. **User home is allowed**: If the user explicitly wants ~/Documents, you CAN write there (${userRoot}/Documents/...).

TOOL USAGE GUIDELINES:

**Glob Tool** (file search):
- To search workspace: Use glob("pattern") with relative pattern
- To search project source: Use glob("pattern", { path: "/app" })
- Examples:
  * glob("**/*.ts") → searches workspace only
  * glob("**/*.ts", { path: "/app/src/routes" }) → searches project routes

**Read Tool**:
- Automatically handles both workspace and /app paths
- Use relative paths for workspace files
- Use absolute /app/... paths for project source

**Write/Edit Tools**:
- DEFAULT: Write to workspace (relative paths)
- ALLOWED: Write to user home (${userRoot}/...) if user explicitly requests
- NEVER write to /app (it's read-only)
- NEVER write to .claude/ or ${userRoot}/.claude/skills/

**Python Tool (MCP)**:
- Use mcp__python__run to execute Python code
- Runs inside the session workspace (no shell)
- Returns stdout/stderr and exit metadata

Example good file operations:
- Read workspace: Read("src/App.tsx")
- Read project: Read({ file_path: "/app/src/lib/db.ts" })
- Glob workspace: glob("**/*.jsx")
- Glob project: glob("**/*.ts", { path: "/app/src" })
- Write to workspace: Write("index.html", "<html>...</html>")
- Write to user home: Write("${userRoot}/Documents/report.md", "...") - only if user requests

Example bad operations:
- Write("/app/src/file.ts", "...")  ← DON'T write to /app
- glob("../outside/*.ts")            ← DON'T go outside boundaries
- Read("/etc/passwd")                ← DON'T access system files
- Write(".claude/skills/my-skill/SKILL.md", "...")  ← DON'T write to skills`;

    const skillContext = await loadSkillContext(skillSlug, config.cwd);
    const skillAppend = skillContext
      ? `\n\n[Explicit Skill Selected: ${skillContext.slug}]\n${skillContext.content}\n[End Skill]\n`
      : '';

    const stream = query({
      prompt,
      options: {
        cwd: config.cwd,
        model: config.model,
        includePartialMessages: true, // Enable streaming events for real-time UI updates
        permissionMode: sdkPermissionMode,
        disallowedTools,
        // Risk #2: keep the path-security guard active in ALL modes except the
        // explicit dangerous-debug escape hatch.
        ...(dangerousDisableGuard && { allowDangerouslySkipPermissions: true }),
        ...(!dangerousDisableGuard && { canUseTool }),
        // Note: maxThinkingTokens is handled by SDK's claude_code preset automatically
        // Enable skills loading from project (.claude/skills in cwd)
        // Note: We use symlink to share user's skills across sessions, so only 'project' is needed
        settingSources: ['project'],
        // Cap the agentic loop turns when configured (Risk #5). 0 = unbounded.
        ...(MAX_TURNS > 0 && { maxTurns: MAX_TURNS }),
        // Use claude_code preset to get all default tools (which includes Skill tool)
        tools: { type: 'preset', preset: 'claude_code' },
        // MCP configuration
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        // allowedTools: control which MCP tools can be used
        ...(allowedTools.length > 0 && { allowedTools }),
        // Note: ENABLE_TOOL_SEARCH is set in ws-server.mjs workerEnv
        // Do NOT set env here - SDK treats it as complete environment, clearing PATH
        // Add system prompt to guide file path behavior
        // IMPORTANT: Use 'systemPrompt' (not 'systemMessage') with preset + append
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `${workspaceInstructions}${skillAppend}`,
        },
        // Enable Structured Outputs for artifact metadata (optional, controlled by env var)
        // IMPORTANT: Use 'outputFormat' parameter (not 'structuredOutput')
        ...(shouldUseStructuredOutputs && {
          outputFormat: {
            type: 'json_schema',
            schema: artifactJsonSchema,
          },
        }),
        ...(sdkResumeId && { resume: sdkResumeId }),
      },
    });

    console.error('[Worker] Query stream created, starting event iteration...');
    let eventCount = 0;
    // Track text waiting for stop_reason from message_delta
    let pendingTextForStopReason = null;
    // Track current turn ID from message_start (correlation ID for grouping events)
    let currentTurnId = null;

    for await (const event of stream) {
      eventCount++;
      console.error(`[Worker] Event #${eventCount}: ${event.type}${event.subtype ? '.' + event.subtype : ''}`);

      // Check if we're being terminated
      if (isTerminating) {
        console.error('[Worker] Terminating, stopping event processing');
        break;
      }
      const parentToolUseId = event && typeof event === 'object' && 'parent_tool_use_id' in event
        ? event.parent_tool_use_id
        : null;

      if (event.type === 'assistant' && event.message?.content) {
        let textContent = '';
        const blocks = Array.isArray(event.message.content) ? event.message.content : [];
        for (const block of blocks) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            textContent += block.text;
          }
        }
        if (textContent) {
          pendingTextForStopReason = textContent;
        }
      }

      if (event.type === 'stream_event' && event.event) {
        const streamEvent = event.event;

        // Capture turn ID from message_start (arrives before any content events)
        if (streamEvent.type === 'message_start') {
          const messageId = streamEvent.message?.id;
          if (messageId) {
            currentTurnId = messageId;
          }
        }

        // Emit text_delta events for streaming UI updates
        if (streamEvent.type === 'content_block_delta'
          && streamEvent.delta?.type === 'text_delta'
          && typeof streamEvent.delta.text === 'string') {
          process.stdout.write(JSON.stringify({
            type: 'event',
            event: {
              type: 'text_delta',
              text: streamEvent.delta.text,
              turnId: currentTurnId ?? undefined,
              parentToolUseId: parentToolUseId ?? undefined,
            },
          }) + '\n');
        }

        // message_delta contains the actual stop_reason - emit pending text now
        if (streamEvent.type === 'message_delta') {
          const stopReason = streamEvent.delta?.stop_reason;
          if (pendingTextForStopReason) {
            const isIntermediate = stopReason === 'tool_use';
            process.stdout.write(JSON.stringify({
              type: 'event',
              event: {
                type: 'text_complete',
                text: pendingTextForStopReason,
                isIntermediate,
                turnId: currentTurnId ?? undefined,
                parentToolUseId: parentToolUseId ?? undefined,
              },
            }) + '\n');
            pendingTextForStopReason = null;
          }
        }
      }

      // Send each event as a JSON line. C4 backpressure (producer side): if the
      // pipe to the parent is full (parent paused reading because the WS client is
      // slow), await 'drain' before continuing so the SDK event pump stops instead
      // of buffering unboundedly in this worker.
      const ok = process.stdout.write(JSON.stringify({ type: 'event', event }) + '\n');
      if (!ok) {
        await new Promise((resolve) => process.stdout.once('drain', resolve));
      }
    }

    // Signal completion (only if not terminating)
    if (!isTerminating) {
      // Defensive: flush any pending text that wasn't emitted
      if (pendingTextForStopReason) {
        process.stdout.write(JSON.stringify({
          type: 'event',
          event: {
            type: 'text_complete',
            text: pendingTextForStopReason,
            isIntermediate: false,
            turnId: currentTurnId ?? undefined,
          },
        }) + '\n');
        pendingTextForStopReason = null;
      }
      process.stdout.write(JSON.stringify({ type: 'done' }) + '\n');
    }
    process.exit(0);
  } catch (error) {
    console.error('[Worker] Error:', error);
    console.error('[Worker] Error stack:', error instanceof Error ? error.stack : 'N/A');
    process.stdout.write(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }) + '\n');
    process.exit(1);
  }
});
