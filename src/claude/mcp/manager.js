/**
 * MCP Manager
 *
 * Handles MCP store metadata and per-user enablement.
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMcpMetadata, fileExists } from './metadata.js';

function resolveMcpStoreDir() {
  const envDir = process.env.CLAUDE_MCP_STORE_DIR || process.env.MCP_STORE_DIR;
  if (envDir && envDir.trim()) {
    return path.resolve(envDir);
  }

  const cwdCandidate = path.join(process.cwd(), 'src', 'mcp-store');
  if (existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', 'mcp-store');
}

const MCP_STORE_DIR = resolveMcpStoreDir();

const ENABLED_FILENAME = 'enabled.json';

const DEFAULT_BLOCKED_NAMES = new Set(['.ds_store']);

/**
 * Normalize MCP name to prevent path traversal attacks
 */
export function normalizeMcpName(name) {
  return String(name).replace(/[^A-Za-z0-9-_]/g, '_');
}

/**
 * Get user's CLAUDE_HOME directory
 */
export function getUserClaudeHome(userId) {
  const envRoot = process.env.CLAUDE_SESSIONS_ROOT;
  const sessionsRoot = (envRoot && envRoot.trim())
    ? envRoot
    : path.join(process.cwd(), 'user-data');
  return path.join(sessionsRoot, userId);
}

function getUserMcpRoot(userHome) {
  return path.join(userHome, '.claude', 'mcp');
}

async function readEnabledList(userHome) {
  const enabledPath = path.join(getUserMcpRoot(userHome), ENABLED_FILENAME);
  try {
    const raw = await fs.readFile(enabledPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => typeof value === 'string');
    }
    return null;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    console.warn('[MCP] Failed to read enabled list:', error);
    return null;
  }
}

async function writeEnabledList(userHome, enabled) {
  const root = getUserMcpRoot(userHome);
  await fs.mkdir(root, { recursive: true });
  const enabledPath = path.join(root, ENABLED_FILENAME);
  await fs.writeFile(enabledPath, JSON.stringify(enabled, null, 2));
}

/**
 * Get all MCP servers from the MCP Store
 */
export async function getMcpStore() {
  try {
    const entries = await fs.readdir(MCP_STORE_DIR, { withFileTypes: true });
    const mcps = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !DEFAULT_BLOCKED_NAMES.has(entry.name.toLowerCase()))
        .map(async (entry) => {
          const mcpPath = path.join(MCP_STORE_DIR, entry.name);
          const slug = normalizeMcpName(entry.name);
          return parseMcpMetadata(mcpPath, slug);
        })
    );

    return mcps.filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn('[MCP] MCP Store directory does not exist:', MCP_STORE_DIR);
      return [];
    }
    throw error;
  }
}

/**
 * Get user's enabled MCP server slugs
 */
export async function getUserEnabledMcpServers(userId, options = {}) {
  const userHome = options.userHome || (userId ? getUserClaudeHome(userId) : null);
  if (!userHome) return [];

  const stored = await readEnabledList(userHome);
  if (stored) {
    return Array.from(new Set(stored.map(normalizeMcpName)));
  }

  const store = await getMcpStore();
  return store
    .filter((mcp) => mcp?.defaultEnabled)
    .map((mcp) => normalizeMcpName(mcp.slug));
}

/**
 * Enable a MCP server for a user
 */
export async function enableMcpServer(userId, slug) {
  const userHome = getUserClaudeHome(userId);
  const normalized = normalizeMcpName(slug);
  const store = await getMcpStore();

  if (!store.find((entry) => entry.slug === normalized)) {
    throw new Error(`MCP not found in store: ${normalized}`);
  }

  const enabled = await getUserEnabledMcpServers(userId, { userHome });
  const next = Array.from(new Set([...enabled, normalized]));
  await writeEnabledList(userHome, next);
}

/**
 * Disable a MCP server for a user
 */
