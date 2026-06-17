/**
 * Capability/permission posture — typed accessor over the `system_setting` KV table.
 *
 * This is the single source of truth for Kin's runtime permission posture. Both the
 * permission server fn and the `/api/auth/permission-info` endpoint resolve through
 * `resolveCapabilityConfig()`, and ws-server materializes the result into each worker's
 * env. The admin UI (`/admin/permissions`) writes via `setCapabilitySetting()`.
 *
 * Resolution precedence per key: **DB row → legacy env var → built-in default**.
 *  - DB row: an admin changed it in the UI; wins.
 *  - env: a legacy deployment set CLAUDE_ALLOW_BASH / CLAUDE_PERMISSION_MODE /
 *    EXEC_SANDBOX_ALLOWED_DOMAINS; respected until an admin overrides in the UI.
 *  - default: a fresh local install with neither → the "开放·留网闸" posture
 *    (everyone gets sandboxed shell, Act, curated egress allowlist).
 *
 * Values here are NEVER secrets.
 */

import { db } from '~/db/db-config';
import { systemSetting } from '~/db/schema';
import { recordAudit } from '~/server/audit';

export type ShellAudience = 'everyone' | 'admins' | 'off';
export type InteractionDefault = 'ask' | 'act';
export type PermissionModeValue =
  | 'default'
  | 'plan'
  | 'dontAsk'
  | 'acceptEdits'
  | 'bypassPermissions';
export type EgressScope = 'curated' | 'open' | 'custom' | 'off';

export type CapabilityConfig = {
  shellAudience: ShellAudience;
  interactionDefault: InteractionDefault;
  permissionMode: PermissionModeValue;
  egressScope: EgressScope;
  egressCustomDomains: string[];
};

export const SHELL_AUDIENCES: ShellAudience[] = ['everyone', 'admins', 'off'];
export const INTERACTION_DEFAULTS: InteractionDefault[] = ['ask', 'act'];
export const PERMISSION_MODES: PermissionModeValue[] = [
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'bypassPermissions',
];
export const EGRESS_SCOPES: EgressScope[] = ['curated', 'open', 'custom', 'off'];

/**
 * Built-in defaults = the "开放·留网闸" posture (Owner-chosen 2026-06-17 for a
 * local-deployed, single-org trusted product). Everyone gets the sandboxed shell,
 * the agent acts without asking, and egress is the curated allowlist (git/npm/pip
 * work; internal services + cloud metadata are off-list = blocked for free).
 */
export const DEFAULT_CAPABILITY_CONFIG: CapabilityConfig = {
  shellAudience: 'everyone',
  interactionDefault: 'act',
  permissionMode: 'default',
  egressScope: 'curated',
  egressCustomDomains: [],
};

// Dotted KV keys (one row per setting).
export const SETTING_KEYS = {
  shellAudience: 'shell.audience',
  interactionDefault: 'interaction.default',
  permissionMode: 'permission.mode',
  egressScope: 'egress.scope',
  egressCustomDomains: 'egress.customDomains',
} as const;

export type CapabilitySettingKey = keyof typeof SETTING_KEYS;

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

/**
 * Legacy env → config mapping (used only when a DB row is absent). Lets existing
 * deployments keep their env-configured behaviour until an admin opts into the UI.
 */
function envFallbackConfig(): CapabilityConfig {
  const cfg: CapabilityConfig = { ...DEFAULT_CAPABILITY_CONFIG };

  // Legacy CLAUDE_ALLOW_BASH governed admin/whitelist-only bash. Map true→admins,
  // false→off; if unset, keep the built-in default (everyone).
  const allowBashEnv = process.env.CLAUDE_ALLOW_BASH;
  if (allowBashEnv === 'false') cfg.shellAudience = 'off';
  else if (allowBashEnv === 'true') cfg.shellAudience = 'admins';

  const modeEnv = process.env.CLAUDE_PERMISSION_MODE;
  if (modeEnv && (PERMISSION_MODES as string[]).includes(modeEnv)) {
    cfg.permissionMode = modeEnv as PermissionModeValue;
  }

  // EXEC_SANDBOX_ALLOWED_DOMAINS: unset/'' → curated; off/none → off;
  // all/open/* → open (no egress filter); comma-list → custom.
  const egressEnv = process.env.EXEC_SANDBOX_ALLOWED_DOMAINS;
  if (egressEnv != null) {
    const t = egressEnv.trim().toLowerCase();
    if (t === '') {
      cfg.egressScope = 'curated';
    } else if (t === 'off' || t === 'none') {
      cfg.egressScope = 'off';
    } else if (t === 'all' || t === 'open' || t === '*') {
      cfg.egressScope = 'open';
    } else {
      cfg.egressScope = 'custom';
      cfg.egressCustomDomains = pickStringArray(egressEnv.split(','), []);
    }
  }

  return cfg;
}

