#!/usr/bin/env node
/**
 * WebSocket Server for Claude Agent Chat
 *
 * This is a standalone WebSocket server that runs alongside the main Nitro server.
 * For production use with Docker, run this as a sidecar or use the combined startup script.
 *
 * Environment variables:
 * - WS_PORT: WebSocket server port (default: 3001)
 * - APP_URL: Main application URL for auth (default: http://localhost:5000)
 * - CLAUDE_SESSIONS_ROOT: Root directory for user sessions (default: /data/users)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { mkdir, readFile, readdir, access, symlink, unlink, lstat, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

// Get directory of current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'ws-query-worker.mjs');

// Configuration
const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);
const APP_URL = process.env.APP_URL || 'http://localhost:5000';
const SESSIONS_ROOT = process.env.CLAUDE_SESSIONS_ROOT || '/data/users';

const config = {
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
  model: process.env.ANTHROPIC_MODEL,
  cwd: process.cwd(),
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

// Note: Thinking/reasoning is handled by SDK's claude_code preset automatically
// No need to explicitly pass maxThinkingTokens - SDK uses sensible defaults

function normalizePermissionMode(mode) {
  if (!mode) {
    return 'default';
  }
  if (PERMISSION_MODES.has(mode)) {
    return mode;
  }
  return 'default';
}

function resolvePermissionMode(userId, requestedMode = process.env.CLAUDE_PERMISSION_MODE) {
  const normalized = normalizePermissionMode(requestedMode);
  if (normalized === 'bypassPermissions') {
    if (userId && BYPASS_USER_IDS.has(userId)) {
      return 'bypassPermissions';
    }
    return 'default';
  }
  return normalized;
}

function resolveDisallowedTools(permissionMode, allowBash) {
  if (permissionMode === 'bypassPermissions' && allowBash) {
    return [];
  }
  return ['Bash'];
}

/**
 * Fetch permission info from the API
 * Returns organization-based permission settings or falls back to environment variables
 */
