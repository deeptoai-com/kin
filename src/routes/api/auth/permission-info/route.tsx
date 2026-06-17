import { createFileRoute } from '@tanstack/react-router';
import { auth } from '~/server/auth.server';
import { db } from '~/db/db-config';
import { user } from '~/db/schema';
import { eq } from 'drizzle-orm';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import {
  resolveCapabilityConfig,
  resolveBashEnabled,
  egressEnvValue,
} from '~/server/config/system-settings.server';

/**
 * Get Permission Info API Endpoint (single-organization model).
 *
 * Called by the WebSocket server to fetch the user's effective capability settings.
 * Resolves through the runtime capability config (DB → env → default) + the user's
 * system role + an optional per-user bypass whitelist — NOT a multi-tenant org graph.
 * The `organizationId` field is kept (always null) for response-shape compatibility.
 *
 * ws-server materializes `egressAllowedDomains` into the worker env, so an admin's
 * egress / shell / mode change takes effect on the next spawned worker — no restart.
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

          const cfg = await resolveCapabilityConfig();
          const bypassUserIds = (process.env.CLAUDE_BYPASS_USER_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

          // Privileged = system admin OR explicitly whitelisted by id.
          const isWhitelisted =
            systemRole === 'admin' || bypassUserIds.includes(sessionUser.id);

          // bypassPermissions requires privilege; other modes are used as-is.
          const actualMode: PermissionMode =
            cfg.permissionMode === 'bypassPermissions'
              ? isWhitelisted
                ? 'bypassPermissions'
                : 'default'
              : cfg.permissionMode;

          // Shell capability follows the admin-set audience (everyone/admins/off),
          // decoupled from permissionMode. Native Bash stays disallowed in the worker.
          const allowBash = resolveBashEnabled(cfg, isWhitelisted);

          return Response.json({
            userId: sessionUser.id,
            organizationId: null,
            role: systemRole,
            permissionMode: actualMode,
            allowBash,
            // EXEC_SANDBOX_ALLOWED_DOMAINS value for the worker sandbox:
            // '' curated · 'off' deny-all · 'all' unfiltered · csv → exact list.
            egressAllowedDomains: egressEnvValue(cfg),
          });
        } catch (error) {
          console.error('[Permission Info API] Error:', error);
          return Response.json({ error: 'Internal server error' }, { status: 500 });
        }
      },
    },
  },
});
