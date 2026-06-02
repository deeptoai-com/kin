/**
 * Permission Server Functions
 *
 * Server-side functions for permission management
 * Now supports organization-level permissions via Better Auth Organization plugin
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { auth } from '~/server/auth.server';
import { getRequest } from '@tanstack/react-start/server';
import { db } from '~/db/db-config';
import { organization, member } from '~/db/schema';
import { eq, and } from 'drizzle-orm';
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

// Organization permission settings stored in metadata
interface OrganizationPermissionSettings {
  permissionMode?: ServerPermissionMode;
  allowBash?: boolean;
}

/**
 * Get current user's permission info
 * Reads from organization metadata (if available) or falls back to environment variables
 */
export const getPermissionInfo = createServerFn({ method: 'GET' })
  .handler(async () => {
    // Get the current session
    const headers = await getRequest().headers;
    const session = await auth.api.getSession({
      headers,
    });

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

    const user = session.user;

    // Check if user has an active organization
    const activeOrganizationId = session.session?.activeOrganizationId;

    if (!activeOrganizationId) {
      // No organization - use environment variables as fallback
      return getPermissionInfoFromEnv(user.id, null, null);
    }

    // Fetch organization and member info
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

    if (!org || !memberInfo) {
      // Invalid organization state - fall back to environment variables
      return getPermissionInfoFromEnv(user.id, null, null);
    }

    // Parse organization metadata for permission settings
    let orgSettings: OrganizationPermissionSettings = {};
    try {
      orgSettings = org.metadata ? JSON.parse(org.metadata) : {};
    } catch {
      console.warn('Failed to parse organization metadata:', org.metadata);
    }

    // Get defaults from environment variables
    const defaultMode = (process.env.CLAUDE_PERMISSION_MODE as PermissionMode) || 'default';
    const defaultAllowBash = process.env.CLAUDE_ALLOW_BASH === 'true';

    // Organization settings override environment variables
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
      // All other modes are used as-is (plan, dontAsk, acceptEdits, default)
      actualMode = permissionMode;
    }

    // Resolve disallowed tools
    let disallowedTools: string[] = [];
    if (!(actualMode === 'bypassPermissions' && allowBash)) {
      disallowedTools = ['Bash'];
    }

    return {
      mode: actualMode,
      bashEnabled: actualMode === 'bypassPermissions' && allowBash,
      isWhitelisted,
      disallowedTools,
      userId: user.id,
      organizationId: activeOrganizationId,
      role: memberInfo.role,
    };
  });

/**
 * Update organization permission settings (admin/owner only)
 */
export const updateOrganizationPermissions = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    organizationId: z.string(),
    permissionMode: z.enum(ALL_PERMISSION_MODES).optional(),
    allowBash: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    // Verify authentication
    const headers = await getRequest().headers;
    const session = await auth.api.getSession({
      headers,
    });

    if (!session?.user) {
      throw new Error('Unauthorized: Authentication required');
    }

    // Check if user is owner or admin of this organization
    const memberInfo = await db.query.member.findFirst({
      where: and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, data.organizationId)
      ),
    });

    if (!memberInfo) {
      throw new Error('Forbidden: Not a member of this organization');
    }

    if (memberInfo.role !== 'owner' && memberInfo.role !== 'admin') {
      throw new Error('Forbidden: Owner or admin role required');
    }

    // Fetch current organization
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, data.organizationId),
    });

    if (!org) {
      throw new Error('Not Found: Organization not found');
    }

    // Parse existing metadata
    let metadata: OrganizationPermissionSettings = {};
    try {
      metadata = org.metadata ? JSON.parse(org.metadata) : {};
    } catch {
      console.warn('Failed to parse organization metadata:', org.metadata);
    }

    // Update metadata with new settings
    if (data.permissionMode !== undefined) {
      metadata.permissionMode = data.permissionMode;
    }
    if (data.allowBash !== undefined) {
      metadata.allowBash = data.allowBash;
    }

    // Save updated metadata
    await db
      .update(organization)
      .set({
        metadata: JSON.stringify(metadata),
      })
      .where(eq(organization.id, data.organizationId));

    return {
      success: true,
      message: 'Organization permissions updated successfully',
    };
  });

/**
 * Fallback to environment variables when no organization is set
 */
function getPermissionInfoFromEnv(
  userId: string | null,
  organizationId: string | null,
  role: string | null
) {
  // Read environment variables
  const permissionMode = (process.env.CLAUDE_PERMISSION_MODE as PermissionMode) || 'default';
  const bypassUserIds = (process.env.CLAUDE_BYPASS_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const allowBash = process.env.CLAUDE_ALLOW_BASH === 'true';

  // Check if user is in bypass whitelist
  const isWhitelisted = userId ? bypassUserIds.includes(userId) : false;

  const normalizedMode = ALL_PERMISSION_MODES.includes(permissionMode)
    ? permissionMode
    : 'default';

  // Resolve actual permission mode (bypass requires whitelist, others use as-is)
  const actualMode = normalizedMode === 'bypassPermissions' && isWhitelisted
    ? 'bypassPermissions'
    : normalizedMode === 'bypassPermissions'
      ? 'default'
      : normalizedMode;

  // Resolve disallowed tools
  let disallowedTools: string[] = [];
  if (!(actualMode === 'bypassPermissions' && allowBash)) {
    disallowedTools = ['Bash'];
  }

  return {
    mode: actualMode,
    bashEnabled: actualMode === 'bypassPermissions' && allowBash,
    isWhitelisted,
    disallowedTools,
    userId,
    organizationId,
    role,
  };
}
