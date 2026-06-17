import { createFileRoute } from '@tanstack/react-router';
import { auth } from '~/server/auth.server';
import { db } from '~/db/db-config';
import { user } from '~/db/schema';
import { eq } from 'drizzle-orm';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

// All permission modes supported by the SDK
const ALL_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'bypassPermissions',
];

/**
 * Get Permission Info API Endpoint (single-organization model).
 *
 * Called by the WebSocket server to fetch the user's effective permission settings.
 * Resolves from environment defaults + the user's system role + an optional per-user
 * bypass whitelist — NOT from a multi-tenant organization/member graph (removed; this
 * mirrors permissions.server.ts `getPermissionInfo`). The `organizationId` field is kept
 * (always null) for response-shape compatibility with the WS server.
 */
export const Route = createFileRoute('/api/auth/permission-info')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await auth.api.getSession({
            headers: request.headers,
          });

          if (!session?.user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
          }

          const sessionUser = session.user;

          // System role drives admin-level privileges (replaces org owner/admin role).
          const userRow = await db.query.user.findFirst({
            where: eq(user.id, sessionUser.id),
            columns: { id: true, systemRole: true },
          });
          const systemRole = userRow?.systemRole ?? null;

          const rawMode = (process.env.CLAUDE_PERMISSION_MODE as PermissionMode) || 'default';
          const permissionMode = ALL_PERMISSION_MODES.includes(rawMode) ? rawMode : 'default';
          const bypassUserIds = (process.env.CLAUDE_BYPASS_USER_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
          const allowBash = process.env.CLAUDE_ALLOW_BASH === 'true';

          // Privileged = system admin OR explicitly whitelisted by id.
          const isWhitelisted = systemRole === 'admin' || bypassUserIds.includes(sessionUser.id);

          // bypassPermissions requires privilege; other modes are used as-is.
          const actualMode: PermissionMode =
            permissionMode === 'bypassPermissions'
              ? isWhitelisted
                ? 'bypassPermissions'
                : 'default'
              : permissionMode;

          // allowBash is an INDEPENDENT capability (privileged user + CLAUDE_ALLOW_BASH),
          // NOT coupled to permissionMode (which only governs Ask/Act). The worker uses
          // this to expose the sandboxed mcp__bash__run; native Bash stays disallowed.
          return Response.json({
            userId: sessionUser.id,
            organizationId: null,
            role: systemRole,
            permissionMode: actualMode,
            allowBash: isWhitelisted && allowBash,
          });
        } catch (error) {
          console.error('[Permission Info API] Error:', error);
          return Response.json({ error: 'Internal server error' }, { status: 500 });
        }
      },
    },
  },
});