async function fetchPermissionInfo(cookie) {
  try {
    const response = await fetch(`${APP_URL}/api/auth/permission-info`, {
      headers: { cookie },
    });

    if (!response.ok) {
      console.warn('[WS Server] Failed to fetch permission info:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[WS Server] Error fetching permission info:', error);
    return null;
  }
}

// Handle uncaught errors with detailed logging and flush
process.on('uncaughtException', (err) => {
  console.error('==========================================');
  console.error('[WS Server] UNCAUGHT EXCEPTION DETECTED');
  console.error('[WS Server] Error:', err);
  console.error('[WS Server] Stack:', err.stack);
  console.error('[WS Server] Type:', err.constructor.name);
  console.error('==========================================');

  // Force flush console output
  if (process.stdout.write('')) {
    process.stdout.once('drain', () => {
      console.error('[WS Server] Console flushed, exiting with code 1');
      process.exit(1);
    });
  } else {
    // If buffer is full, wait a bit then exit
    setTimeout(() => {
      console.error('[WS Server] Force exit after exception');
      process.exit(1);
    }, 100);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('==========================================');
  console.error('[WS Server] UNHANDLED REJECTION DETECTED');
  console.error('[WS Server] Reason:', reason);
  console.error('[WS Server] Promise:', promise);
  if (reason instanceof Error) {
    console.error('[WS Server] Stack:', reason.stack);
  }
  console.error('==========================================');

  // Force flush console output
  if (process.stdout.write('')) {
    process.stdout.once('drain', () => {
      console.error('[WS Server] Console flushed, exiting with code 1');
      process.exit(1);
    });
  } else {
    setTimeout(() => {
      console.error('[WS Server] Force exit after rejection');
      process.exit(1);
    }, 100);
  }
});

// Track process exit
process.on('exit', (code) => {
  console.error('[WS Server] ========== PROCESS EXIT ==========');
  console.error('[WS Server] Exit code:', code);
  console.error('[WS Server] ===============================');
});

process.on('SIGTERM', () => {
  console.error('[WS Server] ========== RECEIVED SIGTERM ==========');
  console.error('[WS Server] Process will be terminated');
  console.error('[WS Server] ================================');
});

process.on('SIGINT', () => {
  console.error('[WS Server] ========== RECEIVED SIGINT ==========');
  console.error('[WS Server] Process will be interrupted');
  console.error('[WS Server] ===============================');
});

process.on('SIGHUP', () => {
  console.error('[WS Server] ========== RECEIVED SIGHUP ==========');
  console.error('[WS Server] Terminal disconnected signal');
  console.error('[WS Server] ===============================');
});

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Track initialized directories
const initializedDirs = new Set();

// Map workspace sessionId to SDK sessionId for resume
// Structure: { workspaceSessionId: sdkSessionId }
const sessionMapping = new Map();

/**
 * Persist session to database via API
 * @param {string} cookie - User's auth cookie
 * @param {string} workspaceSessionId - Our workspace session ID (used as sdkSessionId in DB)
 * @param {string} realSdkSessionId - The actual SDK's session ID
 * @param {string} claudeHomePath - Path to CLAUDE_HOME
 * @param {string} [title] - Optional session title (extracted from first user message)
 */
async function persistSession(cookie, workspaceSessionId, realSdkSessionId, claudeHomePath, title) {
  try {
    const response = await fetch(`${APP_URL}/api/agent-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        sdkSessionId: workspaceSessionId,
        claudeHomePath,
        realSdkSessionId,
        // Use first user message as title (truncated to 50 chars)
        ...(title && { title }),
      }),
    });

    if (!response.ok) {
      console.error('[WS Server] Failed to persist session:', response.status, await response.text());
      return;
    }

    const result = await response.json();
    console.log(`[WS Server] Session persisted: ${result.id} (created: ${result.created})`);
  } catch (error) {
    console.error('[WS Server] Error persisting session:', error);
  }
}

/**
 * Load session data from database
 * Returns full session info including realSdkSessionId and claudeHomePath
 */
async function loadSessionFromDb(cookie, workspaceSessionId) {
  try {
    const response = await fetch(`${APP_URL}/api/agent-sessions/by-sdk-id/${workspaceSessionId}`, {
      headers: { cookie },
    });

    if (!response.ok) {
      console.log(`[WS Server] Session not found in DB: ${workspaceSessionId}`);
      return null;
    }

    const data = await response.json();
    console.log(`[WS Server] Loaded session from DB: realSdkSessionId=${data.realSdkSessionId}, claudeHomePath=${data.claudeHomePath}`);
    return data;
  } catch (error) {
    console.error('[WS Server] Error loading session from DB:', error);
    return null;
  }
}

/**
 * Locate session JSONL file across project directories
 * JSONL files are stored at: CLAUDE_HOME/.claude/projects/{project}/{sessionId}.jsonl
 */
async function locateSessionFile(claudeHome, sessionId) {
  const projectsRoot = path.join(claudeHome, '.claude', 'projects');

  try {
    await access(projectsRoot);
  } catch {
    console.log(`[WS Server] Projects root not found: ${projectsRoot}`);
    return null;
  }

  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    const projectDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(projectsRoot, e.name));

    for (const projectDir of projectDirs) {
      const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
      try {
        await access(sessionPath);
        return sessionPath;
      } catch {
        // Continue to next project directory
      }
    }
  } catch (error) {
    console.error('[WS Server] Error scanning project directories:', error);
  }

  return null;
}

/**
 * Parse JSONL content into SDK messages
 * Normalizes sessionId to session_id and filters invalid entries
 */
function parseJsonlContent(content) {
  if (!content) return [];

  const lines = content.split(/\r?\n/);
  const messages = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);

      const parsedType = typeof parsed.type === 'string' ? parsed.type.toLowerCase() : '';

      // Skip summary type messages
      if (parsedType === 'summary') continue;

      // Normalize sessionId to session_id
      const normalized = { ...parsed };
      if ('sessionId' in normalized) {
        normalized.session_id = normalized.sessionId;
        delete normalized.sessionId;
      }

      messages.push(normalized);
    } catch {
      // Skip malformed JSON lines
      continue;
    }
  }

  return messages;
}

/**
 * Load messages for a session from JSONL file
 * @param {string} claudeHome - Path to CLAUDE_HOME for this user
 * @param {string} sessionId - SDK session ID to load messages for
 * @returns {Promise<Array>} Array of SDK messages
 */
async function loadMessages(claudeHome, sessionId) {
  if (!sessionId) {
    return [];
  }

  const filePath = await locateSessionFile(claudeHome, sessionId);
  if (!filePath) {
    console.log(`[WS Server] Session file not found for: ${sessionId}`);
    return [];
  }

  try {
    console.log(`[WS Server] Loading messages from: ${filePath}`);
    const content = await readFile(filePath, 'utf8');
    const messages = parseJsonlContent(content);
    console.log(`[WS Server] Loaded ${messages.length} messages for session: ${sessionId}`);
    return messages;
  } catch (error) {
    console.error(`[WS Server] Failed to read session file: ${filePath}`, error);
    return [];
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * Sanitize userId/sessionId to prevent path traversal attacks
 */
function sanitizeId(id) {
  return id.replace(/[\/\\\.]+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Get user-specific CLAUDE_HOME path
 */
function getClaudeHome(userId) {
  const safeUserId = sanitizeId(userId);
  return path.join(SESSIONS_ROOT, safeUserId);
}

/**
 * Get session-specific workspace path
 * Structure: /data/users/{userId}/sessions/{sessionId}/workspace/
 */
function getSessionWorkspace(userId, sessionId) {
  const safeUserId = sanitizeId(userId);
  const safeSessionId = sanitizeId(sessionId);
  return path.join(SESSIONS_ROOT, safeUserId, 'sessions', safeSessionId, 'workspace');
}

/**
 * Ensure directory exists
 */
async function ensureDirExists(dirPath) {
  if (initializedDirs.has(dirPath)) {
    return;
  }

  try {
    await mkdir(dirPath, { recursive: true });
    initializedDirs.add(dirPath);
    console.log(`[WS Server] Created directory: ${dirPath}`);
  } catch (error) {
    console.error(`[WS Server] Failed to create directory:`, error);
    throw error;
  }
}

/**
 * Ensure .claude symlink exists in workspace pointing to user's .claude directory
 * This allows SDK to find skills/settings in the user's directory while working in session workspace
 */
async function ensureClaudeSymlink(workspacePath, claudeHome) {
  const symlinkPath = path.join(workspacePath, '.claude');
  const targetPath = path.join(claudeHome, '.claude');

  try {
    // Check if symlink already exists
    const stats = await lstat(symlinkPath);

    if (stats.isSymbolicLink()) {
      // Symlink exists, verify it points to correct target
      console.log(`[WS Server] .claude symlink already exists in workspace`);
      return;
    } else {
      // Path exists but is not a symlink, remove it
      console.log(`[WS Server] .claude exists but is not a symlink, removing...`);
      await unlink(symlinkPath);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[WS Server] Error checking .claude symlink:`, error);
      throw error;
    }
    // ENOENT is expected if symlink doesn't exist yet
  }

  // Create the symlink
  try {
    await symlink(targetPath, symlinkPath, 'dir');
    console.log(`[WS Server] Created .claude symlink: ${symlinkPath} -> ${targetPath}`);
  } catch (error) {
    console.error(`[WS Server] Failed to create .claude symlink:`, error);
    throw error;
  }
}

/**
 * Verify that skills are accessible through the .claude symlink
 * This health check ensures SDK can actually load skills from the workspace
 *
 * @param {string} workspacePath - Session workspace path
 * @param {string} claudeHome - User's CLAUDE_HOME directory
 */
async function verifySkillsAccess(workspacePath, claudeHome) {
  const symlinkPath = path.join(workspacePath, '.claude');
  const skillsPath = path.join(workspacePath, '.claude', 'skills');
  const targetSkillsPath = path.join(claudeHome, '.claude', 'skills');

  // Step 1: Check symlink status
  let symlinkStatus = 'unknown';
  let symlinkTarget = null;
  try {
    const stats = await lstat(symlinkPath);
    if (stats.isSymbolicLink()) {
      symlinkStatus = 'valid';
      // Read the actual target
      const { readlink } = await import('node:fs/promises');
      symlinkTarget = await readlink(symlinkPath);
    } else {
      symlinkStatus = 'not_symlink';
    }
  } catch (error) {
    symlinkStatus = error.code === 'ENOENT' ? 'missing' : `error:${error.code}`;
  }

  // Step 2: Check target directory exists
  let targetExists = false;
  try {
    await access(targetSkillsPath);
    targetExists = true;
  } catch {
    targetExists = false;
  }

  // Step 3: Try to access skills through the symlink
  try {
    await access(skillsPath);

    const skillDirs = await readdir(skillsPath, { withFileTypes: true });
    const skills = skillDirs.filter(entry => entry.isDirectory()).map(entry => entry.name);

    if (skills.length > 0) {
      console.log(`[WS Server] ✓ Skills accessible: ${skills.length} skills found [${skills.join(', ')}]`);
    } else {
      console.log(`[WS Server] ⚠ Skills directory accessible but empty`);
    }

    return true;
  } catch (error) {
    // Enhanced error logging with diagnostic info
    const diagnostic = {
      symlinkStatus,
      symlinkTarget,
      targetSkillsPath,
      targetExists,
      errorCode: error.code,
    };

    if (error.code === 'ENOENT') {
      if (!targetExists) {
        // This is expected if user never enabled any skills
        console.log(`[WS Server] ℹ Skills directory not found (user has no skills enabled)`);
        console.log(`[WS Server]   diagnostic: ${JSON.stringify(diagnostic)}`);
      } else {
        // Target exists but can't access through symlink - this is a problem
        console.warn(`[WS Server] ⚠ Skills directory not accessible through symlink`);
        console.warn(`[WS Server]   diagnostic: ${JSON.stringify(diagnostic)}`);
      }
    } else {
      console.error(`[WS Server] ✗ Skills access error: ${error.message}`);
      console.error(`[WS Server]   diagnostic: ${JSON.stringify(diagnostic)}`);
    }
    return false;
  }
}

/**
 * Authenticate request using session cookie
 */
async function authenticateRequest(request) {
  try {
    const cookie = request.headers.cookie || '';
    const response = await fetch(`${APP_URL}/api/auth/get-session`, {
      headers: { cookie },
    });

    if (!response.ok) return null;

    const data = await response.json();
    console.log('[WS Server] Auth response:', JSON.stringify({ userId: data?.user?.id, email: data?.user?.email }));
    if (!data?.user?.id) return null;

    return { id: data.user.id };
  } catch (error) {
    console.error('[WS Server] Auth error:', error);
    return null;
  }
}

/**
 * Send message to WebSocket
 */
function sendMessage(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Create a new empty session without requiring a user message
 * This is called when user explicitly clicks "New Session" button
 */
async function handleCreateSession(ws) {
  console.log('[WS Server] Creating new empty session');

  try {
    // Generate new workspace session ID
    const workspaceSessionId = generateSessionId();

    // Get user-specific CLAUDE_HOME
    const claudeHome = getClaudeHome(ws.userId);
    await ensureDirExists(claudeHome);

    // Get session-specific workspace
    const workspacePath = getSessionWorkspace(ws.userId, workspaceSessionId);
    await ensureDirExists(workspacePath);

    // Create .claude symlink in workspace
    await ensureClaudeSymlink(workspacePath, claudeHome);

    // Verify skills are accessible
    await verifySkillsAccess(workspacePath, claudeHome);

    console.log(`[WS Server] Created empty session ${workspaceSessionId} for user ${ws.userId}`);
    console.log(`[WS Server]   CLAUDE_HOME: ${claudeHome}`);
    console.log(`[WS Server]   Workspace: ${workspacePath}`);

    // Store session ID for future chat messages
    ws.workspaceSessionId = workspaceSessionId;

    // Persist empty session to DB immediately so it appears in history list
    // Title will be updated when first message is sent
    await persistSession(ws.cookie, workspaceSessionId, null, claudeHome, '未命名');

    // Send session_init immediately (session is ready but empty)
    sendMessage(ws, {
      type: 'session_init',
      sessionId: workspaceSessionId,
      sdkSessionId: null,  // Will be set when first message is sent
      userId: ws.userId,
    });
  } catch (error) {
    console.error('[WS Server] Error creating session:', error);
    sendMessage(ws, {
      type: 'error',
      code: 'server_error',
      message: error instanceof Error ? error.message : String(error),
      retriable: true,
    });
  }
}

/**
 * Handle chat message using child process for user and session isolation
 * Note: Thinking/reasoning is handled by SDK's claude_code preset automatically
 */
async function handleChat(ws, prompt, resumeSessionId, options = {}) {
  const { silentInit = false } = options;
  // Kill any existing worker for this connection
  if (ws.workerProcess) {
    console.log('[WS Server] Killing existing worker process');
    ws.workerProcess.kill();
    ws.workerProcess = null;
  }

  console.log('[WS Server] handleChat called with prompt length:', prompt.length);
  console.log('[WS Server] resumeSessionId:', resumeSessionId || 'none');

  try {
    // Get or generate workspace session ID
    const workspaceSessionId = resumeSessionId || generateSessionId();

    // Look up SDK session ID for resume (if this is a continuation)
    const sdkResumeId = resumeSessionId ? sessionMapping.get(resumeSessionId) : null;

    // Check if this is a resume of an existing session
    // For sessions created via create_session, we need to update title on first message
    let existingSession = null;
    if (resumeSessionId && ws.cookie) {
      existingSession = await loadSessionFromDb(ws.cookie, resumeSessionId);
    }

    // Determine title: only set for first message of sessions without a meaningful title
    // - New sessions (no resumeSessionId): use prompt
    // - Resumed sessions with default/placeholder title: use prompt
    // - Resumed sessions with existing title: don't override
    const defaultTitles = ['未命名', '新会话', 'New Session', 'Untitled'];
    const hasPlaceholderTitle = existingSession && (
      !existingSession.title ||
      defaultTitles.includes(existingSession.title)
    );
    const sessionTitle = silentInit
      ? null
      : ((!resumeSessionId || hasPlaceholderTitle) ? prompt.slice(0, 50).trim() : null);

    if (hasPlaceholderTitle) {
      console.log(`[WS Server] Updating placeholder title to: "${sessionTitle}"`);
    }

    // Get user-specific CLAUDE_HOME (for SDK session storage)
    // Use existing session's claudeHome if available, otherwise generate new
    const claudeHome = existingSession?.claudeHomePath || getClaudeHome(ws.userId);
    await ensureDirExists(claudeHome);

    // Get session-specific workspace (for Agent file operations)
    const workspacePath = getSessionWorkspace(ws.userId, workspaceSessionId);
    await ensureDirExists(workspacePath);

    // Create .claude symlink in workspace pointing to user's .claude directory
    // This allows SDK to find skills/settings while working in session workspace
    await ensureClaudeSymlink(workspacePath, claudeHome);

    // Verify skills are accessible through the symlink
    await verifySkillsAccess(workspacePath, claudeHome);

    console.log(`[WS Server] User ${ws.userId} Session ${workspaceSessionId}`);
    console.log(`[WS Server]   CLAUDE_HOME: ${claudeHome}`);
    console.log(`[WS Server]   Workspace: ${workspacePath}`);
    if (sdkResumeId) {
      console.log(`[WS Server]   SDK Resume ID: ${sdkResumeId}`);
    }

    // Build environment for worker process
    const workerEnv = { ...process.env };
    // Set both CLAUDE_HOME and HOME - SDK might use either
    workerEnv.CLAUDE_HOME = claudeHome;
    workerEnv.HOME = claudeHome;  // Override HOME so os.homedir() returns user dir
    workerEnv.WORKER_CWD = workspacePath;  // Per-Session workspace
    if (config.apiKey) workerEnv.ANTHROPIC_API_KEY = config.apiKey;
    if (config.baseURL) {
      workerEnv.ANTHROPIC_BASE_URL = config.baseURL;
      workerEnv.ANTHROPIC_API_URL = config.baseURL;
    }
    if (config.model) workerEnv.ANTHROPIC_MODEL = config.model;
    workerEnv.ENABLE_TOOL_SEARCH = 'auto:10';  // Enable Tool Search when many MCP tools available

    // Fetch permission info from API (includes organization settings)
    const permissionInfo = await fetchPermissionInfo(ws.cookie);

    // Use fetched permission info or fall back to environment variables
    let permissionMode, allowBash, organizationId, role;
    if (permissionInfo && permissionInfo.userId === ws.userId) {
      permissionMode = permissionInfo.permissionMode;
      allowBash = permissionInfo.allowBash;
      organizationId = permissionInfo.organizationId;
      role = permissionInfo.role;
      console.log(`[WS Server] Using organization-based permissions: org=${organizationId}, role=${role}, mode=${permissionMode}, bash=${allowBash}`);
    } else {
      // Fallback to environment variables
      permissionMode = resolvePermissionMode(ws.userId);
      allowBash = permissionMode === 'bypassPermissions' && ALLOW_BASH_IN_BYPASS;
      organizationId = null;
      role = null;
      console.log(`[WS Server] Using environment-based permissions: mode=${permissionMode}, bash=${allowBash}`);
    }

    const disallowedTools = resolveDisallowedTools(permissionMode, allowBash);
    workerEnv.CLAUDE_PERMISSION_MODE = permissionMode;

    // Spawn worker process with user-specific CLAUDE_HOME
    const worker = spawn('node', [WORKER_PATH], {
      env: workerEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    ws.workerProcess = worker;

    // Send query request to worker
    // Pass sdkResumeId for SDK conversation resume
    const request = JSON.stringify({
      prompt,
      sdkResumeId,
      permissionMode,
      disallowedTools,
      allowBash,  // Pass allowBash flag so worker can trust org-based bypass mode
      userId: ws.userId,
    });
    worker.stdin.write(request);
    worker.stdin.end();

    // Track our workspace session ID for mapping/persistence
    ws.workspaceSessionId = workspaceSessionId;

    // Read responses line by line
    const rl = createInterface({ input: worker.stdout });

    // Handle readline errors (e.g., when worker is killed abruptly)
    rl.on('error', (error) => {
      console.log('[WS Server] Readline error (expected on abort):', error.message);
    });

    rl.on('close', () => {
      // Readline closed, worker output ended
    });

    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'event') {
          const event = msg.event;
          if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
            // Store SDK's session_id for future resume
            ws.sdkSessionId = event.session_id;
            // Store mapping: workspaceSessionId -> sdkSessionId
            sessionMapping.set(ws.workspaceSessionId, event.session_id);
            console.log(`[WS Server] Session mapping: ${ws.workspaceSessionId} -> ${event.session_id}`);

            // Persist session to database (use workspaceSessionId as the identifier)
            // Pass sessionTitle only for new sessions (extracted from first user message)
            persistSession(ws.cookie, ws.workspaceSessionId, event.session_id, claudeHome, sessionTitle);

            if (silentInit) {
              sendMessage(ws, {
                type: 'session_metadata',
                sessionId: ws.workspaceSessionId,
                metadata: {
                  session_id: event.session_id || ws.workspaceSessionId,
                  user_id: ws.userId || '',
                  model: event.model || 'unknown',
                  skills: event.skills || [],
                  mcp_servers: event.mcp_servers || [],
                  agents: event.agents || [],
                  tools: event.tools || [],
                  slash_commands: event.slash_commands || [],
                  cwd: event.cwd || '',
                },
              });
            } else {
              // Send our workspace sessionId to client (they'll use this for resume)
              sendMessage(ws, {
                type: 'session_init',
                sessionId: ws.workspaceSessionId,
                sdkSessionId: event.session_id,
                userId: ws.userId,  // Include userId for Skills isolation
              });
            }
          }
          if (!silentInit) {
            sendMessage(ws, { type: 'message', event });
          }
        } else if (msg.type === 'done') {
          if (!silentInit) {
            sendMessage(ws, { type: 'done' });
          }
        } else if (msg.type === 'error') {
          sendMessage(ws, {
            type: 'error',
            code: 'worker_error',
            message: msg.message,
            retriable: true,
          });
        }
      } catch (parseError) {
        console.error('[WS Server] Worker output parse error:', parseError);
      }
    });

    // Handle stdout errors (e.g., when worker is killed)
    worker.stdout.on('error', (error) => {
      console.log('[WS Server] Worker stdout error (expected on abort):', error.message);
    });

    // Log worker stderr
    worker.stderr.on('data', (data) => {
      console.log(`[Worker ${ws.userId}]`, data.toString().trim());
    });

    worker.stderr.on('error', (error) => {
      console.log('[WS Server] Worker stderr error:', error.message);
    });

    // Handle worker exit
    worker.on('close', (code, signal) => {
      try {
        console.log('[WS Server] ========== WORKER CLOSE EVENT ==========');
        console.log('[WS Server] Worker PID:', worker.pid);
        console.log('[WS Server] Exit code:', code);
        console.log('[WS Server] Signal:', signal);
        console.log('[WS Server] User ID:', ws.userId);

        if (signal) {
          // Killed by signal (e.g., abort) - this is expected
          console.log(`[WS Server] Worker killed by signal ${signal} (expected)`);
        } else if (code !== 0 && code !== null) {
          console.error(`[WS Server] Worker exited with non-zero code ${code}`);
        } else {
          console.log('[WS Server] Worker exited normally');
        }

        ws.workerProcess = null;
        console.log('[WS Server] Worker process reference cleared');
        console.log('[WS Server] ============================================');
      } catch (closeError) {
        console.error('[WS Server] ========== ERROR IN WORKER CLOSE HANDLER ==========');
        console.error('[WS Server] Close handler error:', closeError);
        console.error('[WS Server] Close handler stack:', closeError.stack);
        console.error('[WS Server] ==================================================');
      }
    });

    worker.on('error', (error) => {
      try {
        console.error('[WS Server] ========== WORKER ERROR EVENT ==========');
        console.error('[WS Server] Worker PID:', worker.pid);
        console.error('[WS Server] Error:', error);
        console.error('[WS Server] Error stack:', error.stack);
        console.error('[WS Server] Error type:', error.constructor.name);
        console.error('[WS Server] User ID:', ws.userId);
        console.error('[WS Server] ===========================================');

        sendMessage(ws, {
          type: 'error',
          code: 'worker_spawn_error',
          message: error.message,
          retriable: true,
        });
      } catch (errorHandlerError) {
        console.error('[WS Server] ========== ERROR IN WORKER ERROR HANDLER ==========');
        console.error('[WS Server] Error handler error:', errorHandlerError);
        console.error('[WS Server] Error handler stack:', errorHandlerError.stack);
        console.error('[WS Server] =========================================================');
      }
    });

  } catch (error) {
    console.error('[WS Server] Chat error:', error);
    sendMessage(ws, {
      type: 'error',
      code: 'server_error',
      message: error instanceof Error ? error.message : String(error),
      retriable: true,
    });
  }
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(ws, msg) {
  try {
    console.log(`[WS Server] Received message from ${ws.userId}:`, msg.toString().substring(0, 200));
    const message = JSON.parse(msg);
    console.log(`[WS Server] Parsed message type: ${message.type}`);

  switch (message.type) {
    case 'create_session':
      // Explicitly create a new empty session (without user message)
      await handleCreateSession(ws);
      break;

    case 'init_session':
      if (!message.sessionId) {
        sendMessage(ws, {
          type: 'error',
          code: 'invalid_message',
          message: 'Missing sessionId for init_session',
          retriable: false,
        });
        return;
      }
      await handleChat(ws, ' ', message.sessionId, { silentInit: true });
      break;

    case 'chat':
      console.log(`[WS Server] Processing chat from ${ws.userId}, content length: ${message.content?.length || 0}`);
      if (!message.content) {
        sendMessage(ws, {
          type: 'error',
          code: 'invalid_message',
          message: 'Missing content',
          retriable: false,
        });
        return;
      }
      await handleChat(ws, message.content, message.sessionId);
      break;

    case 'resume':
      // Resume a previous session
      if (!message.sessionId) {
        sendMessage(ws, {
          type: 'error',
          code: 'invalid_message',
          message: 'Missing sessionId for resume',
          retriable: false,
        });
        return;
      }
      // Store the workspace session ID for future chats
      ws.workspaceSessionId = message.sessionId;

      // Load session data from database (includes realSdkSessionId and claudeHomePath)
      let sessionData = null;
      let resumeSdkSessionId = sessionMapping.get(message.sessionId);

      if (ws.cookie) {
        sessionData = await loadSessionFromDb(ws.cookie, message.sessionId);
        if (sessionData) {
          if (sessionData.realSdkSessionId) {
            resumeSdkSessionId = sessionData.realSdkSessionId;
            // Cache it in memory for future use
            sessionMapping.set(message.sessionId, resumeSdkSessionId);
          }
        }
      }

      console.log(`[WS Server] Resuming session: ${message.sessionId} -> SDK: ${resumeSdkSessionId || 'not found'}`);

      // Send confirmation back to client
      sendMessage(ws, {
        type: 'session_init',
        sessionId: message.sessionId,
        sdkSessionId: resumeSdkSessionId || null,
        userId: ws.userId,  // Include userId for Skills isolation
      });

      // Load and send historical messages if we have session data
      if (resumeSdkSessionId && sessionData?.claudeHomePath) {
        const messages = await loadMessages(sessionData.claudeHomePath, resumeSdkSessionId);
        if (messages.length > 0) {
          console.log(`[WS Server] Sending ${messages.length} historical messages to client`);
          sendMessage(ws, {
            type: 'messages_loaded',
            messages,
          });
        }
      }
      break;

    case 'abort':
      console.log('[WS Server] ========== ABORT REQUEST START ==========');
      console.log('[WS Server] User ID:', ws.userId);
      console.log('[WS Server] Has worker process:', !!ws.workerProcess);
      console.log('[WS Server] Worker PID:', ws.workerProcess?.pid);

      try {
        // Abort the controller if it exists
        if (ws.abortController) {
          console.log('[WS Server] Aborting controller');
          ws.abortController.abort('user_interrupt');
        }

        // Gracefully terminate worker process if running
        if (ws.workerProcess) {
          const worker = ws.workerProcess;
          console.log('[WS Server] Attempting to kill worker process');

          try {
            // Send SIGTERM first (graceful shutdown)
            worker.kill('SIGTERM');
            console.log('[WS Server] SIGTERM sent successfully');
          } catch (killError) {
            console.error('[WS Server] Error sending SIGTERM:', killError);
            console.error('[WS Server] Kill error stack:', killError.stack);
          }

          // Set up a timeout to force kill if worker doesn't exit
          const forceKillTimeout = setTimeout(() => {
            try {
              if (ws.workerProcess === worker) {
                console.log('[WS Server] Worker did not exit, force killing');
                worker.kill('SIGKILL');
                console.log('[WS Server] SIGKILL sent successfully');
              }
            } catch (forceKillError) {
              console.error('[WS Server] Error sending SIGKILL:', forceKillError);
              console.error('[WS Server] Force kill error stack:', forceKillError.stack);
            }
          }, 2000);

          // Clear the timeout when worker exits
          try {
            worker.once('close', (code, signal) => {
              try {
                console.log('[WS Server] Worker closed - code:', code, 'signal:', signal);
                clearTimeout(forceKillTimeout);
                console.log('[WS Server] Force kill timeout cleared');

                // Notify client that abort completed
                console.log('[WS Server] Sending aborted message to client');
                sendMessage(ws, { type: 'aborted' });
                console.log('[WS Server] Aborted message sent successfully');
              } catch (closeHandlerError) {
                console.error('[WS Server] Error in worker close handler:', closeHandlerError);
                console.error('[WS Server] Close handler error stack:', closeHandlerError.stack);
              }
            });
            console.log('[WS Server] Worker close listener attached');
          } catch (listenerError) {
            console.error('[WS Server] Error attaching close listener:', listenerError);
            console.error('[WS Server] Listener error stack:', listenerError.stack);
          }
        } else {
          // No worker to abort, just acknowledge
          console.log('[WS Server] No worker process, sending aborted immediately');
          sendMessage(ws, { type: 'aborted' });
        }

        console.log('[WS Server] ========== ABORT REQUEST END ==========');
      } catch (abortError) {
        console.error('[WS Server] ========== ABORT ERROR ==========');
        console.error('[WS Server] Abort handler caught exception:', abortError);
        console.error('[WS Server] Abort error stack:', abortError.stack);
        console.error('[WS Server] Abort error type:', abortError.constructor.name);
        console.error('[WS Server] =====================================');

        // Try to send error message to client
        try {
          sendMessage(ws, {
            type: 'error',
            code: 'abort_failed',
            message: `Abort failed: ${abortError.message}`,
            retriable: false,
          });
        } catch (sendError) {
          console.error('[WS Server] Failed to send abort error to client:', sendError);
        }
      }
      break;

    case 'ping':
      sendMessage(ws, { type: 'pong' });
      break;

    default:
      sendMessage(ws, {
        type: 'error',
        code: 'unknown_message_type',
        message: `Unknown message type: ${message.type}`,
        retriable: false,
      });
  }
  } catch (handleMessageError) {
    console.error('[WS Server] ========== HANDLE MESSAGE ERROR ==========');
    console.error('[WS Server] Error handling message:', handleMessageError);
    console.error('[WS Server] Error stack:', handleMessageError.stack);
    console.error('[WS Server] Error type:', handleMessageError.constructor.name);
    console.error('[WS Server] Message preview:', msg.toString().substring(0, 500));
    console.error('[WS Server] User ID:', ws.userId);
    console.error('[WS Server] ==================================================');

    // Try to send error message to client
    try {
      sendMessage(ws, {
        type: 'error',
        code: 'message_handler_error',
        message: `Failed to handle message: ${handleMessageError.message}`,
        retriable: false,
      });
    } catch (sendError) {
      console.error('[WS Server] Failed to send error to client:', sendError);
    }
  }
}