export async function disableMcpServer(userId, slug) {
  const userHome = getUserClaudeHome(userId);
  const normalized = normalizeMcpName(slug);
  const enabled = await getUserEnabledMcpServers(userId, { userHome });
  const next = enabled.filter((entry) => entry !== normalized);
  await writeEnabledList(userHome, next);
}

/**
 * Resolve enabled MCP server configs for the SDK
 */
export async function resolveMcpServerConfigs({ userId, userHome, sdkServers = {} } = {}) {
  const resolvedHome = userHome || (userId ? getUserClaudeHome(userId) : null);
  if (!resolvedHome) return {};

  const enabled = await getUserEnabledMcpServers(userId, { userHome: resolvedHome });
  if (enabled.length === 0) return {};

  const store = await getMcpStore();
  const configMap = {};

  for (const entry of store) {
    if (!entry?.mcp) continue;
    if (!enabled.includes(entry.slug)) continue;

    const mcpConfig = entry.mcp;
    const name = mcpConfig.name || entry.slug;

    if (mcpConfig.type === 'sdk') {
      const sdkServer = sdkServers[name];
      if (!sdkServer) {
        console.warn(`[MCP] Missing SDK server for ${name}`);
        continue;
      }
      configMap[name] = sdkServer;
      continue;
    }

    if (mcpConfig.type === 'stdio') {
      configMap[name] = {
        type: 'stdio',
        command: mcpConfig.command,
        ...(mcpConfig.args ? { args: mcpConfig.args } : {}),
        ...(mcpConfig.env ? { env: mcpConfig.env } : {}),
      };
      continue;
    }

    if (mcpConfig.type === 'sse' || mcpConfig.type === 'http') {
      configMap[name] = {
        type: mcpConfig.type,
        url: mcpConfig.url,
        ...(mcpConfig.headers ? { headers: mcpConfig.headers } : {}),
      };
    }
  }

  return configMap;
}

// ============================================================================
// Detail view helpers (optional but used by UI)
// ============================================================================

const MAX_FILE_SIZE = 1024 * 1024;

const BINARY_EXTENSIONS = new Set([
  '.tar.gz',
  '.tar',
  '.gz',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
]);

function isBinaryFile(filePath) {
  const ext = filePath.toLowerCase();
  for (const binaryExt of BINARY_EXTENSIONS) {
    if (ext.endsWith(binaryExt)) {
      return true;
    }
  }
  return false;
}

async function buildFileTree(dirPath, relativePath = '') {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  const sortedEntries = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sortedEntries) {
    if (entry.name.startsWith('.') || entry.name === '.DS_Store') continue;

    const fullPath = path.join(dirPath, entry.name);
    const fileRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, fileRelativePath);
      files.push({
        path: fileRelativePath,
        name: entry.name,
        type: 'dir',
        children,
      });
      continue;
    }

    const stats = await fs.stat(fullPath);
    const isBinary = isBinaryFile(entry.name);
    const isTooLarge = stats.size > MAX_FILE_SIZE;

    let content;
    if (!isBinary && !isTooLarge) {
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch (error) {
        console.warn(`[MCP] Failed to read file: ${fileRelativePath}`, error);
      }
    }

    files.push({
      path: fileRelativePath,
      name: entry.name,
      type: 'file',
      content,
      size: stats.size,
      isBinary,
      isTooLarge,
    });
  }

  return files;
}

/**
 * Get full MCP detail including file tree
 */
export async function getMcpDetail(slug) {
  const normalized = normalizeMcpName(slug);
  const mcpDir = path.join(MCP_STORE_DIR, normalized);

  if (!await fileExists(mcpDir)) {
    throw new Error(`MCP not found: ${normalized}`);
  }

  const info = await parseMcpMetadata(mcpDir, normalized);
  if (!info) {
    throw new Error(`MCP metadata not found: ${normalized}`);
  }

  const files = await buildFileTree(mcpDir);
  return {
    slug: normalized,
    name: info.name,
    description: info.description,
    category: info.category,
    files,
  };
}
