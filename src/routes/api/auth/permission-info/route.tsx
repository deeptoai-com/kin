import { createFileRoute } from '@tanstack/react-router';
import { auth } from '~/server/auth.server';
import { db } from '~/db/db-config';
import { organization, member } from '~/db/schema';
import { eq, and } from 'drizzle-orm';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

// All permission modes supported by the SDK
const ALL_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'delegate',
  'bypassPermissions',
];

/**
 * Get Permission Info API Endpoint
 *
 * Called by WebSocket server to fetch user's organization-based permission settings.
 * Returns permission mode and tool access control based on:
 * 1. Organization metadata (if user has active organization)
 * 2. Environment variables (fallback)
 * 3. Hardcoded defaults (final fallback)
 */
export const Route = createFileRoute('/api/auth/permission-info')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          // Get session from cookie
          const session = await auth.api.getSession({
            headers: request.headers,
          });

          if (!session?.user) {
            return Response.json(
              { error: 'Unauthorized' },
              { status: 401 }
            );
          }

          const user = session.user;
          const activeOrganizationId = session.session?.activeOrganizationId;

          // Default response structure
          const response = {
            userId: user.id,
            organizationId: activeOrganizationId || null,
            role: null as string | null,
            permissionMode: 'default' as PermissionMode,
            allowBash: false as boolean,
          };

          // If user has an active organization, fetch org settings
          if (activeOrganizationId) {
            const [org, memberInfo] = await Promise.all([
              db.query.organization.findFirst({
                where: eq(organization.id, activeOrganizationId),
              }),
              db.query.member.findFirst({
                where: and(
                  eq(member.userId, user.id),
                  eq(member.organizationId, activeOrganizationId)
                ),
              }),
            ]);

            if (org && memberInfo) {
              // Parse organization metadata for permission settings
              let orgSettings = {};
              try {
                orgSettings = org.metadata ? JSON.parse(org.metadata) : {};
              } catch (err) {
                console.warn('Failed to parse organization metadata:', org.metadata);
              }

              response.organizationId = activeOrganizationId;
              response.role = memberInfo.role;

              // Use org settings or fall back to env vars
              const defaultMode = (process.env.CLAUDE_PERMISSION_MODE as PermissionMode) || 'default';
              const defaultAllowBash = process.env.CLAUDE_ALLOW_BASH === 'true';

              const permissionMode = orgSettings.permissionMode || defaultMode;
              const allowBash = orgSettings.allowBash ?? defaultAllowBash;

              // Check if user has admin role (for bypass mode)
              const isWhitelisted = memberInfo.role === 'owner' || memberInfo.role === 'admin';

              // Resolve actual permission mode
              // For bypassPermissions, require admin role; for other modes, use as-is
              let actualMode: PermissionMode;
              if (permissionMode === 'bypassPermissions') {
                // Bypass mode requires admin role
                actualMode = isWhitelisted ? 'bypassPermissions' : 'default';
              } else {
                // All other modes are used as-is (plan, dontAsk, acceptEdits, delegate, default)
                actualMode = permissionMode;
              }

              response.permissionMode = actualMode;
              response.allowBash = actualMode === 'bypassPermissions' && allowBash;
            }
          } else {
            // No organization - use environment variables
            const permissionMode = (process.env.CLAUDE_PERMISSION_MODE as PermissionMode) || 'default';
            const bypassUserIds = (process.env.CLAUDE_BYPASS_USER_IDS || '')
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean);
            const isWhitelisted = bypassUserIds.includes(user.id);

            // Resolve actual permission mode
            let actualMode: PermissionMode;
            if (permissionMode === 'bypassPermissions') {
              actualMode = isWhitelisted ? 'bypassPermissions' : 'default';
            } else {
              actualMode = permissionMode;
            }

            response.permissionMode = actualMode;
            response.allowBash = actualMode === 'bypassPermissions' && process.env.CLAUDE_ALLOW_BASH === 'true';
          }

          return Response.json(response);
        } catch (error) {
          console.error('[Permission Info API] Error:', error);
          return Response.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        }
      },
    },
  },
});
