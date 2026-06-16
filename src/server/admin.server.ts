/**
 * System Admin Server Functions
 *
 * Server-side functions for system administrator operations
 */

import { createServerFn } from '@tanstack/react-start';
import { redirect } from '@tanstack/react-router';
import { auth } from '~/server/auth.server';
import { getRequest } from '@tanstack/react-start/server';
import { db } from '~/db/db-config';
import {
  user,
  organization,
  member,
  usageRecord,
  updateStatus,
  creditBalances,
  creditLedger,
  subscriptions,
  plans,
} from '~/db/schema';
import { eq, sql, desc, inArray, gte } from 'drizzle-orm';

function parseOrganizationMetadata(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Require system admin authentication
 * Throws redirect if user is not a system admin
 */
export const requireSystemAdmin = createServerFn({ method: 'GET' })
  .handler(async () => {
    // Get the current session
    const headers = await getRequest().headers;
    const session = await auth.api.getSession({
      headers,
    });

    if (!session?.user) {
      throw redirect({
        to: '/auth/$pathname',
        params: { pathname: 'sign-in' },
      });
    }

    // Fetch user with system role
    const userData = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
    });

    if (!userData) {
      throw redirect({
        to: '/auth/$pathname',
        params: { pathname: 'sign-in' },
      });
    }

    // Check if user is system admin
    if (userData.systemRole !== 'admin') {
      throw redirect({
        to: '/agents/c',
      });
    }

    return {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      systemRole: userData.systemRole,
    };
  });

/**
 * Get all users with their credits and subscriptions
 */
export const getAllUsers = createServerFn({ method: 'GET' })
  .handler(async () => {
    // Verify admin
    await requireSystemAdmin();

    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        systemRole: user.systemRole,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt));

    if (users.length === 0) {
      return [];
    }

    const userIds = users.map((entry) => entry.id);

    const balances = await db
      .select()
      .from(creditBalances)
      .where(inArray(creditBalances.userId, userIds));

    const subscriptionRows = await db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        planId: subscriptions.planId,
        status: subscriptions.status,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        polarSubscriptionId: subscriptions.polarSubscriptionId,
        createdAt: subscriptions.createdAt,
        updatedAt: subscriptions.updatedAt,
        planName: plans.name,
      })
      .from(subscriptions)
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(inArray(subscriptions.userId, userIds));

    const balancesByUser = new Map<string, typeof balances>();
    for (const balance of balances) {
      const list = balancesByUser.get(balance.userId) ?? [];
      list.push(balance);
      balancesByUser.set(balance.userId, list);
    }

    const subscriptionsByUser = new Map<
      string,
      Array<typeof subscriptionRows[number] & { plan: { id: string; name: string } }>
    >();
    for (const row of subscriptionRows) {
      const list = subscriptionsByUser.get(row.userId) ?? [];
      list.push({
        ...row,
        plan: {
          id: row.planId,
          name: row.planName ?? 'Unknown',
        },
      });
      subscriptionsByUser.set(row.userId, list);
    }

    return users.map((entry) => ({
      ...entry,
      creditBalances: balancesByUser.get(entry.id) ?? [],
      subscriptions: subscriptionsByUser.get(entry.id) ?? [],
    }));
  });

/**
 * Admin overview snapshot.
 *
 * P0 intentionally only uses already-available sources: users, usage_record,
 * update_status, model health and the in-process session registry. System
 * health and long-term performance metrics are P2.
 */
