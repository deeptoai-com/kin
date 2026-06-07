/**
 * Multi-model registry — DB-backed runtime source of truth (PR2).
 *
 * Server-only (imports the DB client). The web app + server fns use this; the
 * separate `ws-server.mjs` process does NOT import it — it fetches token-free model
 * metadata over HTTP and routes via build-worker-env.js (keeps secrets in-process).
 *
 * Seed-on-boot: OXY_MODELS_SEED (or a legacy ANTHROPIC_* fallback) is upserted with
 * onConflictDoNothing so admin edits in /admin/models are never clobbered. DB wins
 * thereafter. Secrets are never stored — only tokenEnv (the env-var NAME).
 */

import { and, eq } from 'drizzle-orm';
import { db } from '~/db/client';
import { modelConnection, modelDefinition, modelHealth } from '~/db/schema/model.schema';
import { parseModelSeed, type AuthStyle, type ModelSeedConfig } from './model-config';

/** Token-free metadata the ws-server resolve endpoint returns for routing. */
export type ModelRouteMeta = {
  id: string;
  model: string;
  connectionId: string;
  baseUrl: string;
  authStyle: AuthStyle;
  tokenEnv: string;
  anthropicVersion: string;
  customHeaders: Record<string, string> | null;
  aliasOpus: string | null;
  aliasSonnet: string | null;
  aliasHaiku: string | null;
  aliasSubagent: string | null;
  enabled: boolean;
  health: 'healthy' | 'unhealthy' | 'unknown';
};

/** A selectable model for the composer picker (never includes secrets). */
export type SelectableModel = {
  id: string;
  label: string;
  connectionId: string;
  connectionLabel: string;
  tags: string[];
};

/**
 * If OXY_MODELS_SEED is unset, synthesize a single connection+model from the legacy
 * single-value ANTHROPIC_* env so existing deployments keep working (and get a
 * one-item menu) without any new config.
 */
function legacyFallbackSeed(): ModelSeedConfig | null {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const model = process.env.ANTHROPIC_MODEL;
  if (!baseUrl || !model) return null;
  // ARK uses ANTHROPIC_AUTH_TOKEN (Bearer); native uses ANTHROPIC_API_KEY.
  const authStyle: AuthStyle = process.env.ANTHROPIC_AUTH_TOKEN ? 'bearer' : 'x-api-key';
  const tokenEnv = authStyle === 'bearer' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
  const id = `default/${model}`;
  return {
    default: id,
    connections: [
      {
        id: 'default',
        label: 'Default',
        baseUrl,
        authStyle,
        tokenEnv,
        anthropicVersion: '2023-06-01',
      },
    ],
    models: [{ id, label: model, connection: 'default', model, tags: [], enabled: true, isDefault: true }],
  };
}

/** Idempotently seed connections + models + health rows from env (boot-time). */
export async function seedModelsFromEnv(): Promise<{ connections: number; models: number } | null> {
  const seed = parseModelSeed() ?? legacyFallbackSeed();
  if (!seed) {
    console.log('[Models] No OXY_MODELS_SEED and no legacy ANTHROPIC_* — skipping seed.');
    return null;
  }

  for (const c of seed.connections) {
    await db
      .insert(modelConnection)
      .values({
        id: c.id,
        label: c.label,
        baseUrl: c.baseUrl,
        authStyle: c.authStyle,
        tokenEnv: c.tokenEnv,
        anthropicVersion: c.anthropicVersion,
        customHeaders: c.customHeaders ?? null,
        aliasOpus: c.aliasOpus ?? null,
        aliasSonnet: c.aliasSonnet ?? null,
        aliasHaiku: c.aliasHaiku ?? null,
        aliasSubagent: c.aliasSubagent ?? null,
      })
      .onConflictDoNothing();
  }

  for (const m of seed.models) {
    await db
      .insert(modelDefinition)
      .values({
        id: m.id,
        label: m.label,
        connectionId: m.connection,
        model: m.model,
        tags: m.tags,
        enabled: m.enabled,
        isDefault: m.isDefault || seed.default === m.id,
      })
      .onConflictDoNothing();
    // Seed an 'unknown' health row so the model shows as "checking…" until first probe.
    await db.insert(modelHealth).values({ modelId: m.id, health: 'unknown' }).onConflictDoNothing();
  }

  console.log(`[Models] Seed: ${seed.connections.length} connections, ${seed.models.length} models (idempotent).`);
  return { connections: seed.connections.length, models: seed.models.length };
}

