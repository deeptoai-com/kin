#!/usr/bin/env node
/**
 * Query Worker for Claude Agent SDK
 *
 * This worker runs in a separate process with its own CLAUDE_HOME environment.
 * Communication happens via stdin/stdout using JSON messages.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Read configuration from environment
const config = {
  model: process.env.ANTHROPIC_MODEL,
  cwd: process.env.WORKER_CWD || process.cwd(),
};

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
  try {
    const request = JSON.parse(inputData);
    const { prompt, sdkResumeId } = request;

    console.error(`[Worker] ======================================`);
    console.error(`[Worker] Starting query`);
    console.error(`[Worker]   CLAUDE_HOME: ${process.env.CLAUDE_HOME}`);
    console.error(`[Worker]   CWD (Workspace): ${config.cwd}`);
    console.error(`[Worker]   Model: ${config.model || 'default'}`);
    console.error(`[Worker]   Prompt length: ${prompt.length} chars`);
    if (sdkResumeId) {
      console.error(`[Worker]   SDK Resume ID: ${sdkResumeId}`);
    }

    // Temporarily disable Structured Outputs for debugging
    const useStructuredOutputs = process.env.ENABLE_STRUCTURED_OUTPUTS === 'true';

    console.error(`[Worker] Structured Outputs: ${useStructuredOutputs ? 'enabled' : 'disabled'}`);
    console.error(`[Worker] ======================================`);

    console.error('[Worker] Creating query stream...');

    // System prompt extension to guide Claude to use relative paths for file operations
    // Using preset form with 'append' to extend Claude Code's default system prompt
    const workspaceInstructions = `

IMPORTANT - File Access and Path Boundaries:

You have access to THREE distinct locations:

1. **Session Workspace** (Read/Write, Relative Paths)
   - Location: ${config.cwd}
   - Use for: Creating, editing, and managing user files
   - Path style: Relative paths only (e.g., "index.html", "src/App.jsx")
   - Examples: "index.html", "src/components/Header.tsx", "data/results.json"

2. **Project Source Code** (Read-Only, Absolute Path)
   - Location: /app
   - Use for: Reading framework code, dependencies, and system files
   - Path style: Must use path="/app/..." parameter
   - Examples: path="/app/src/routes", path="/app/package.json"
   - WARNING: This directory is READ-ONLY. Do not attempt to write here.

3. **User Skills** (Read-Only, via CLAUDE_HOME)
   - Location: ${process.env.CLAUDE_HOME}/.claude/skills/
   - Use for: Loading user-defined custom skills
   - Automatically loaded via settingSources: ['project']

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
- ONLY write to workspace (relative paths)
- NEVER write to /app (it's read-only)

Example good file operations:
- Read workspace: Read("src/App.tsx")
- Read project: Read({ file_path: "/app/src/lib/db.ts" })
- Glob workspace: glob("**/*.jsx")
- Glob project: glob("**/*.ts", { path: "/app/src" })
- Write file: Write("index.html", "<html>...</html>")

Example bad operations:
- Write("/app/src/file.ts", "...")  ← DON'T write to /app
- glob("../outside/*.ts")            ← DON'T go outside boundaries
- Read("/etc/passwd")                ← DON'T access system files`;

    const stream = query({
      prompt,
      options: {
        cwd: config.cwd,
        model: config.model,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Enable skills loading from project (.claude/skills in cwd)
        // Note: We use symlink to share user's skills across sessions, so only 'project' is needed
        settingSources: ['project'],
        // Use claude_code preset to get all default tools (which includes Skill tool)
        tools: { type: 'preset', preset: 'claude_code' },
        // Add system prompt to guide file path behavior
        // IMPORTANT: Use 'systemPrompt' (not 'systemMessage') with preset + append
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: workspaceInstructions,
        },
        // Enable Structured Outputs for artifact metadata (optional, controlled by env var)
        // IMPORTANT: Use 'outputFormat' parameter (not 'structuredOutput')
        ...(useStructuredOutputs && {
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

    for await (const event of stream) {
      eventCount++;
      console.error(`[Worker] Event #${eventCount}: ${event.type}${event.subtype ? '.' + event.subtype : ''}`);

      // Check if we're being terminated
      if (isTerminating) {
        console.error('[Worker] Terminating, stopping event processing');
        break;
      }
      // Send each event as a JSON line
      process.stdout.write(JSON.stringify({ type: 'event', event }) + '\n');
    }

    // Signal completion (only if not terminating)
    if (!isTerminating) {
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
