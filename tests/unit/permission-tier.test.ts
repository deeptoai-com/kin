/**
 * Unit tests for the 3-tier permission model (pure, dep-free).
 * Security note: tiers are a UX preference only — the sandbox is the hard boundary.
 * Design ref: docs/project/research/2026-05-permission-bash-sandbox-design.md
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIER,
  PERMISSION_TIERS,
  isPermissionTier,
  resolveEffectivePermission,
  tierToSdkMode,
  tierWantsBash,
} from '~/lib/permission-tier.js';

describe('constants', () => {
  it('DEFAULT_TIER is act', () => {
    expect(DEFAULT_TIER).toBe('act');
  });
  it('PERMISSION_TIERS contains all three', () => {
    expect(PERMISSION_TIERS).toEqual(['explore', 'auto', 'act']);
  });
});

describe('isPermissionTier', () => {
  it('accepts the three tiers', () => {
    for (const t of PERMISSION_TIERS) expect(isPermissionTier(t)).toBe(true);
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'plan', 'bypassPermissions', null, undefined, 1, 'ACT']) {
      expect(isPermissionTier(bad)).toBe(false);
    }
  });
});

describe('tierToSdkMode', () => {
  it('explore → plan', () => expect(tierToSdkMode('explore')).toBe('plan'));
  it('auto → acceptEdits', () => expect(tierToSdkMode('auto')).toBe('acceptEdits'));
  it('act → acceptEdits', () => expect(tierToSdkMode('act')).toBe('acceptEdits'));
});

describe('tierWantsBash', () => {
  it('explore does NOT want bash (read-only)', () => expect(tierWantsBash('explore')).toBe(false));
  it('auto wants bash', () => expect(tierWantsBash('auto')).toBe(true));
  it('act wants bash', () => expect(tierWantsBash('act')).toBe(true));
});

describe('resolveEffectivePermission', () => {
  it('act → acceptEdits, wantsBash=true', () => {
    expect(resolveEffectivePermission({ requestedTier: 'act' })).toEqual({
      tier: 'act',
      permissionMode: 'acceptEdits',
      wantsBash: true,
    });
  });
  it('auto → acceptEdits, wantsBash=true', () => {
    expect(resolveEffectivePermission({ requestedTier: 'auto' })).toEqual({
      tier: 'auto',
      permissionMode: 'acceptEdits',
      wantsBash: true,
    });
  });
  it('explore → plan, wantsBash=false', () => {
    expect(resolveEffectivePermission({ requestedTier: 'explore' })).toEqual({
      tier: 'explore',
      permissionMode: 'plan',
      wantsBash: false,
    });
  });
  it('absent tier falls back to DEFAULT_TIER (act)', () => {
    expect(resolveEffectivePermission()).toMatchObject({ tier: 'act', permissionMode: 'acceptEdits' });
    expect(resolveEffectivePermission({ requestedTier: null })).toMatchObject({ tier: 'act' });
    expect(resolveEffectivePermission({ requestedTier: undefined })).toMatchObject({ tier: 'act' });
  });
  it('unrecognised tier falls back to act', () => {
    expect(resolveEffectivePermission({ requestedTier: 'garbage' })).toMatchObject({ tier: 'act' });
    expect(resolveEffectivePermission({ requestedTier: 'bypassPermissions' })).toMatchObject({ tier: 'act' });
  });
});