export const getAdminOverview = createServerFn({ method: 'GET' })
  .handler(async () => {
    await requireSystemAdmin();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      userStats,
      usageStats,
      updateRows,
      { sessionRegistry },
      { listModelsAdmin },
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          admins: sql<number>`count(*) filter (where ${user.systemRole} = 'admin')::int`,
        })
        .from(user),
      db
        .select({
          runs: sql<number>`count(distinct ${usageRecord.runId})::int`,
          inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::int`,
          costUsd: sql<string>`coalesce(sum(${usageRecord.costUsd}), 0)::text`,
        })
        .from(usageRecord)
        .where(gte(usageRecord.createdAt, startOfToday)),
      db.select().from(updateStatus).limit(1),
      import('~/server/concurrency/session-registry.js'),
      import('~/server/models/registry'),
    ]);

    const modelRows = await listModelsAdmin();
    const registrySnapshot = typeof sessionRegistry.snapshot === 'function'
      ? sessionRegistry.snapshot()
      : { totalWorkers: 0, activeWorkers: 0, silentWorkers: 0, byUser: [] };

    const modelSummary = modelRows.reduce(
      (acc, model) => {
        acc.total += 1;
        if (model.enabled) acc.enabled += 1;
        acc[model.health] += 1;
        return acc;
      },
      { total: 0, enabled: 0, healthy: 0, unhealthy: 0, unknown: 0 }
    );

    const update = updateRows[0] ?? null;
    const maxWorkers = Math.max(1, parseInt(process.env.MAX_CONCURRENT_WORKERS || '8', 10) || 8);
    const perUserMaxWorkers = Math.max(1, parseInt(process.env.PER_USER_MAX_WORKERS || '3', 10) || 3);

    return {
      users: {
        total: userStats[0]?.total ?? 0,
        admins: userStats[0]?.admins ?? 0,
      },
      usageToday: {
        runs: usageStats[0]?.runs ?? 0,
        inputTokens: usageStats[0]?.inputTokens ?? 0,
        outputTokens: usageStats[0]?.outputTokens ?? 0,
        totalTokens: (usageStats[0]?.inputTokens ?? 0) + (usageStats[0]?.outputTokens ?? 0),
        costUsd: Number(usageStats[0]?.costUsd ?? 0),
      },
      concurrency: {
        activeWorkers: registrySnapshot.activeWorkers,
        totalWorkers: registrySnapshot.totalWorkers,
        silentWorkers: registrySnapshot.silentWorkers,
        maxWorkers,
        perUserMaxWorkers,
        byUser: registrySnapshot.byUser,
      },
      models: modelSummary,
      update: {
        currentSha: update?.currentSha ?? process.env.BUILD_SHA ?? 'dev',
        latestSha: update?.latestSha ?? null,
        latestDigest: update?.latestDigest ?? null,
        updateAvailable: update?.updateAvailable ?? false,
        checkedAt: update?.checkedAt ?? null,
        image: update?.image ?? null,
        error: update?.error ?? null,
      },
      health: {
        app: 'healthy' as const,
        db: 'healthy' as const,
        worker: 'unknown' as const,
        redis: 'unknown' as const,
        minio: 'unknown' as const,
        meili: 'unknown' as const,
        parser: 'unknown' as const,
      },
    };
  });

/**
 * Add credits to a user
 */
export const addUserCredits = createServerFn({ method: 'POST' })
  .inputValidator(val => {
    if (typeof val !== 'object' || val === null) {
      throw new Error('Invalid input');
    }
    const { userId, amount, kind, note } = val as Record<string, unknown>;

    if (typeof userId !== 'string') {
      throw new Error('userId must be a string');
    }
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('amount must be a positive number');
    }
    if (typeof kind !== 'string' || !['purchase', 'gift', 'compensation'].includes(kind)) {
      throw new Error('kind must be one of: purchase, gift, compensation');
    }
    if (typeof note !== 'string') {
      throw new Error('note must be a string');
    }

    return { userId, amount, kind, note };
  })
  .handler(async ({ data }) => {
    // Verify admin
    await requireSystemAdmin();

    const { userId, amount, kind, note } = data;

    // Get current balance
    const balance = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.userId, userId),
    });

    // If balance doesn't exist, create it first
    if (!balance) {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      await db.insert(creditBalances).values({
        userId,
        periodStart,
        periodEnd,
        monthlyAllotment: 0,
        allotmentUsed: 0,
        extraCredits: 0,
        updatedAt: now,
      });

      // Now add credits to the newly created balance
      await db.update(creditBalances)
        .set({
          extraCredits: amount,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.userId, userId));
    } else {
      // Add extra credits to existing balance
      await db.update(creditBalances)
        .set({
          extraCredits: sql`${creditBalances.extraCredits} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.userId, userId));
    }

    // Record transaction in ledger
    await db.insert(creditLedger).values({
      userId,
      delta: amount,
      kind,
      meta: {
        note,
        adminAction: true,
      },
    });

    return { success: true };
  });

/**
 * Update user system role
 */
export const updateUserSystemRole = createServerFn({ method: 'POST' })
  .inputValidator(val => {
    if (typeof val !== 'object' || val === null) {
      throw new Error('Invalid input');
    }
    const { userId, role } = val as Record<string, unknown>;

    if (typeof userId !== 'string') {
      throw new Error('userId must be a string');
    }
    if (typeof role !== 'string' || !['admin', 'user'].includes(role)) {
      throw new Error('role must be either admin or user');
    }

    return { userId, role };
  })
  .handler(async ({ data }) => {
    // Verify admin
    const admin = await requireSystemAdmin();

    const { userId, role } = data;

    // Prevent admin from removing their own admin role
    if (userId === admin.id && role !== 'admin') {
      throw new Error('Cannot remove your own admin role');
    }

    // Update user role
    await db.update(user)
      .set({ systemRole: role })
      .where(eq(user.id, userId));

    return { success: true };
  });

/**
 * Get all organizations with member count
 */
