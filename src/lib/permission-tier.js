/**
 * Permission Tier — single source of truth for the 3-tier product permission model.
 *
 * Shared, dependency-free ESM so BOTH the Node WS server (ws-server.mjs) and the
 * Vite/TS frontend import the exact same tier→SDK-mode mapping.
 *
 * Design rationale: security comes from the SANDBOX (srt / container), NOT from
 * restricting which tier a user can pick. All users can reach any tier; the sandbox
 * is the hard boundary. Tiers are a UX preference: how much the agent interrupts.
 *
 * Tiers (ascending "interruption level" ↓ / "autonomy" ↑):
 *   - 'explore' (🔍)  → SDK `plan`        : read-only, no edits, no scripts
 *   - 'auto'    (⚡)  → SDK `acceptEdits` : edits auto, sandbox scripts ok, HITL for danger (Wave 2)
 *   - 'act'     (🚀)  → SDK `acceptEdits` : same as auto, minimal interruptions (default)
 *
 * Design ref: docs/project/research/2026-05-permission-bash-sandbox-design.md
 *
 * @typedef {'explore' | 'auto' | 'act'} PermissionTier
 * @typedef {'default' | 'plan' | 'dontAsk' | 'acceptEdits' | 'delegate' | 'bypassPermissions'} SdkPermissionMode
 */

/** @type {readonly ['explore', 'auto', 'act']} */
export const PERMISSION_TIERS = ['explore', 'auto', 'act'];

/** @type {PermissionTier} */
export const DEFAULT_TIER = 'act';

/**
 * Is `value` one of the three product tiers?
 * @param {unknown} value
 * @returns {value is PermissionTier}
 */
export function isPermissionTier(value) {
  return value === 'explore' || value === 'auto' || value === 'act';
}

/**
 * Map a product tier to the SDK permissionMode string.
 * @param {PermissionTier} tier
 * @returns {SdkPermissionMode}
 */
export function tierToSdkMode(tier) {
  return tier === 'explore' ? 'plan' : 'acceptEdits';
}

/**
 * Does this tier want bash / scripting to be available?
 * Actual availability also requires the sandbox to be confirmed active (PR-C).
 * @param {PermissionTier} tier
 * @returns {boolean}
 */
export function tierWantsBash(tier) {
  return tier === 'auto' || tier === 'act';
}

/**
 * Resolve the effective SDK permission for a run, given the client's requested tier.
 *
 * No org ceiling — security is the sandbox's job. Falls back to DEFAULT_TIER ('act')
 * when the requested tier is absent or unrecognised, so legacy clients that send no
 * tier get the same behaviour as today.
 *
 * @param {{ requestedTier?: PermissionTier | string | null }} params
 * @returns {{ tier: PermissionTier, permissionMode: SdkPermissionMode, wantsBash: boolean }}
 */
export function resolveEffectivePermission({ requestedTier = null } = {}) {
  const tier = isPermissionTier(requestedTier) ? requestedTier : DEFAULT_TIER;
  return {
    tier,
    permissionMode: tierToSdkMode(tier),
    wantsBash: tierWantsBash(tier),
  };
}