/**
 * Start WebSocket server for Claude Agent Chat
 * Can be called from Nitro plugin or run standalone
 */
export function startWebSocketServer(port = WS_PORT) {
  // Create HTTP server for WebSocket
  const httpServer = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket connection required');
  });

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer, path: '/ws/agent' });

wss.on('connection', async (ws, request) => {
  // Queue messages until auth completes (fixes race condition)
  const messageQueue = [];
  let isAuthenticated = false;

  // Set up message listener IMMEDIATELY to capture early messages
  ws.on('message', async (data) => {
    if (!isAuthenticated) {
      // Queue message until auth completes
      console.log('[WS Server] Queuing message (auth pending)');
      messageQueue.push(data);
      return;
    }

    try {
      await handleMessage(ws, data.toString());
    } catch (error) {
      console.error('[WS Server] Message error:', error);
      sendMessage(ws, {
        type: 'error',
        code: 'invalid_message',
        message: error instanceof Error ? error.message : 'Invalid message',
        retriable: false,
      });
    }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    console.log(`[WS Server] Client disconnected: ${ws.userId || 'unknown'}`);
    ws.abortController?.abort();
    // Kill worker process if running
    if (ws.workerProcess) {
      ws.workerProcess.kill();
      ws.workerProcess = null;
    }
  });

  ws.on('error', (error) => {
    console.error(`[WS Server] Error for ${ws.userId || 'unknown'}:`, error);
  });

  // Authenticate
  const user = await authenticateRequest(request);
  if (!user) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.userId = user.id;
  ws.cookie = request.headers.cookie || '';  // Store cookie for API calls
  ws.isAlive = true;
  isAuthenticated = true;
  console.log(`[WS Server] Client connected: ${ws.userId}`);

  // Process any queued messages
  if (messageQueue.length > 0) {
    console.log(`[WS Server] Processing ${messageQueue.length} queued message(s)`);
    for (const data of messageQueue) {
      try {
        await handleMessage(ws, data.toString());
      } catch (error) {
        console.error('[WS Server] Message error:', error);
        sendMessage(ws, {
          type: 'error',
          code: 'invalid_message',
          message: error instanceof Error ? error.message : 'Invalid message',
          retriable: false,
        });
      }
    }
  }
});

