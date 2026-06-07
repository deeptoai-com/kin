/**
 * Multi-model schema (model switching, PR1 of the full version)
 *
 * DB = runtime source of truth for which models/connections exist and are enabled;
 * seeded on first boot from `.env` (OXY_MODELS_SEED) and editable by admins in
 * `/admin/models`. **Secrets are NEVER stored here** — a connection only records the
 * NAME of the env var holding its token (`tokenEnv`); the value lives in `.env` and is
 * resolved server-side at spawn time. Health is produced by the 6h backend probe.
 *
 * See docs/project/prd/2026-06-multi-model-switching-prd.md (rev.3) §3 and
 * docs/project/research/2026-06-multi-model-context-pack.md.
 */

import { pgTable, text, integer, boolean, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt, timestamptz } from './_shared';

// How the connection authenticates to its Anthropic-compatible gateway.
// bearer  → ANTHROPIC_AUTH_TOKEN (Authorization: Bearer) — ARK / gateways
// x-api-key → ANTHROPIC_API_KEY (x-api-key header) — native Anthropic
export const modelAuthStyleEnum = pgEnum('model_auth_style', ['bearer', 'x-api-key']);

// Probe result. unknown = never probed / probe in flight.
export const modelHealthEnum = pgEnum('model_health', ['healthy', 'unhealthy', 'unknown']);

// ── model_connection ─ an Anthropic-compatible endpoint + one credential (an account)
export const modelConnection = pgTable('model_connection', {
  // Stable key, e.g. "ark-coding" (used as FK target; not user-facing).
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  // Anthropic-compatible base URL WITHOUT the /v1 suffix, e.g.
  // https://ark.cn-beijing.volces.com/api/coding . Probe + worker append /v1/messages
  // (the SDK reads ANTHROPIC_BASE_URL = this value).
  baseUrl: text('base_url').notNull(),
  authStyle: modelAuthStyleEnum('auth_style').notNull().default('bearer'),
  // NAME of the env var holding the secret (e.g. "ARK_AUTH_TOKEN"). The value is
  // never stored — resolved from process.env on the server only.
  tokenEnv: text('token_env').notNull(),
  anthropicVersion: text('anthropic_version').notNull().default('2023-06-01'),
  // Optional extra headers for gateway routing → ANTHROPIC_CUSTOM_HEADERS.
  customHeaders: jsonb('custom_headers').$type<Record<string, string> | null>(),
  // Per-connection alias/sub-agent models (gateway-only env vars). Null → fall back to
  // the connection's selected model so sub-agents/background calls stay on this account.
  aliasOpus: text('alias_opus'),
  aliasSonnet: text('alias_sonnet'),
  aliasHaiku: text('alias_haiku'),
  aliasSubagent: text('alias_subagent'),
  sort: integer('sort').default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── model_definition ─ a selectable model belonging to a connection ──────────────
export const modelDefinition = pgTable('model_definition', {
  // Global unique id sent over the wire / shown in the picker, e.g. "ark/glm-5.1".
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  connectionId: text('connection_id')
    .notNull()
    .references(() => modelConnection.id, { onDelete: 'cascade' }),
  // The model string the gateway expects, e.g. "glm-5.1".
  model: text('model').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  sort: integer('sort').default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── model_health ─ produced by the 6h backend probe; read by the board + the menu ─
export const modelHealth = pgTable('model_health', {
  modelId: text('model_id')
    .primaryKey()
    .references(() => modelDefinition.id, { onDelete: 'cascade' }),
  health: modelHealthEnum('health').notNull().default('unknown'),
  lastProbeAt: timestamptz('last_probe_at'),
  // Failure classification: network | auth | model | timeout | http_4xx | http_5xx
  probeError: text('probe_error'),
  latencyMs: integer('latency_ms'),
});

export type ModelConnection = typeof modelConnection.$inferSelect;
export type NewModelConnection = typeof modelConnection.$inferInsert;
export type ModelDefinition = typeof modelDefinition.$inferSelect;
export type NewModelDefinition = typeof modelDefinition.$inferInsert;
export type ModelHealthRow = typeof modelHealth.$inferSelect;
export type NewModelHealthRow = typeof modelHealth.$inferInsert;
