/**
 * S5 load-test auth provisioner.
 *
 * Mints throwaway test users via the real Better Auth sign-up endpoint and
 * harvests their session cookies, so the load client can connect to /ws/agent
 * through the genuine auth path (ws-server validates the cookie against
 * ${APP_URL}/api/auth/get-session). No runtime auth code is touched and no
 * test-only bypass is added.
 *
 * Gated behind LOADTEST=1 to make accidental use obvious. Local dev only:
 * requires email verification to be OFF (ENABLE_EMAIL_VERIFICATION unset/false),
 * otherwise sign-up won't return an active session.
 *
 * Endpoint (Better Auth): POST {appUrl}/api/auth/sign-up/email
 *   body { email, password, name } -> Set-Cookie: <session cookie(s)>
 *
 * Note: Better Auth rate-limits (default ~300 req / 60s window), so provisioning
 * is throttled; for large N raise the limit or the spacing.
 */

/** Join all Set-Cookie pairs into a single Cookie header value. */
function setCookiesToHeader(setCookies) {
  // setCookies: array of raw "name=value; Path=/; HttpOnly; ..." strings.
  return setCookies
    .map((c) => c.split(';')[0].trim()) // keep only name=value
    .filter(Boolean)
    .join('; ');
}

/**
 * Provision N test users and return their cookies.
 * @param {object} opts
 * @param {number} opts.count       Number of users to create.
 * @param {string} opts.appUrl      Base app URL (e.g. http://localhost:3000).
 * @param {string} [opts.password]  Shared password for all test users.
 * @param {string} [opts.tag]       Unique run tag to keep emails distinct.
 * @param {number} [opts.spacingMs] Delay between sign-ups (rate-limit safety).
 * @returns {Promise<Array<{email:string, cookie:string}>>}
 */
export async function provisionUsers({
  count,
  appUrl,
  password = 'LoadTest!2026',
  tag = String(Date.now()),
  spacingMs = 150,
}) {
  if (process.env.LOADTEST !== '1') {
    throw new Error('auth-setup is gated: set LOADTEST=1 to provision test users');
  }
  const base = appUrl.replace(/\/+$/, '');
  const users = [];

  for (let i = 0; i < count; i++) {
    const email = `loadtest+${tag}-${i}@example.com`;
    let cookie = '';

    // 1) Try sign-up (fresh user -> active session in its Set-Cookie).
    let res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: `LoadTest ${i}` }),
    });

    if (res.ok) {
      cookie = setCookiesToHeader(res.headers.getSetCookie?.() ?? []);
    } else {
      // 2) User may already exist from a prior run -> sign in instead.
      res = await fetch(`${base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        cookie = setCookiesToHeader(res.headers.getSetCookie?.() ?? []);
      } else {
        const body = await res.text().catch(() => '');
        throw new Error(
          `provision user ${i} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
        );
      }
    }

    if (!cookie) {
      throw new Error(
        `provision user ${i}: no Set-Cookie returned — is email verification enabled? ` +
          `(set ENABLE_EMAIL_VERIFICATION=false for load tests)`,
      );
    }
    users.push({ email, cookie });
    if (spacingMs > 0 && i < count - 1) {
      await new Promise((r) => setTimeout(r, spacingMs));
    }
  }
  return users;
}

// Standalone: `LOADTEST=1 node scripts/loadtest/auth-setup.mjs <count> <appUrl>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const count = parseInt(process.argv[2] || '3', 10);
  const appUrl = process.argv[3] || process.env.APP_URL || 'http://localhost:3000';
  provisionUsers({ count, appUrl })
    .then((users) => {
      console.log(`Provisioned ${users.length} users against ${appUrl}:`);
      for (const u of users) console.log(`  ${u.email}  cookie_len=${u.cookie.length}`);
    })
    .catch((err) => {
      console.error('auth-setup failed:', err.message);
      process.exit(1);
    });
}
