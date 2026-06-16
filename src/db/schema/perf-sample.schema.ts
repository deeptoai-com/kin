/**
 * Performance Observability Schema (P2)
 *
 * Lightweight, self-hosted observability baseline — Postgres raw samples plus an
 * hourly rollup, no external metrics stack (see the Admin observability PRD §6 and
 * Bob's storage-selection研究: Postgres raw + aggregate is the chosen真源).
 *
 * Hard rules:
 * - Writes are fire-and-forget: recordPerfSample() swallows its own errors and
 *   must never break the path it measures (mirrors recordAudit / usage recorder).
 * - NO conversation content. Only numeric metrics + low-cardinality dimensions.
 * - Retention is enforced by a daily cleanup job: raw 7d, hourly 30d (configurable
 *   via PERF_RAW_RETENTION_DAYS / PERF_HOURLY_RETENTION_DAYS).
 */

import { index, integer, jsonb, numeric, pgTable, text } from 'drizzle-orm/pg-core';
import { generateId } from '~/utils/id-generator';
import { createdAt, timestamptz } from './_shared';

/**
 * Raw per-event samples (default 7-day retention). One row per measured event,
 * e.g. a generation's TTFT, a generation's total duration, a preview cold start.
 */
export const perfSample = pgTable(
  'perf_sample',
  {
    id: text('id')
      .$defaultFn(() => generateId('perf'))
      .primaryKey(),

    // Dotted metric key, e.g. 'generation.ttft_ms', 'generation.total_ms',
    // 'generation.tokens_per_s', 'rag.search_ms', 'preview.cold_start_ms'.
    metric: text('metric').notNull(),

    // Numeric value in `unit`. numeric to avoid float drift on aggregation.
    value: numeric('value', { precision: 18, scale: 3 }).notNull(),

    // 'ms' | 'count' | 'tokens_per_s' | 'bytes' | …
    unit: text('unit').notNull().default('ms'),

    // Coarse origin route, e.g. 'ws.generate', 'rag.search', 'preview.start'.
    route: text('route'),

    // Optional dimensions — organization-internal management only, never content.
    userId: text('user_id'),
    sessionId: text('session_id'),
    model: text('model'),

    // 'runtime' for常驻采集, or a load-test scenario name. runId groups one run.
    scenario: text('scenario').notNull().default('runtime'),
    runId: text('run_id'),

    // Low-cardinality structured context, e.g. { queued: true, workerCount: 8 }.
    attrs: jsonb('attrs').$type<Record<string, unknown>>().default({}),

    createdAt: createdAt(),
  },
  (table) => ({
    metricCreatedIdx: index('perf_sample_metric_created_idx').on(table.metric, table.createdAt),
    createdAtIdx: index('perf_sample_created_at_idx').on(table.createdAt),
    scenarioIdx: index('perf_sample_scenario_idx').on(table.scenario),
  }),
);

/**
 * Hourly rollup (default 30-day retention). Populated by the aggregate job; the
 * Admin Performance trends read from here for anything older than the raw window.
 */
export const perfMetricHourly = pgTable(
  'perf_metric_hourly',
  {
    id: text('id')
      .$defaultFn(() => generateId('perfagg'))
      .primaryKey(),

    bucketStart: timestamptz('bucket_start').notNull(),
    metric: text('metric').notNull(),
    route: text('route'),
    model: text('model'),
    scenario: text('scenario').notNull().default('runtime'),

    count: integer('count').notNull().default(0),
    avg: numeric('avg', { precision: 18, scale: 3 }).notNull().default('0'),
    p50: numeric('p50', { precision: 18, scale: 3 }).notNull().default('0'),
    p95: numeric('p95', { precision: 18, scale: 3 }).notNull().default('0'),
    max: numeric('max', { precision: 18, scale: 3 }).notNull().default('0'),

    createdAt: createdAt(),
  },
  (table) => ({
    bucketMetricIdx: index('perf_hourly_bucket_metric_idx').on(table.bucketStart, table.metric),
    metricIdx: index('perf_hourly_metric_idx').on(table.metric),
  }),
);
