/**
 * Admin · capability/permission posture server fns.
 *
 * Reads/writes the runtime capability config (system_setting KV) for the
 * `/admin/permissions` page. All fns require system admin. Writes go through
 * `setCapabilitySetting` (validates + audits). The "foundation" block is read-only
 * deploy-time status (sandbox on/off, exec runtime, native-Bash policy) — shown so
 * admins see the security floor without being able to disable it from the UI.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { auth } from '~/server/auth.server';
import {
  resolveCapabilityConfig,
  setCapabilitySetting,
  applyCapabilityConfig,
  type CapabilityConfig,
  type CapabilitySettingKey,
} from '~/server/config/system-settings.server';

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

export type CapabilityPreset = 'open' | 'guarded' | 'adminOnly' | 'custom';

export type FoundationStatus = {
  sandboxEnabled: boolean;
  runtime: string;
  nativeBashDisallowed: true;
};

export type CapabilityAdminView = {
  config: CapabilityConfig;
  foundation: FoundationStatus;
  activePreset: CapabilityPreset;
};

/** Mirror sandbox.js isEnabled(): explicit ENABLE_EXEC_SANDBOX wins, else linux-on. */
function sandboxEnabled(): boolean {
  if (process.env.ENABLE_EXEC_SANDBOX === '0') return false;
  if (process.env.ENABLE_EXEC_SANDBOX === '1') return true;
  return process.platform === 'linux';
}

function matchPreset(cfg: CapabilityConfig): CapabilityPreset {
  if (cfg.shellAudience === 'everyone' && cfg.egressScope === 'open') return 'open';
  if (cfg.shellAudience === 'everyone' && cfg.egressScope === 'curated') return 'guarded';
  if (cfg.shellAudience === 'admins' && cfg.egressScope === 'curated') return 'adminOnly';
  return 'custom';
}

export const getCapabilityAdminFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CapabilityAdminView> => {
    await requireAdmin();
    const config = await resolveCapabilityConfig();
    return {
      config,
      foundation: {
        sandboxEnabled: sandboxEnabled(),
        runtime: process.env.EXEC_RUNTIME || 'srt',
        nativeBashDisallowed: true,
      },
      activePreset: matchPreset(config),
    };
  },
);

export const setCapabilitySettingFn = createServerFn({ method: 'POST' })
  .inputValidator((val: { key: CapabilitySettingKey; value: unknown }) => val)
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    await setCapabilitySetting(data.key, data.value, admin.id);
    return { ok: true as const };
  });

const PRESETS: Record<Exclude<CapabilityPreset, 'custom'>, Partial<CapabilityConfig>> = {
  open: { shellAudience: 'everyone', egressScope: 'open' },
  guarded: { shellAudience: 'everyone', egressScope: 'curated' },
  adminOnly: { shellAudience: 'admins', egressScope: 'curated' },
};

export const applyPresetFn = createServerFn({ method: 'POST' })
  .inputValidator((val: { preset: Exclude<CapabilityPreset, 'custom'> }) => val)
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const patch = PRESETS[data.preset];
    if (!patch) throw new Error(`Unknown preset: ${data.preset}`);
    await applyCapabilityConfig(patch, admin.id);
    return { ok: true as const };
  });