/** Models the user may pick right now: enabled && healthy. No secrets. */
export async function getSelectableModels(): Promise<SelectableModel[]> {
  const rows = await db
    .select({
      id: modelDefinition.id,
      label: modelDefinition.label,
      connectionId: modelConnection.id,
      connectionLabel: modelConnection.label,
      tags: modelDefinition.tags,
      connSort: modelConnection.sort,
      defSort: modelDefinition.sort,
    })
    .from(modelDefinition)
    .innerJoin(modelConnection, eq(modelDefinition.connectionId, modelConnection.id))
    .innerJoin(modelHealth, eq(modelHealth.modelId, modelDefinition.id))
    .where(and(eq(modelDefinition.enabled, true), eq(modelHealth.health, 'healthy')));

  return rows
    .sort((a, b) => a.connSort - b.connSort || a.defSort - b.defSort)
    .map(({ connSort: _c, defSort: _d, ...m }) => m);
}

/** Token-free metadata for the ws-server resolve endpoint. Null if unknown id. */
export async function resolveModelMeta(id: string): Promise<ModelRouteMeta | null> {
  const [row] = await db
    .select({
      id: modelDefinition.id,
      model: modelDefinition.model,
      enabled: modelDefinition.enabled,
      connectionId: modelConnection.id,
      baseUrl: modelConnection.baseUrl,
      authStyle: modelConnection.authStyle,
      tokenEnv: modelConnection.tokenEnv,
      anthropicVersion: modelConnection.anthropicVersion,
      customHeaders: modelConnection.customHeaders,
      aliasOpus: modelConnection.aliasOpus,
      aliasSonnet: modelConnection.aliasSonnet,
      aliasHaiku: modelConnection.aliasHaiku,
      aliasSubagent: modelConnection.aliasSubagent,
      health: modelHealth.health,
    })
    .from(modelDefinition)
    .innerJoin(modelConnection, eq(modelDefinition.connectionId, modelConnection.id))
    .leftJoin(modelHealth, eq(modelHealth.modelId, modelDefinition.id))
    .where(eq(modelDefinition.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, health: row.health ?? 'unknown' };
}

/** Default model id: the isDefault one if healthy, else the first selectable. */
export async function getDefaultModelId(): Promise<string | null> {
  const selectable = await getSelectableModels();
  if (selectable.length === 0) return null;
  const [def] = await db
    .select({ id: modelDefinition.id })
    .from(modelDefinition)
    .innerJoin(modelHealth, eq(modelHealth.modelId, modelDefinition.id))
    .where(and(eq(modelDefinition.isDefault, true), eq(modelHealth.health, 'healthy')))
    .limit(1);
  return def?.id ?? selectable[0].id;
}

// ── Admin board (PR6) ─────────────────────────────────────────────────────────

/** A model row for the admin board: full state incl. disabled/unhealthy. No token. */
export type AdminModelRow = {
  id: string;
  label: string;
  model: string;
  tags: string[];
  enabled: boolean;
  isDefault: boolean;
  connectionId: string;
  connectionLabel: string;
  baseUrl: string;
  authStyle: AuthStyle;
  tokenEnv: string;
  tokenResolved: boolean; // whether process.env[tokenEnv] is set (server-side; value never shown)
  health: 'healthy' | 'unhealthy' | 'unknown';
  lastProbeAt: Date | null;
  probeError: string | null;
  latencyMs: number | null;
};

/** All models (incl. disabled/unhealthy) for the admin board. Token-free. */
export async function listModelsAdmin(): Promise<AdminModelRow[]> {
  const rows = await db
    .select({
      id: modelDefinition.id,
      label: modelDefinition.label,
      model: modelDefinition.model,
      tags: modelDefinition.tags,
      enabled: modelDefinition.enabled,
      isDefault: modelDefinition.isDefault,
      defSort: modelDefinition.sort,
      connectionId: modelConnection.id,
      connectionLabel: modelConnection.label,
      connSort: modelConnection.sort,
      baseUrl: modelConnection.baseUrl,
      authStyle: modelConnection.authStyle,
      tokenEnv: modelConnection.tokenEnv,
      health: modelHealth.health,
      lastProbeAt: modelHealth.lastProbeAt,
      probeError: modelHealth.probeError,
      latencyMs: modelHealth.latencyMs,
    })
    .from(modelDefinition)
    .innerJoin(modelConnection, eq(modelDefinition.connectionId, modelConnection.id))
    .leftJoin(modelHealth, eq(modelHealth.modelId, modelDefinition.id));

  return rows
    .sort((a, b) => a.connSort - b.connSort || a.defSort - b.defSort)
    .map(({ connSort: _c, defSort: _d, ...r }) => ({
      ...r,
      tokenResolved: !!process.env[r.tokenEnv],
      health: r.health ?? 'unknown',
    }));
}

/** Toggle a model's enabled flag. */
export async function setModelEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(modelDefinition).set({ enabled }).where(eq(modelDefinition.id, id));
}