// Heartbeat
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(heartbeat);
});

  // Start server
  httpServer.listen(port, () => {
    console.log(`[WS Server] WebSocket server running on port ${port}`);
    console.log(`[WS Server] Authenticating against ${APP_URL}`);
    console.log(`[WS Server] Sessions root: ${SESSIONS_ROOT}`);
  });

  return { httpServer, wss };
}

// ============================================================================
// Skills Store Seeder (inline implementation for .mjs compatibility)
// ============================================================================

/**
 * Seed Skills Store from built-in skills directory
 *
 * Strategy: "Incremental sync with overwrite"
 * - Syncs all built-in skills to store directory
 * - Overwrites existing skills with same name (ensures updates)
 * - Preserves user-installed skills not in built-in directory
 *
 * Only runs in production when SKILLS_STORE_DIR is set.
 */
export async function seedSkillsStore() {
  const storeDir = process.env.SKILLS_STORE_DIR;

  // Only seed in production (when SKILLS_STORE_DIR is set)
  if (!storeDir) {
    console.log('[Skills] Development mode, skipping seed');
    return;
  }

  const builtInDir = path.join(process.cwd(), 'src', 'skills-store');

  // Check if built-in directory exists
  try {
    await access(builtInDir);
  } catch {
    console.warn('[Skills] Built-in skills directory not found:', builtInDir);
    return;
  }

  // Ensure store directory exists
  await mkdir(storeDir, { recursive: true });

  // Get list of built-in skills
  const builtInEntries = await readdir(builtInDir, { withFileTypes: true });
  const builtInSkills = builtInEntries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

  if (builtInSkills.length === 0) {
    console.log('[Skills] No built-in skills found, skipping seed');
    return;
  }

  console.log('[Skills] Syncing built-in skills to store...');
  console.log(`[Skills]   Source: ${builtInDir}`);
  console.log(`[Skills]   Target: ${storeDir}`);
  console.log(`[Skills]   Skills to sync: ${builtInSkills.length}`);

  let synced = 0;
  let skipped = 0;

  for (const skill of builtInSkills) {
    const sourcePath = path.join(builtInDir, skill.name);
    const targetPath = path.join(storeDir, skill.name);

    try {
      // Check if target exists
      let targetExists = false;
      try {
        await access(targetPath);
        targetExists = true;
      } catch {
        // Target doesn't exist, will be created
      }

      // Remove existing and copy fresh (overwrite strategy)
      if (targetExists) {
        await rm(targetPath, { recursive: true, force: true });
      }

      await cp(sourcePath, targetPath, { recursive: true });
      synced++;

      if (targetExists) {
        console.log(`[Skills]   ✓ Updated: ${skill.name}`);
      } else {
        console.log(`[Skills]   ✓ Added: ${skill.name}`);
      }
    } catch (err) {
      console.error(`[Skills]   ✗ Failed: ${skill.name}`, err.message);
      skipped++;
    }
  }

  console.log(`[Skills] Sync complete: ${synced} synced, ${skipped} failed`);
}

// Run as standalone script when executed directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    console.log('[WS Server] Starting standalone WebSocket server...');
    // Seed Skills Store before starting server (production only)
    seedSkillsStore()
      .then(() => {
        startWebSocketServer();
      })
      .catch((err) => {
        console.error('[Skills] Seed error:', err);
        // Continue starting server even if seed fails
        startWebSocketServer();
      });
  }
}
