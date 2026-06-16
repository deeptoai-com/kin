/**
 * Performance sample recorder (P2).
 *
 * recordPerfSamples() appends rows to perf_sample. Like recordAudit / the usage
 * recorder it NEVER throws — observability must not break the path it measures.
 * Input is sanitised to numeric values + low-cardinality dimensions; callers must
 * never pass conversation content.
 */

import { db } from '~/db/db-config';
import { perfSample } from '~/db/schema';

export interface PerfSampleInput {
  metric: string;
  value: number;
  unit?: string;
  route?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  model?: string | null;
  scenario?: string | null;
  runId?: string | null;
  attrs?: Record<string, unknown> | null;
}

const MAX_BATCH = 50;

/** Coerce one raw sample into a valid row, or null if it can't be salvaged. */
function toRow(s: PerfSampleInput) {
  if (!s || typeof s.metric !== 'string' || !s.metric.trim()) return null;
  const value = Number(s.value);
  if (!Number.isFinite(value)) return null;
  return {
    metric: s.metric.trim().slice(0, 120),
    // numeric column — Drizzle wants a string for numeric()
    value: value.toFixed(3),
    unit: (s.unit ?? 'ms').slice(0, 24),
    route: s.route ? String(s.route).slice(0, 120) : null,
    userId: s.userId ? String(s.userId).slice(0, 120) : null,
    sessionId: s.sessionId ? String(s.sessionId).slice(0, 120) : null,
    model: s.model ? String(s.model).slice(0, 120) : null,
    scenario: (s.scenario ?? 'runtime').slice(0, 60),
    runId: s.runId ? String(s.runId).slice(0, 120) : null,
    attrs: s.attrs && typeof s.attrs === 'object' ? s.attrs : {},
  };
}

export async function recordPerfSamples(samples: PerfSampleInput[]): Promise<number> {
  try {
    if (!Array.isArray(samples) || samples.length === 0) return 0;
    const rows = samples.slice(0, MAX_BATCH).map(toRow).filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length === 0) return 0;
    await db.insert(perfSample).values(rows);
    return rows.length;
  } catch (error) {
    console.error('[perf] failed to record samples', error);
    return 0;
  }
}
