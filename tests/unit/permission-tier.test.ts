// @vitest-environment node
/**
 * Unit tests for the 2-mode interaction model (Ask/Act, pure, dep-free).
 * Security note: modes are an interruption preference only — the sandbox is the
 * hard boundary. Design ref: docs/project/research/2026-06-ask-act-hitl-design.md
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODE,
  INTERACTION_MODES,
  isInteractionMode,
  modeToSdkPermissionMode,
  resolveEffectivePermission,
} from '~/lib/permission-tier.js';

describe('constants', () => {
  it('DEFAULT_MODE is act', () => {
    expect(DEFAULT_MODE).toBe('act');
  });
  it('INTERACTION_MODES is [ask, act]', () => {
    expect(INTERACTION_MODES).toEqual(['ask', 'act']);
  });
});

describe('isInteractionMode', () => {
  it('accepts the two modes', () => {
    for (const m of INTERACTION_MODES) expect(isInteractionMode(m)).toBe(true);
  });
  it('rejects anything else (incl. dropped tiers)', () => {
    for (const bad of ['', 'explore', 'auto', 'plan', 'bypassPermissions', null, undefined, 1, 'ASK']) {
      expect(isInteractionMode(bad)).toBe(false);
    }
  });
});

describe('modeToSdkPermissionMode', () => {
  it('ask → default (canUseTool consulted → HITL)', () => expect(modeToSdkPermissionMode('ask')).toBe('default'));
  it('act → acceptEdits (autonomous)', () => expect(modeToSdkPermissionMode('act')).toBe('acceptEdits'));
});

describe('resolveEffectivePermission', () => {
  it('act → acceptEdits', () => {
    expect(resolveEffectivePermission({ requestedMode: 'act' })).toEqual({
      mode: 'act',
      permissionMode: 'acceptEdits',
    });
  });
  it('ask → default', () => {
    expect(resolveEffectivePermission({ requestedMode: 'ask' })).toEqual({
      mode: 'ask',
      permissionMode: 'default',
    });
  });
  it('absent mode falls back to DEFAULT_MODE (act)', () => {
    expect(resolveEffectivePermission()).toMatchObject({ mode: 'act', permissionMode: 'acceptEdits' });
    expect(resolveEffectivePermission({ requestedMode: null })).toMatchObject({ mode: 'act' });
    expect(resolveEffectivePermission({ requestedMode: undefined })).toMatchObject({ mode: 'act' });
  });
  it('unrecognised mode falls back to act (incl. dropped tiers)', () => {
    expect(resolveEffectivePermission({ requestedMode: 'garbage' })).toMatchObject({ mode: 'act' });
    expect(resolveEffectivePermission({ requestedMode: 'explore' })).toMatchObject({ mode: 'act' });
  });
});
