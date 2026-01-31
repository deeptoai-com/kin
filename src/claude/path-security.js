import path from 'node:path';
import { promises as fs } from 'node:fs';

const FILE_TOOLS = new Set(['read', 'write', 'edit', 'glob', 'grep']);
const READ_TOOLS = new Set(['read', 'glob', 'grep']);
const WRITE_TOOLS = new Set(['write', 'edit']);

const DEFAULT_BLOCKED_PREFIXES = [
  '/etc',
  '/proc',
  '/sys',
  '/root',
  '/var',
  '/bin',
  '/usr',
  '/sbin',
  '/boot',
  '/lib',
];

const DEFAULT_SESSIONS_ROOT = '/data/users';

function sanitizeId(value) {
  return String(value).replace(/[\/\\\.]+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isWindowsAbsolute(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function isAbsolutePath(value) {
  return value.startsWith('/') || isWindowsAbsolute(value);
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function stripTrailingSlash(value) {
  if (value.length > 1 && value.endsWith('/')) {
    return value.slice(0, -1);
  }
  return value;
}

function normalizeAbsolutePath(value, baseDir) {
  const raw = String(value ?? '');
  const resolved = isAbsolutePath(raw) ? raw : path.resolve(baseDir || process.cwd(), raw);
  return stripTrailingSlash(path.posix.normalize(toPosix(resolved)));
}

function normalizePrefix(value, baseDir, { requireAbsolute = false } = {}) {
  if (!value) return null;
  const raw = String(value);
  if (requireAbsolute && !isAbsolutePath(raw)) return null;
  return normalizeAbsolutePath(raw, baseDir);
}

function normalizePrefixList(values, baseDir, { requireAbsolute = false } = {}) {
  const unique = new Set();
  for (const value of values) {
    const normalized = normalizePrefix(value, baseDir, { requireAbsolute });
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function isUnderPrefix(candidate, prefix) {
  const base = stripTrailingSlash(prefix);
  if (candidate === base) {
    return true;
  }
  return candidate.startsWith(ensureTrailingSlash(base));
}

function parseEnvPrefixes(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeToolName(toolName) {
  return String(toolName || '').toLowerCase();
}

function ensureRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function normalizeUpdatedInput(value) {
  return ensureRecord(value);
}

function extractTargetPaths(toolName, input, workspaceRoot) {
  const tool = normalizeToolName(toolName);
  if (!input) {
    return (tool === 'glob' || tool === 'grep') ? [workspaceRoot] : [];
  }
  if (typeof input === 'string') return [input];
  if (Array.isArray(input)) {
    return input.flatMap((entry) => extractTargetPaths(toolName, entry, workspaceRoot));
  }
  if (typeof input !== 'object') return [];

  const results = [];
  const pushValue = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      results.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => pushValue(entry));
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.file_path === 'string') results.push(value.file_path);
      if (typeof value.path === 'string') results.push(value.path);
      if (typeof value.directory === 'string') results.push(value.directory);
    }
  };

  pushValue(input.file_path);
  pushValue(input.path);
  pushValue(input.directory);
  pushValue(input.files);
  pushValue(input.paths);

  if (results.length === 0 && (tool === 'glob' || tool === 'grep')) {
    return [workspaceRoot];
  }

  return results;
}

async function resolveRealPathForCheck(normalizedPath) {
  try {
    const resolved = await fs.realpath(normalizedPath);
    return normalizeAbsolutePath(resolved, '/');
  } catch {
    const parent = path.posix.dirname(normalizedPath);
    if (!parent || parent === normalizedPath) {
      return null;
    }
    try {
      const resolvedParent = await fs.realpath(parent);
      return normalizeAbsolutePath(resolvedParent, '/');
    } catch {
      return null;
    }
  }
}

export function resolveUserRoot({ workspace, claudeHome, sessionsRoot, userId }) {
  const baseDir = workspace || process.cwd();
  if (claudeHome) {
    return normalizeAbsolutePath(claudeHome, baseDir);
  }
  if (sessionsRoot && userId) {
    return normalizeAbsolutePath(path.posix.join(sessionsRoot, sanitizeId(userId)), baseDir);
  }
  if (workspace && sessionsRoot) {
    const normalizedWorkspace = normalizeAbsolutePath(workspace, baseDir);
    const normalizedSessionsRoot = normalizeAbsolutePath(sessionsRoot, baseDir);
    if (isUnderPrefix(normalizedWorkspace, normalizedSessionsRoot)) {
      const remainder = normalizedWorkspace.slice(ensureTrailingSlash(normalizedSessionsRoot).length);
      const segments = remainder.split('/').filter(Boolean);
      if (segments.length > 0) {
        return normalizeAbsolutePath(path.posix.join(normalizedSessionsRoot, segments[0]), baseDir);
      }
    }
  }
  return null;
}

export function createPathSecurity({
  workspace,
  userId,
  claudeHome,
  sessionsRoot,
  extraReadPrefixes,
  extraWritePrefixes,
  extraBlockedPrefixes,
  env = process.env,
} = {}) {
  const workspaceRoot = normalizeAbsolutePath(workspace || process.cwd(), process.cwd());
  const sessionsRootNormalized = normalizePrefix(
    sessionsRoot || env.CLAUDE_SESSIONS_ROOT || DEFAULT_SESSIONS_ROOT,
    workspaceRoot
  );
  const userRoot = resolveUserRoot({
    workspace: workspaceRoot,
    claudeHome,
    sessionsRoot: sessionsRootNormalized,
    userId,
  });
  const userSessionsRoot = userRoot ? normalizeAbsolutePath(path.posix.join(userRoot, 'sessions'), workspaceRoot) : null;
  const skillsRoot = claudeHome
    ? normalizeAbsolutePath(path.posix.join(normalizeAbsolutePath(claudeHome, workspaceRoot), '.claude'), workspaceRoot)
    : null;

  const envReadPrefixes = parseEnvPrefixes(env.CLAUDE_READ_ALLOWED_PREFIXES);
  const envWritePrefixes = parseEnvPrefixes(env.CLAUDE_WRITE_ALLOWED_PREFIXES);
  const envBlockedPrefixes = parseEnvPrefixes(env.CLAUDE_BLOCKED_PREFIXES);

  const readAllowedPrefixes = normalizePrefixList(
    [
      workspaceRoot,
      userSessionsRoot,
      '/app',
      skillsRoot,
      ...(extraReadPrefixes || []),
      ...envReadPrefixes,
    ],
    workspaceRoot,
    { requireAbsolute: true }
  );

  // Allow writes to:
  // 1. workspaceRoot - current session workspace (primary)
  // 2. userSessionsRoot - all user sessions (for cross-session file sharing)
  // 3. userRoot - entire user directory (for ~/Documents, ~/Downloads, etc.)
  //    Risk assessment: Low - user isolation is enforced at lines 282-290,
  //    system directories are blocked by blockedPrefixes
  const writeAllowedPrefixes = normalizePrefixList(
    [
      workspaceRoot,
      userSessionsRoot,
      userRoot,
      ...(extraWritePrefixes || []),
      ...envWritePrefixes,
    ],
    workspaceRoot,
    { requireAbsolute: true }
  );

  const blockedPrefixes = normalizePrefixList(
    [
      ...DEFAULT_BLOCKED_PREFIXES,
      ...(extraBlockedPrefixes || []),
      ...envBlockedPrefixes,
    ],
    workspaceRoot,
    { requireAbsolute: true }
  );

  const debugInfo = {
    workspace: workspaceRoot,
    userRoot,
    sessionsRoot: sessionsRootNormalized,
    readAllowedPrefixes,
    writeAllowedPrefixes,
    blockedPrefixes,
  };

  const canUseTool = async (toolName, input, _options) => {
    const tool = normalizeToolName(toolName);
    const updatedInput = normalizeUpdatedInput(input ?? {});
    if (!FILE_TOOLS.has(tool)) {
      return { behavior: 'allow', updatedInput };
    }

    const targets = extractTargetPaths(tool, input, workspaceRoot);
    if (targets.length === 0) {
      return {
        behavior: 'deny',
        message: `❌ Cannot determine target path for ${toolName}`,
        interrupt: true,
      };
    }

    for (const target of targets) {
      const normalized = normalizeAbsolutePath(target, workspaceRoot);
      const realPath = await resolveRealPathForCheck(normalized);
      const candidates = realPath ? [normalized, realPath] : [normalized];

      for (const candidate of candidates) {
        if (sessionsRootNormalized && userRoot) {
          if (isUnderPrefix(candidate, sessionsRootNormalized) && !isUnderPrefix(candidate, userRoot)) {
            return {
              behavior: 'deny',
              message: `❌ Cross-user access blocked: ${normalized}`,
              interrupt: true,
            };
          }
        }

        if (blockedPrefixes.some((prefix) => isUnderPrefix(candidate, prefix))) {
          return {
            behavior: 'deny',
            message: `❌ Access denied: ${normalized}`,
            interrupt: true,
          };
        }

        if (WRITE_TOOLS.has(tool)) {
          if (!writeAllowedPrefixes.some((prefix) => isUnderPrefix(candidate, prefix))) {
            return {
              behavior: 'deny',
              message: `❌ Write outside allowed paths: ${normalized}`,
              interrupt: true,
            };
          }
          continue;
        }

        if (READ_TOOLS.has(tool)) {
          if (!readAllowedPrefixes.some((prefix) => isUnderPrefix(candidate, prefix))) {
            return {
              behavior: 'deny',
              message: `❌ Read outside allowed paths: ${normalized}`,
              interrupt: true,
            };
          }
        }
      }
    }

    return { behavior: 'allow', updatedInput };
  };

  return {
    canUseTool,
    debugInfo,
  };
}
