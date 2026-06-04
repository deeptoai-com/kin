/**
 * Interaction mode — single source of truth for the 2-mode model (Cowork-aligned).
 *
 * Shared, dependency-free ESM so BOTH the Node WS server (ws-server.mjs) and the
 * Vite/TS frontend import the exact same mode → SDK-mode mapping.
 *
 * Design rationale: security comes from the SANDBOX (srt / container), NOT from the
 * mode. Modes are an INTERRUPTION preference (how much the agent pauses), not a
 * capability gate. (We dropped the old read-only "explore/Plan" tier: OxyGenie is a
 * web, fully-sandboxed product — read-only planning has no use; see
 * docs/project/research/2026-06-ask-act-hitl-design.md.)
 *
 * Modes (Cowork: Ask before acting / Act without asking):
 *   - 'ask' (🖐) → SDK `default`     : SDK consults canUseTool per tool → HITL approval
 *   - 'act' (⏩) → SDK `acceptEdits` : autonomous, sandbox-bounded (default)
 *
 * Spike-verified (2026-06-04): in `default` mode the SDK calls canUseTool per tool
 * and awaits a long async return; `acceptEdits` skips canUseTool entirely. So Ask
 * must use `default`, Act uses `acceptEdits`.
 *
 * @typedef {'ask' | 'act'} InteractionMode
 * @typedef {'default' | 'plan' | 'dontAsk' | 'acceptEdits' | 'delegate' | 'bypassPermissions'} SdkPermissionMode
 */

/** @type {readonly ['ask', 'act']} */
export const INTERACTION_MODES = ['ask', 'act'];

/** @type {InteractionMode} */
export const DEFAULT_MODE = 'act';

/**
 * Is `value` one of the two interaction modes?
 * @param {unknown} value
 * @returns {value is InteractionMode}
 */
export function isInteractionMode(value) {
  return value === 'ask' || value === 'act';
}

/**
 * Map an interaction mode to the SDK permissionMode string.
 * Ask → 'default' (canUseTool consulted → HITL); Act → 'acceptEdits' (autonomous).
 * @param {InteractionMode} mode
 * @returns {SdkPermissionMode}
 */
export function modeToSdkPermissionMode(mode) {
  return mode === 'ask' ? 'default' : 'acceptEdits';
}

/**
 * Resolve the effective permission for a run, given the client's requested mode.
 * Falls back to DEFAULT_MODE ('act') when absent/unrecognised.
 *
 * @param {{ requestedMode?: InteractionMode | string | null }} params
 * @returns {{ mode: InteractionMode, permissionMode: SdkPermissionMode }}
 */
export function resolveEffectivePermission({ requestedMode = null } = {}) {
  const mode = isInteractionMode(requestedMode) ? requestedMode : DEFAULT_MODE;
  return {
    mode,
    permissionMode: modeToSdkPermissionMode(mode),
  };
}
