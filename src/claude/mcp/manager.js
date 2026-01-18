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
const CREDENTIALS_FILENAME = 'credentials.json';
const OVERRIDES_FILENAME = 'overrides.json';

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

// ============================================================================
// Credentials management
// ============================================================================

/**
 * Read user credentials for all MCPs
 */
async function readUserCredentials(userHome) {
  const credPath = path.join(getUserMcpRoot(userHome), CREDENTIALS_FILENAME);
  try {
    const raw = await fs.readFile(credPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    console.warn('[MCP] Failed to read credentials:', error);
    return {};
  }
}

/**
 * Write user credentials
 */
async function writeUserCredentials(userHome, credentials) {
  const root = getUserMcpRoot(userHome);
  await fs.mkdir(root, { recursive: true });
  const credPath = path.join(root, CREDENTIALS_FILENAME);
  await fs.writeFile(credPath, JSON.stringify(credentials, null, 2));
}

/**
 * Get credentials for a specific MCP
 */
export async function getMcpCredentials(userId, slug) {
  const userHome = getUserClaudeHome(userId);
  const allCredentials = await readUserCredentials(userHome);
  const normalized = normalizeMcpName(slug);
  return allCredentials[normalized] || {};
}

/**
 * Set credentials for a specific MCP
 */
export async function setMcpCredentials(userId, slug, credentials) {
  const userHome = getUserClaudeHome(userId);
  const allCredentials = await readUserCredentials(userHome);
  const normalized = normalizeMcpName(slug);
  allCredentials[normalized] = credentials;
  await writeUserCredentials(userHome, allCredentials);
}

// ============================================================================
// User overrides (allowedTools)
// ============================================================================

/**
 * Read user overrides for all MCPs
 */
async function readUserOverrides(userHome) {
  const overridesPath = path.join(getUserMcpRoot(userHome), OVERRIDES_FILENAME);
  try {
    const raw = await fs.readFile(overridesPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    console.warn('[MCP] Failed to read overrides:', error);
    return {};
  }
}

/**
 * Write user overrides
 */
async function writeUserOverrides(userHome, overrides) {
  const root = getUserMcpRoot(userHome);
  await fs.mkdir(root, { recursive: true });
  const overridesPath = path.join(root, OVERRIDES_FILENAME);
  await fs.writeFile(overridesPath, JSON.stringify(overrides, null, 2));
}

/**
 * Get user's allowedTools override for a specific MCP
 */
export async function getMcpAllowedToolsOverride(userId, slug) {
  const userHome = getUserClaudeHome(userId);
  const allOverrides = await readUserOverrides(userHome);
  const normalized = normalizeMcpName(slug);
  return allOverrides[normalized]?.allowedTools || null;
}

/**
 * Set user's allowedTools override for a specific MCP
 */
export async function setMcpAllowedToolsOverride(userId, slug, allowedTools) {
  const userHome = getUserClaudeHome(userId);
  const allOverrides = await readUserOverrides(userHome);
  const normalized = normalizeMcpName(slug);

  if (!allOverrides[normalized]) {
    allOverrides[normalized] = {};
  }

  if (allowedTools === null) {
    delete allOverrides[normalized].allowedTools;
  } else {
    allOverrides[normalized].allowedTools = allowedTools;
  }

  await writeUserOverrides(userHome, allOverrides);
}

// ============================================================================
// Environment variable template resolution
// ============================================================================

/**
 * Resolve environment variable templates like ${VAR_NAME}
 */
function resolveEnvTemplate(template, credentials) {
  if (!template || typeof template !== 'object') return {};

  const result = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const credKey = value.slice(2, -1);
      result[key] = credentials[credKey] || '';
    } else {
      result[key] = value;
    }
  }
  return result;
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
 *
 * Returns:
 * - mcpServers: config map for SDK query()
 * - allowedTools: merged list of allowed MCP tools
 */
export async function resolveMcpServerConfigs({ userId, userHome, sdkServers = {} } = {}) {
  const resolvedHome = userHome || (userId ? getUserClaudeHome(userId) : null);
  if (!resolvedHome) return { mcpServers: {}, allowedTools: [] };

  const enabled = await getUserEnabledMcpServers(userId, { userHome: resolvedHome });
  if (enabled.length === 0) return { mcpServers: {}, allowedTools: [] };

  const store = await getMcpStore();
  const allCredentials = await readUserCredentials(resolvedHome);
  const allOverrides = await readUserOverrides(resolvedHome);

  const configMap = {};
  const allowedTools = [];

  for (const entry of store) {
    if (!entry?.mcp) continue;
    if (!enabled.includes(entry.slug)) continue;

    const mcpConfig = entry.mcp;
    const name = mcpConfig.name || entry.slug;
    const credentials = allCredentials[entry.slug] || {};

    // Collect allowedTools: user override > MCP.md definition > default wildcard
    const userOverride = allOverrides[entry.slug]?.allowedTools;
    if (userOverride && Array.isArray(userOverride)) {
      allowedTools.push(...userOverride);
    } else if (entry.allowedTools && Array.isArray(entry.allowedTools)) {
      allowedTools.push(...entry.allowedTools);
    } else {
      // Default: allow all tools for this MCP
      allowedTools.push(`mcp__${name}__*`);
    }

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
      // Resolve env templates with user credentials
      const resolvedEnv = resolveEnvTemplate(mcpConfig.env, credentials);

      configMap[name] = {
        command: mcpConfig.command,
        ...(mcpConfig.args ? { args: mcpConfig.args } : {}),
        ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
      };
      continue;
    }

    if (mcpConfig.type === 'sse' || mcpConfig.type === 'http') {
      // Resolve header templates with user credentials
      const resolvedHeaders = resolveEnvTemplate(mcpConfig.headers, credentials);

      configMap[name] = {
        type: mcpConfig.type,
        url: mcpConfig.url,
        ...(Object.keys(resolvedHeaders).length > 0 ? { headers: resolvedHeaders } : {}),
      };
    }
  }

  return { mcpServers: configMap, allowedTools };
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

// ============================================================================
// Custom MCP Management
// ============================================================================

const CUSTOM_MCP_DIR_NAME = 'custom';
const SYSTEM_MCP_DIR_NAME = '_system';

/**
 * Get user's custom MCP directory
 */
export function getUserCustomMcpDir(userId) {
  const userHome = getUserClaudeHome(userId);
  return path.join(userHome, '.claude', 'mcp', CUSTOM_MCP_DIR_NAME);
}

/**
 * Get system MCP directory (shared across all users)
 */
export function getSystemMcpDir() {
  const envRoot = process.env.CLAUDE_SESSIONS_ROOT;
  const sessionsRoot = (envRoot && envRoot.trim())
    ? envRoot
    : path.join(process.cwd(), 'user-data');
  return path.join(sessionsRoot, SYSTEM_MCP_DIR_NAME, 'mcp');
}

/**
 * Get all system MCPs (visible to all users)
 */
export async function getSystemMcps() {
  const systemDir = getSystemMcpDir();

  try {
    const entries = await fs.readdir(systemDir, { withFileTypes: true });
    const mcps = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !DEFAULT_BLOCKED_NAMES.has(entry.name.toLowerCase()))
        .map(async (entry) => {
          const mcpPath = path.join(systemDir, entry.name);
          const slug = normalizeMcpName(entry.name);
          const info = await parseMcpMetadata(mcpPath, slug);
          if (info) {
            return { ...info, isSystem: true, store: 'system' };
          }
          return null;
        })
    );

    return mcps.filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    console.warn('[MCP] Failed to read system MCPs:', error);
    return [];
  }
}

