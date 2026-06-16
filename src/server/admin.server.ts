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
  usageRecord,
  auditLog,
  updateStatus,
  creditBalances,
  creditLedger,
  subscriptions,
  plans,
} from '~/db/schema';
import { eq, sql, desc, inArray, gte, and, like } from 'drizzle-orm';

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
 * Usage aggregates over a trailing window (P1).
 *
 * Reads only `usage_record` (already populated by the result-event recorder).
 * Returns totals plus by-model, by-day and by-user breakdowns so the admin
 * Usage view can render without any new schema. No conversation content is read.
 */
export const getUsageAggregate = createServerFn({ method: 'GET' })
  .inputValidator((val) => {
    const days = Number((val as { days?: unknown } | undefined)?.days ?? 30);
    // Bound to a sane window; default 30d.
    return { days: Number.isFinite(days) ? Math.min(180, Math.max(1, Math.trunc(days))) : 30 };
  })
  .handler(async ({ data }) => {
    await requireSystemAdmin();

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (data.days - 1));

    const inWindow = gte(usageRecord.createdAt, since);

    const [totals, byModel, byDay, byUserRows] = await Promise.all([
      db
        .select({
          runs: sql<number>`count(distinct ${usageRecord.runId})::int`,
          rows: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::bigint`,
          costUsd: sql<string>`coalesce(sum(${usageRecord.costUsd}), 0)::text`,
          errors: sql<number>`count(*) filter (where ${usageRecord.isError})::int`,
        })
        .from(usageRecord)
        .where(inWindow),
      db
        .select({
          model: usageRecord.model,
          runs: sql<number>`count(distinct ${usageRecord.runId})::int`,
          inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::bigint`,
          costUsd: sql<string>`coalesce(sum(${usageRecord.costUsd}), 0)::text`,
        })
        .from(usageRecord)
        .where(inWindow)
        .groupBy(usageRecord.model)
        .orderBy(desc(sql`coalesce(sum(${usageRecord.outputTokens}), 0)`)),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${usageRecord.createdAt}), 'YYYY-MM-DD')`,
          inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::bigint`,
          costUsd: sql<string>`coalesce(sum(${usageRecord.costUsd}), 0)::text`,
        })
        .from(usageRecord)
        .where(inWindow)
        .groupBy(sql`date_trunc('day', ${usageRecord.createdAt})`)
        .orderBy(sql`date_trunc('day', ${usageRecord.createdAt})`),
      db
        .select({
          userId: usageRecord.userId,
          userName: user.name,
          userEmail: user.email,
          runs: sql<number>`count(distinct ${usageRecord.runId})::int`,
          inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::bigint`,
          costUsd: sql<string>`coalesce(sum(${usageRecord.costUsd}), 0)::text`,
        })
        .from(usageRecord)
        .leftJoin(user, eq(usageRecord.userId, user.id))
        .where(inWindow)
        .groupBy(usageRecord.userId, user.name, user.email)
        .orderBy(desc(sql`coalesce(sum(${usageRecord.outputTokens}), 0)`))
        .limit(50),
    ]);

    const num = (v: number | string | null | undefined) => Number(v ?? 0);
    const t = totals[0];
    return {
      days: data.days,
      since: since.toISOString(),
      totals: {
        runs: t?.runs ?? 0,
        rows: t?.rows ?? 0,
        inputTokens: num(t?.inputTokens),
        outputTokens: num(t?.outputTokens),
        totalTokens: num(t?.inputTokens) + num(t?.outputTokens),
        costUsd: num(t?.costUsd),
        errors: t?.errors ?? 0,
      },
      byModel: byModel.map((r) => ({
        model: r.model,
        runs: r.runs,
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        costUsd: num(r.costUsd),
      })),
      byDay: byDay.map((r) => ({
        day: r.day,
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        totalTokens: num(r.inputTokens) + num(r.outputTokens),
        costUsd: num(r.costUsd),
      })),
      byUser: byUserRows.map((r) => ({
        userId: r.userId,
        name: r.userName ?? null,
        email: r.userEmail ?? null,
        runs: r.runs,
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        totalTokens: num(r.inputTokens) + num(r.outputTokens),
        costUsd: num(r.costUsd),
      })),
    };
  });

/**
 * Paginated audit-log listing with optional action / user filters (P1).
 *
 * Read-only over `audit_log`. `meta` may contain structured context but never
 * conversation content (audit rows are written by recordAudit at action sites).
 */
export const listAuditLog = createServerFn({ method: 'GET' })
  .inputValidator((val) => {
    const v = (val ?? {}) as Record<string, unknown>;
    const limitRaw = Number(v.limit ?? 50);
    const offsetRaw = Number(v.offset ?? 0);
    return {
      action: typeof v.action === 'string' && v.action.trim() ? v.action.trim() : undefined,
      userId: typeof v.userId === 'string' && v.userId.trim() ? v.userId.trim() : undefined,
      limit: Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.trunc(limitRaw))) : 50,
      offset: Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0,
    };
  })
  .handler(async ({ data }) => {
    await requireSystemAdmin();

    const conditions = [];
    if (data.action) conditions.push(like(auditLog.action, `${data.action}%`));
    if (data.userId) conditions.push(eq(auditLog.userId, data.userId));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, countRows, actionRows] = await Promise.all([
      db
        .select({
          id: auditLog.id,
          userId: auditLog.userId,
          action: auditLog.action,
          target: auditLog.target,
          meta: auditLog.meta,
          ip: auditLog.ip,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(data.limit)
        .offset(data.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where),
      // Distinct action keys for the filter dropdown (bounded list).
      db
        .selectDistinct({ action: auditLog.action })
        .from(auditLog)
        .orderBy(auditLog.action)
        .limit(100),
    ]);

    return {
      rows,
      total: countRows[0]?.total ?? 0,
      limit: data.limit,
      offset: data.offset,
      actions: actionRows.map((r) => r.action),
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
