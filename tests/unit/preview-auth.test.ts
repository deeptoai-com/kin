import { describe, expect, it } from 'vitest';
import { PreviewAuth } from '../../src/preview/auth.js';

describe('PreviewAuth', () => {
  it('consumes bootstrap tokens exactly once and creates a host-scoped cookie session', () => {
    const auth = new PreviewAuth({
      secret: 'test-secret',
      bootstrapTtlMs: 60_000,
      cookieTtlMs: 60_000,
      secureCookies: false,
    });

    const token = auth.issueBootstrapToken({
      previewId: 'p-test',
      sessionId: 's-test',
      userId: 'u-test',
      host: 'p-test.127-0-0-1.sslip.io',
    });

    const entry = auth.consumeBootstrapToken(token, { host: 'p-test.127-0-0-1.sslip.io' });
    expect(entry.previewId).toBe('p-test');
    expect(() => auth.consumeBootstrapToken(token, { host: 'p-test.127-0-0-1.sslip.io' })).toThrow(
      /already used|expired/,
    );

    const session = auth.createCookieSession(entry);
    expect(session.cookie).toContain('HttpOnly');
    const verified = auth.verifyCookie(session.cookie, { host: 'p-test.127-0-0-1.sslip.io' });
    expect(verified?.entry.sessionId).toBe('s-test');
    expect(auth.verifyCookie(session.cookie, { host: 'other.127-0-0-1.sslip.io' })).toBeNull();
  });
});
