/**
 * Unit tests for the P2-2 audit row builders (pure, DB-free).
 */
import { describe, it, expect } from 'vitest';
import { buildAuditRow, clientIpFromForwardedFor } from '~/server/audit/build-audit-row';

describe('buildAuditRow', () => {
  it('passes through a full entry', () => {
    expect(
      buildAuditRow({
        userId: 'u1',
        action: 'run.bypass_mode',
        target: 'sess_1',
        meta: { allowBash: true },
        ip: '203.0.113.9',
      }),
    ).toEqual({
      userId: 'u1',
      action: 'run.bypass_mode',
      target: 'sess_1',
      meta: { allowBash: true },
      ip: '203.0.113.9',
    });
  });

  it('defaults missing optional fields (null userId/target/ip, empty meta)', () => {
    expect(buildAuditRow({ action: 'auth.login' })).toEqual({
      userId: null,
      action: 'auth.login',
      target: null,
      meta: {},
      ip: null,
    });
  });
});

describe('clientIpFromForwardedFor', () => {
  it('takes the first hop and trims it', () => {
    expect(clientIpFromForwardedFor('203.0.113.9, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.9');
  });
  it('returns null for absent/blank values', () => {
    expect(clientIpFromForwardedFor(null)).toBeNull();
    expect(clientIpFromForwardedFor(undefined)).toBeNull();
    expect(clientIpFromForwardedFor('   ')).toBeNull();
  });
});
