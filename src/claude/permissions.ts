import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

const PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'bypassPermissions',
];

const PERMISSION_MODE_SET = new Set(PERMISSION_MODES);

const BYPASS_USER_IDS = new Set(
  (process.env.CLAUDE_BYPASS_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const ALLOW_BASH_IN_BYPASS = process.env.CLAUDE_ALLOW_BASH === 'true';

// Organization permission settings interface
export interface OrganizationPermissionSettings {
  permissionMode?: PermissionMode;
  allowBash?: boolean;
  role?: 'owner' | 'admin' | 'member';
}

export function normalizePermissionMode(mode?: string): PermissionMode {
  if (!mode) {
    return 'default';
  }
  if (PERMISSION_MODE_SET.has(mode as PermissionMode)) {
    return mode as PermissionMode;
  }
  return 'default';
}

/**
 * Resolve permission mode with support for organization-based configuration
 *
 * Priority:
 * 1. Organization settings (if provided and user has appropriate role)
 * 2. Environment variables
 * 3. Default values
 */
export function resolvePermissionMode(
  userId?: string,
  requestedMode?: string,
  orgSettings?: OrganizationPermissionSettings
): PermissionMode {
  // If organization settings are provided, use them with role-based access control
  if (orgSettings && orgSettings.permissionMode && orgSettings.role) {
    const isWhitelisted = orgSettings.role === 'owner' || orgSettings.role === 'admin';

    if (orgSettings.permissionMode === 'bypassPermissions') {
      // Bypass mode requires whitelist (owner/admin role)
      return isWhitelisted ? 'bypassPermissions' : 'default';
    }

    return orgSettings.permissionMode;
  }

  // Fallback to environment variables
  const normalized = normalizePermissionMode(requestedMode ?? process.env.CLAUDE_PERMISSION_MODE);

  if (normalized === 'bypassPermissions') {
    if (userId && BYPASS_USER_IDS.has(userId)) {
      return 'bypassPermissions';
    }
    return 'default';
  }

  return normalized;
}

/**
 * Resolve disallowed tools based on permission mode and organization settings
 */
export function resolveDisallowedTools(
  permissionMode: PermissionMode,
  orgSettings?: OrganizationPermissionSettings
): string[] {
  // Check if Bash is enabled via organization settings or environment variables
  const allowBash = orgSettings?.allowBash ?? ALLOW_BASH_IN_BYPASS;

  if (permissionMode === 'bypassPermissions' && allowBash) {
    return [];
  }
  return ['Bash'];
}

/**
 * Check if permissions should be skipped for a given mode
 */
export function shouldSkipPermissions(permissionMode: PermissionMode): boolean {
  return permissionMode === 'bypassPermissions';
}

/**
 * Parse organization metadata string to permission settings
 */
export function parseOrganizationMetadata(metadata: string | null): OrganizationPermissionSettings {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata);
    return {
      permissionMode: parsed.permissionMode,
      allowBash: parsed.allowBash,
    };
  } catch {
    console.warn('Failed to parse organization metadata:', metadata);
    return {};
  }
}
