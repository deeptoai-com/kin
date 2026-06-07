/**
 * Multi-model admin server functions (PR6).
 *
 * Admin-only board controls: list all models (incl. disabled/unhealthy) with health,
 * toggle enabled, set the default, and enqueue a re-probe. Connection/model CRUD
 * forms are a fast-follow (PR6b); definitions bootstrap from OXY_MODELS_SEED. All
 * fns require system admin; none return a token value.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { auth } from '~/server/auth.server';
import {
  listModelsAdmin,
  setModelEnabled,
  setDefaultModelById,
  upsertConnection,
  deleteConnection,
  upsertModel,
  deleteModel,
  type AdminModelRow,
} from '~/server/models/registry';
import { AUTH_STYLES } from '~/server/models/model-config';
import { systemQueue } from '~/jobs/queues';

const requireAdmin = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error('UNAUTHORIZED');
  const { db } = await import('~/db/db-config');
  const { user: userTable } = await import('~/db/schema');
  const { eq } = await import('drizzle-orm');
  const userData = await db.query.user.findFirst({
    where: eq(userTable.id, session.user.id),
    columns: { systemRole: true },
  });
  if (userData?.systemRole !== 'admin') throw new Error('FORBIDDEN: Admin access required');
  return session.user;
};

export const listModelsAdminFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminModelRow[]> => {
    await requireAdmin();
    return listModelsAdmin();
  },
);

export const setModelEnabledFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().min(1), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await setModelEnabled(data.id, data.enabled);
    return { ok: true };
  });

export const setDefaultModelFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await setDefaultModelById(data.id);
    return { ok: true };
  });

/** Enqueue a health re-probe (one model when modelId given, else the full sweep). */
export const reprobeModelsFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ modelId: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await systemQueue.add('probe-models', data.modelId ? { modelId: data.modelId } : {});
    return { ok: true };
  });

// ── CRUD (PR6b) ───────────────────────────────────────────────────────────────

const idRe = /^[a-zA-Z0-9._/-]+$/;

const connectionInputSchema = z.object({
  id: z.string().min(1).regex(idRe),
  label: z.string().min(1),
  baseUrl: z.string().url(),
  authStyle: z.enum(AUTH_STYLES),
  tokenEnv: z.string().min(1),
  anthropicVersion: z.string().optional(),
  aliasOpus: z.string().nullish(),
  aliasSonnet: z.string().nullish(),
  aliasHaiku: z.string().nullish(),
  aliasSubagent: z.string().nullish(),
});

const modelInputSchema = z.object({
  id: z.string().min(1).regex(idRe),
  label: z.string().min(1),
  connectionId: z.string().min(1),
  model: z.string().min(1),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const upsertConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator(connectionInputSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    await upsertConnection({ ...data, aliasOpus: data.aliasOpus ?? null, aliasSonnet: data.aliasSonnet ?? null, aliasHaiku: data.aliasHaiku ?? null, aliasSubagent: data.aliasSubagent ?? null });
    return { ok: true };
  });

export const deleteConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await deleteConnection(data.id);
    return { ok: true };
  });

export const upsertModelFn = createServerFn({ method: 'POST' })
  .inputValidator(modelInputSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    await upsertModel(data);
    return { ok: true };
  });

export const deleteModelFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await deleteModel(data.id);
    return { ok: true };
  });