export const getAllOrganizations = createServerFn({ method: 'GET' })
  .handler(async () => {
    // Verify admin
    await requireSystemAdmin();

    const orgs = await db
      .select()
      .from(organization)
      .orderBy(desc(organization.createdAt));

    if (orgs.length === 0) {
      return [];
    }

    const orgIds = orgs.map((entry) => entry.id);

    const memberRows = await db
      .select({
        memberId: member.id,
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .leftJoin(user, eq(member.userId, user.id))
      .where(inArray(member.organizationId, orgIds));

    const membersByOrg = new Map<string, Array<typeof memberRows[number]>>();
    for (const row of memberRows) {
      const list = membersByOrg.get(row.organizationId) ?? [];
      list.push(row);
      membersByOrg.set(row.organizationId, list);
    }

    return orgs.map((org) => {
      const members = membersByOrg.get(org.id) ?? [];
      const owner = members.find((entry) => entry.role === 'owner');

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        metadata: parseOrganizationMetadata(org.metadata),
        createdAt: org.createdAt,
        memberCount: members.length,
        owner: owner?.userId
          ? {
              id: owner.userId,
              name: owner.userName,
              email: owner.userEmail,
            }
          : null,
      };
    });
  });

/**
 * Create organization as system admin
 */
export const createOrganizationAsAdmin = createServerFn({ method: 'POST' })
  .inputValidator(val => {
    if (typeof val !== 'object' || val === null) {
      throw new Error('Invalid input');
    }
    const { name, slug, ownerId, permissionMode, allowBash } = val as Record<string, unknown>;

    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('name is required');
    }
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new Error('slug is required');
    }
    if (typeof ownerId !== 'string') {
      throw new Error('ownerId must be a string');
    }

    return {
      name,
      slug,
      ownerId,
      permissionMode: permissionMode || 'default',
      allowBash: allowBash || false,
    };
  })
  .handler(async ({ data }) => {
    // Verify admin
    await requireSystemAdmin();

    const { name, slug, ownerId, permissionMode, allowBash } = data;

    // Verify owner exists
    const ownerUser = await db.query.user.findFirst({
      where: eq(user.id, ownerId),
    });

    if (!ownerUser) {
      throw new Error('Owner user not found');
    }

    // Generate IDs
    const orgId = `org_${crypto.randomUUID().slice(0, 8)}`;
    const memberId = `mem_${crypto.randomUUID().slice(0, 8)}`;

    // Create organization with permission settings
    await db.insert(organization).values({
      id: orgId,
      name,
      slug,
      createdAt: new Date(),
      metadata: JSON.stringify({
        permissionMode,
        allowBash,
      }),
    });

    // Add owner as member
    await db.insert(member).values({
      id: memberId,
      organizationId: orgId,
      userId: ownerId,
      role: 'owner',
      createdAt: new Date(),
    });

    return { success: true, organizationId: orgId };
  });

/**
 * Delete organization
 */
export const deleteOrganization = createServerFn({ method: 'POST' })
  .inputValidator(val => {
    if (typeof val !== 'object' || val === null) {
      throw new Error('Invalid input');
    }
    const { organizationId } = val as Record<string, unknown>;

    if (typeof organizationId !== 'string') {
      throw new Error('organizationId must be a string');
    }

    return { organizationId };
  })
  .handler(async ({ data }) => {
    // Verify admin
    await requireSystemAdmin();

    const { organizationId } = data;

    // Delete organization (cascade will delete members)
    await db.delete(organization)
      .where(eq(organization.id, organizationId));

    return { success: true };
  });

/**
 * Get organization details with members
 */
export const getOrganizationDetails = createServerFn({ method: 'GET' })
  .inputValidator(val => {
    if (typeof val !== 'object' || val === null) {
      throw new Error('Invalid input');
    }
    const { organizationId } = val as Record<string, unknown>;

    if (typeof organizationId !== 'string') {
      throw new Error('organizationId must be a string');
    }

    return { organizationId };
  })
  .handler(async ({ data }) => {
    // Verify admin
    await requireSystemAdmin();

    const { organizationId } = data;

    const org = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);

    if (!org.length) {
      throw new Error('Organization not found');
    }

    const memberRows = await db
      .select({
        id: member.id,
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        userName: user.name,
        userEmail: user.email,
        userSystemRole: user.systemRole,
      })
      .from(member)
      .leftJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId));

    return {
      ...org[0],
      metadata: parseOrganizationMetadata(org[0].metadata),
      members: memberRows.map((entry) => ({
        id: entry.id,
        organizationId: entry.organizationId,
        userId: entry.userId,
        role: entry.role,
        createdAt: entry.createdAt,
        user: entry.userId
          ? {
              id: entry.userId,
              name: entry.userName,
              email: entry.userEmail,
              systemRole: entry.userSystemRole,
            }
          : null,
      })),
    };
  });