/**
 * Get all custom MCPs for a user
 */
export async function getUserCustomMcps(userId) {
  const customDir = getUserCustomMcpDir(userId);

  try {
    const entries = await fs.readdir(customDir, { withFileTypes: true });
    const mcps = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !DEFAULT_BLOCKED_NAMES.has(entry.name.toLowerCase()))
        .map(async (entry) => {
          const mcpPath = path.join(customDir, entry.name);
          const slug = normalizeMcpName(entry.name);
          const info = await parseMcpMetadata(mcpPath, slug);
          if (info) {
            return { ...info, isCustom: true };
          }
          return null;
        })
    );

    return mcps.filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    console.warn('[MCP] Failed to read custom MCPs:', error);
    return [];
  }
}

/**
 * Save a custom MCP configuration
 */
export async function saveCustomMcp(userId, mcpData) {
  const slug = normalizeMcpName(mcpData.slug);
  const customDir = getUserCustomMcpDir(userId);
  const mcpDir = path.join(customDir, slug);

  // Ensure directory exists
  await fs.mkdir(mcpDir, { recursive: true });

  // Build MCP.md content with YAML frontmatter
  const frontmatter = {
    name: mcpData.name || slug,
    description: mcpData.description || null,
    category: mcpData.category || 'general',
    defaultEnabled: false,
    mcp: mcpData.mcp,
  };

  if (mcpData.allowedTools && Array.isArray(mcpData.allowedTools)) {
    frontmatter.allowedTools = mcpData.allowedTools;
  }

  if (mcpData.credentials && Array.isArray(mcpData.credentials)) {
    frontmatter.credentials = mcpData.credentials;
  }

  const yaml = (await import('js-yaml')).default;
  const yamlContent = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true });

  const markdownContent = `---
${yamlContent.trim()}
---

# ${mcpData.name || slug}

${mcpData.description || 'Custom MCP server.'}
`;

  const mcpMdPath = path.join(mcpDir, 'MCP.md');
  await fs.writeFile(mcpMdPath, markdownContent, 'utf-8');

  return { slug, path: mcpMdPath };
}

