/**
 * Permission Server Functions
 *
 * Single-organization model: Kin serves one trusted org, so permissions resolve
 * from environment defaults + the user's system role + an optional per-user bypass
 * whitelist — NOT from a multi-tenant organization/member graph (that was removed,
 * see the Admin observability PRD §13 D1 / Bob's org-removal plan).
 *
 * Resolution:
 * - Base mode from CLAUDE_PERMISSION_MODE (default 'default').
 * - bypassPermissions is privileged: granted only to system admins or users listed
 *   in CLAUDE_BYPASS_USER_IDS; everyone else is downgraded to 'default'.
 * - Bash stays disallowed unless the effective mode is bypassPermissions AND
 *   CLAUDE_ALLOW_BASH=true.
 *
 * The returned shape keeps `organizationId` (always null) and `role` (= systemRole)
 * for backward compatibility with existing consumers.
 */

import { createServerFn } from '@tanstack/react-start';
import { auth } from '~/server/auth.server';
import { getRequest } from '@tanstack/react-start/server';
import { db } from '~/db/db-config';
import { user } from '~/db/schema';
import { eq } from 'drizzle-orm';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

// All supported permission modes (matching SDK)
export type ServerPermissionMode = PermissionMode;

// All permission modes supported by the SDK
const ALL_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'bypassPermissions',
];

/**
 * Get current user's permission info.
 * Resolves from environment defaults + system role + per-user bypass whitelist.
 */
export const getPermissionInfo = createServerFn({ method: 'GET' })
  .handler(async () => {
    const headers = await getRequest().headers;
    const session = await auth.api.getSession({ headers });

    if (!session?.user) {
      // Not authenticated - return safe defaults
      return {
        mode: 'default' as PermissionMode,
        bashEnabled: false,
        isWhitelisted: false,
        disallowedTools: ['Bash'],
        userId: null,
        organizationId: null,
        role: null,
      };
    }

    // System role drives admin-level privileges (replaces org owner/admin role).
    const userRow = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
      columns: { id: true, systemRole: true },
    });

    return resolvePermissionInfo(session.user.id, userRow?.systemRole ?? null);
  });

/**
 * Resolve permission info from environment + system role.
 */
function resolvePermissionInfo(userId: string | null, systemRole: string | null) {
  const permissionMode = (process.env.CLAUDE_PERMISSION_MODE as PermissionMode) || 'default';
  const bypassUserIds = (process.env.CLAUDE_BYPASS_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const allowBash = process.env.CLAUDE_ALLOW_BASH === 'true';

  // Privileged = system admin OR explicitly whitelisted by id.
  const isWhitelisted =
    systemRole === 'admin' || (userId ? bypassUserIds.includes(userId) : false);

  const normalizedMode = ALL_PERMISSION_MODES.includes(permissionMode)
    ? permissionMode
    : 'default';

  // bypassPermissions requires privilege; other modes are used as-is.
  const actualMode: PermissionMode =
    normalizedMode === 'bypassPermissions'
      ? isWhitelisted
        ? 'bypassPermissions'
        : 'default'
      : normalizedMode;

  // allowBash is an INDEPENDENT capability (privileged user + CLAUDE_ALLOW_BASH),
  // decoupled from permissionMode (which only governs Ask/Act interrupt behavior).
  const bashEnabled = isWhitelisted && allowBash;

  // Native Claude Code `Bash` is ALWAYS disallowed — it bypasses our sandbox (path
  // fence, resource limits, egress allowlist, env-stripping). Shell capability is
  // delivered only via the sandboxed mcp__bash__run wrapper (gated on bashEnabled).
  const disallowedTools = ['Bash'];

  return {
    mode: actualMode,
    bashEnabled,
    isWhitelisted,
    disallowedTools,
    userId,
    organizationId: null as string | null,
    role: systemRole,
  };
}
