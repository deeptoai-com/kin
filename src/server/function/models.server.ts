/**
 * Multi-model server functions (PR5).
 *
 * Read-side for the composer picker. Returns ONLY non-secret, currently-selectable
 * models (enabled && healthy) + the default id. Admin CRUD lives in a separate
 * fn (PR6). Secrets never appear here — see src/server/models/registry.ts.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { auth } from '~/server/auth.server';
import { getSelectableModels, getDefaultModelId, type SelectableModel } from '~/server/models/registry';

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error('UNAUTHORIZED');
  return session.user;
};

export type ModelMenu = { models: SelectableModel[]; defaultId: string | null };

/** The composer picker's data: selectable models + the default id. */
export const getModelMenu = createServerFn({ method: 'GET' }).handler(async (): Promise<ModelMenu> => {
  await requireUser();
  const [models, defaultId] = await Promise.all([getSelectableModels(), getDefaultModelId()]);
  return { models, defaultId };
});