/**
 * Delete a custom MCP
 */
export async function deleteCustomMcp(userId, slug) {
  const normalized = normalizeMcpName(slug);
  const customDir = getUserCustomMcpDir(userId);
  const mcpDir = path.join(customDir, normalized);

  // Check if it exists
  if (!await fileExists(mcpDir)) {
    throw new Error(`Custom MCP not found: ${normalized}`);
  }

  // Remove directory recursively
  await fs.rm(mcpDir, { recursive: true, force: true });

  // Also remove from enabled list if present
  const userHome = getUserClaudeHome(userId);
  const enabled = await readEnabledList(userHome);
  if (enabled && enabled.includes(normalized)) {
    const next = enabled.filter((entry) => entry !== normalized);
    await writeEnabledList(userHome, next);
  }

  return { slug: normalized };
}

/**
 * Check if a custom MCP exists for a user
 */
export async function customMcpExists(userId, slug) {
  const normalized = normalizeMcpName(slug);
  const customDir = getUserCustomMcpDir(userId);
  const mcpDir = path.join(customDir, normalized);
  return await fileExists(mcpDir);
}

/**
 * Check if a system MCP exists
 */
export async function systemMcpExists(slug) {
  const normalized = normalizeMcpName(slug);
  const systemDir = getSystemMcpDir();
  const mcpDir = path.join(systemDir, normalized);
  return await fileExists(mcpDir);
}

/**
 * Save a system MCP configuration (visible to all users)
 */
export async function saveSystemMcp(mcpData) {
  const slug = normalizeMcpName(mcpData.slug);
  const systemDir = getSystemMcpDir();
  const mcpDir = path.join(systemDir, slug);

  // Ensure directory exists
  await fs.mkdir(mcpDir, { recursive: true });

  // Build MCP.md content with YAML frontmatter
  const frontmatter = {
    name: mcpData.name || slug,
    description: mcpData.description || null,
    category: mcpData.category || 'general',
    defaultEnabled: false,
    mcp: mcpData.mcp,
  };

  if (mcpData.allowedTools && Array.isArray(mcpData.allowedTools)) {
    frontmatter.allowedTools = mcpData.allowedTools;
  }

  if (mcpData.credentials && Array.isArray(mcpData.credentials)) {
    frontmatter.credentials = mcpData.credentials;
  }

  const yaml = (await import('js-yaml')).default;
  const yamlContent = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true });

  const markdownContent = `---
${yamlContent.trim()}
---

# ${mcpData.name || slug}

${mcpData.description || 'System MCP server.'}
`;

  const mcpMdPath = path.join(mcpDir, 'MCP.md');
  await fs.writeFile(mcpMdPath, markdownContent, 'utf-8');

  return { slug, path: mcpMdPath };
}

/**
 * Delete a system MCP (requires admin permission - checked at caller level)
 */
export async function deleteSystemMcp(slug) {
  const normalized = normalizeMcpName(slug);
  const systemDir = getSystemMcpDir();
  const mcpDir = path.join(systemDir, normalized);

  // Check if it exists
  if (!await fileExists(mcpDir)) {
    throw new Error(`System MCP not found: ${normalized}`);
  }

  // Remove directory recursively
  await fs.rm(mcpDir, { recursive: true, force: true });

  return { slug: normalized };
}

/**
 * Get custom MCP detail (for editing)
 */
export async function getCustomMcpDetail(userId, slug) {
  const normalized = normalizeMcpName(slug);
  const customDir = getUserCustomMcpDir(userId);
  const mcpDir = path.join(customDir, normalized);

  if (!await fileExists(mcpDir)) {
    throw new Error(`Custom MCP not found: ${normalized}`);
  }

  const info = await parseMcpMetadata(mcpDir, normalized);
  if (!info) {
    throw new Error(`Custom MCP metadata not found: ${normalized}`);
  }

  const files = await buildFileTree(mcpDir);
  return {
    slug: normalized,
    name: info.name,
    description: info.description,
    category: info.category,
    mcp: info.mcp,
    allowedTools: info.allowedTools,
    credentials: info.credentials,
    files,
    isCustom: true,
  };
}

/**
 * Parse MCP configuration from raw content (YAML/JSON)
 */
export function parseMcpConfigFromContent(content) {
  // Try YAML frontmatter format first
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);

  if (match) {
    try {
      const yaml = require('js-yaml');
      const parsed = yaml.load(match[1]);
      if (parsed && typeof parsed === 'object') {
        return { ok: true, data: parsed };
      }
    } catch (error) {
      return { ok: false, error: `YAML parse error: ${error.message}` };
    }
  }

  // Try pure YAML
  try {
    const yaml = require('js-yaml');
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object') {
      return { ok: true, data: parsed };
    }
  } catch {}

  // Try JSON
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return { ok: true, data: parsed };
    }
  } catch {}

  return { ok: false, error: 'Unable to parse content as YAML or JSON' };
}
