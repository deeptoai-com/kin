/**
 * Perf rollup + retention (P2).
 *
 * rollupHourly(): aggregate recent raw perf_sample rows into perf_metric_hourly
 * (idempotent — recomputes the trailing few buckets each run).
 * pruneRetention(): drop data past its retention window. Defaults follow Bob's
 * research §6: raw 7d, hourly 30d, audit 180d (configurable), rag_trace 30d.
 *
 * Both swallow nothing critical but log + rethrow at the job boundary so BullMQ
 * records failures; callers are the worker's daily/hourly maintenance job.
 */

import { db } from '~/db/db-config';
import { sql } from 'drizzle-orm';

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : fallback;
}

/**
 * Recompute hourly aggregates for the trailing window (default last 3 hours) so
 * a just-closed hour is captured. Idempotent: deletes then re-inserts those buckets.
 */
export async function rollupHourly(trailingHours = 3): Promise<{ buckets: number }> {
  const since = new Date(Date.now() - trailingHours * 3600_000);

  // Remove any existing aggregates in the recompute window, then re-insert.
  await db.execute(sql`
    delete from "perf_metric_hourly"
    where "bucket_start" >= date_trunc('hour', ${since.toISOString()}::timestamptz)
  `);

  const result = await db.execute(sql`
    insert into "perf_metric_hourly"
      ("id", "bucket_start", "metric", "route", "model", "scenario", "count", "avg", "p50", "p95", "max", "created_at")
    select
      'perfagg_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
      date_trunc('hour', "created_at") as bucket_start,
      "metric",
      "route",
      "model",
      "scenario",
      count(*)::int,
      coalesce(avg("value"), 0),
      coalesce(percentile_cont(0.5) within group (order by "value"), 0),
      coalesce(percentile_cont(0.95) within group (order by "value"), 0),
      coalesce(max("value"), 0),
      now()
    from "perf_sample"
    where "created_at" >= date_trunc('hour', ${since.toISOString()}::timestamptz)
    group by date_trunc('hour', "created_at"), "metric", "route", "model", "scenario"
  `);

  return { buckets: (result as { rowCount?: number }).rowCount ?? 0 };
}

/** Delete data past its retention window. Returns per-table deleted counts. */
export async function pruneRetention(): Promise<Record<string, number>> {
  const rawDays = intEnv('PERF_RAW_RETENTION_DAYS', 7);
  const hourlyDays = intEnv('PERF_HOURLY_RETENTION_DAYS', 30);
  const ragDays = intEnv('RAG_TRACE_RETENTION_DAYS', 30);
  const auditDays = intEnv('AUDIT_RETENTION_DAYS', 180);
  const auditForever = (process.env.AUDIT_RETENTION_FOREVER ?? 'false').toLowerCase() === 'true';

  const del = async (table: string, days: number): Promise<number> => {
    const res = await db.execute(
      sql`delete from ${sql.raw(`"${table}"`)} where "created_at" < now() - ${`${days} days`}::interval`,
    );
    return (res as { rowCount?: number }).rowCount ?? 0;
  };

  const counts: Record<string, number> = {
    perf_sample: await del('perf_sample', rawDays),
    perf_metric_hourly: await del('perf_metric_hourly', hourlyDays),
    rag_search_trace: await del('rag_search_trace', ragDays),
  };
  // Audit is more sensitive: default 180d, opt-in forever.
  counts.audit_log = auditForever ? 0 : await del('audit_log', auditDays);

  return counts;
}