/** Make `id` the single default model (clears the previous default). */
export async function setDefaultModelById(id: string): Promise<void> {
  await db.update(modelDefinition).set({ isDefault: false }).where(eq(modelDefinition.isDefault, true));
  await db.update(modelDefinition).set({ isDefault: true }).where(eq(modelDefinition.id, id));
}

// ── Admin CRUD (PR6b) ─────────────────────────────────────────────────────────
// Definitions live in the DB; secrets stay in env (tokenEnv NAME only). Adding a
// connection here records its tokenEnv; the value must exist in the server env.

export type ConnectionInput = {
  id: string;
  label: string;
  baseUrl: string;
  authStyle: AuthStyle;
  tokenEnv: string;
  anthropicVersion?: string;
  aliasOpus?: string | null;
  aliasSonnet?: string | null;
  aliasHaiku?: string | null;
  aliasSubagent?: string | null;
};

export type ModelInput = {
  id: string;
  label: string;
  connectionId: string;
  model: string;
  tags?: string[];
  enabled?: boolean;
};

/** Create or update a connection (upsert by id). */
export async function upsertConnection(c: ConnectionInput): Promise<void> {
  const values = {
    id: c.id,
    label: c.label,
    baseUrl: c.baseUrl,
    authStyle: c.authStyle,
    tokenEnv: c.tokenEnv,
    anthropicVersion: c.anthropicVersion || '2023-06-01',
    aliasOpus: c.aliasOpus ?? null,
    aliasSonnet: c.aliasSonnet ?? null,
    aliasHaiku: c.aliasHaiku ?? null,
    aliasSubagent: c.aliasSubagent ?? null,
  };
  await db
    .insert(modelConnection)
    .values(values)
    .onConflictDoUpdate({ target: modelConnection.id, set: { ...values, updatedAt: new Date() } });
}

/** Delete a connection (cascades to its models + health rows). */
export async function deleteConnection(id: string): Promise<void> {
  await db.delete(modelConnection).where(eq(modelConnection.id, id));
}

/** Create or update a model (upsert by id). Verifies the connection exists. */
export async function upsertModel(m: ModelInput): Promise<void> {
  const [conn] = await db
    .select({ id: modelConnection.id })
    .from(modelConnection)
    .where(eq(modelConnection.id, m.connectionId))
    .limit(1);
  if (!conn) throw new Error(`Unknown connection "${m.connectionId}"`);
  const values = {
    id: m.id,
    label: m.label,
    connectionId: m.connectionId,
    model: m.model,
    tags: m.tags ?? [],
    enabled: m.enabled ?? true,
  };
  await db
    .insert(modelDefinition)
    .values(values)
    .onConflictDoUpdate({ target: modelDefinition.id, set: { ...values, updatedAt: new Date() } });
  await db.insert(modelHealth).values({ modelId: m.id, health: 'unknown' }).onConflictDoNothing();
}

/** Delete a model (cascades to its health row). */
export async function deleteModel(id: string): Promise<void> {
  await db.delete(modelDefinition).where(eq(modelDefinition.id, id));
}