/**
 * Resolve the effective org-wide capability config. DB rows override env/default
 * per-key. Cheap (one indexed table scan of ~5 rows); callers may call per request.
 */
export async function resolveCapabilityConfig(): Promise<CapabilityConfig> {
  const base = envFallbackConfig();
  let map = new Map<string, unknown>();
  try {
    const rows = await db.select().from(systemSetting);
    map = new Map(rows.map((r) => [r.key, r.value]));
  } catch (error) {
    // Table missing (pre-migration) or DB hiccup → fall back to env/default.
    console.error('[system-settings] read failed, using env/default', error);
    return base;
  }

  return {
    shellAudience: pickEnum(
      map.get(SETTING_KEYS.shellAudience),
      SHELL_AUDIENCES,
      base.shellAudience,
    ),
    interactionDefault: pickEnum(
      map.get(SETTING_KEYS.interactionDefault),
      INTERACTION_DEFAULTS,
      base.interactionDefault,
    ),
    permissionMode: pickEnum(
      map.get(SETTING_KEYS.permissionMode),
      PERMISSION_MODES,
      base.permissionMode,
    ),
    egressScope: pickEnum(map.get(SETTING_KEYS.egressScope), EGRESS_SCOPES, base.egressScope),
    egressCustomDomains: pickStringArray(
      map.get(SETTING_KEYS.egressCustomDomains),
      base.egressCustomDomains,
    ),
  };
}

/** Does THIS user get the sandboxed shell, given the audience setting + privilege? */
export function resolveBashEnabled(cfg: CapabilityConfig, isWhitelisted: boolean): boolean {
  if (cfg.shellAudience === 'off') return false;
  if (cfg.shellAudience === 'everyone') return true;
  return isWhitelisted; // 'admins'
}

/**
 * The EXEC_SANDBOX_ALLOWED_DOMAINS value ws-server injects into the worker env.
 * sandbox.js reads it: '' → curated default · 'off' → deny-all · 'all' → no egress
 * filter (full reach) · comma-list → exactly those domains.
 */
export function egressEnvValue(cfg: CapabilityConfig): string {
  switch (cfg.egressScope) {
    case 'open':
      return 'all';
    case 'off':
      return 'off';
    case 'custom':
      return cfg.egressCustomDomains.join(',');
    case 'curated':
    default:
      return '';
  }
}

/** Validate + coerce a raw value for a setting key, or throw. */
function validateSetting(key: CapabilitySettingKey, raw: unknown): unknown {
  switch (key) {
    case 'shellAudience':
      return pickEnumOrThrow(raw, SHELL_AUDIENCES, key);
    case 'interactionDefault':
      return pickEnumOrThrow(raw, INTERACTION_DEFAULTS, key);
    case 'permissionMode':
      return pickEnumOrThrow(raw, PERMISSION_MODES, key);
    case 'egressScope':
      return pickEnumOrThrow(raw, EGRESS_SCOPES, key);
    case 'egressCustomDomains':
      if (!Array.isArray(raw)) throw new Error(`${key} must be an array of domains`);
      return pickStringArray(raw, []);
    default:
      throw new Error(`Unknown setting key: ${key}`);
  }
}

function pickEnumOrThrow<T extends string>(value: unknown, allowed: T[], key: string): T {
  if (typeof value === 'string' && (allowed as string[]).includes(value)) return value as T;
  throw new Error(`${key} must be one of: ${allowed.join(', ')}`);
}

/**
 * Upsert one capability setting (admin-only callers must gate before calling this).
 * Records an audit row. `userId` is the acting admin.
 */
export async function setCapabilitySetting(
  key: CapabilitySettingKey,
  rawValue: unknown,
  userId: string | null,
): Promise<void> {
  const value = validateSetting(key, rawValue);
  const dbKey = SETTING_KEYS[key];
  await db
    .insert(systemSetting)
    .values({ key: dbKey, value, updatedBy: userId })
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: { value, updatedBy: userId, updatedAt: new Date() },
    });
  await recordAudit({
    userId,
    action: 'admin.capability.update',
    target: dbKey,
    meta: { value },
  });
}

/** Apply a posture preset in one shot (everyone/admins + egress scope + mode). */
export async function applyCapabilityConfig(
  partial: Partial<CapabilityConfig>,
  userId: string | null,
): Promise<void> {
  const entries = Object.entries(partial) as [CapabilitySettingKey, unknown][];
  for (const [key, value] of entries) {
    await setCapabilitySetting(key, value, userId);
  }
}
