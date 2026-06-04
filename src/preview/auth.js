import crypto from 'node:crypto';

const DEFAULT_BOOTSTRAP_TTL_MS = 90 * 1000;
const DEFAULT_COOKIE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_COOKIE_NAME = 'oxy_preview';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header = '') {
  const out = new Map();
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out.set(key, decodeURIComponent(value));
  }
  return out;
}

function trimExpired(map, now = Date.now()) {
  for (const [key, value] of map.entries()) {
    if (value.expiresAt <= now) map.delete(key);
  }
}

export class PreviewAuth {
  constructor(options = {}) {
    this.secret = options.secret || crypto.randomBytes(32).toString('hex');
    this.bootstrapTtlMs = Number(options.bootstrapTtlMs) || DEFAULT_BOOTSTRAP_TTL_MS;
    this.cookieTtlMs = Number(options.cookieTtlMs) || DEFAULT_COOKIE_TTL_MS;
    this.cookieName = options.cookieName || DEFAULT_COOKIE_NAME;
    this.secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
    this.bootstrap = new Map();
    this.cookies = new Map();
  }

  issueBootstrapToken({ previewId, sessionId, userId, host }) {
    trimExpired(this.bootstrap);
    const now = Date.now();
    const jti = crypto.randomBytes(16).toString('hex');
    const payload = {
      jti,
      previewId,
      sessionId,
      userId,
      host,
      exp: Math.floor((now + this.bootstrapTtlMs) / 1000),
    };
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signature = sign(`${encodedHeader}.${encodedPayload}`, this.secret);
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;
    this.bootstrap.set(jti, {
      previewId,
      sessionId,
      userId,
      host,
      expiresAt: now + this.bootstrapTtlMs,
    });
    return token;
  }

  consumeBootstrapToken(token, { host } = {}) {
    trimExpired(this.bootstrap);
    const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
    if (!encodedHeader || !encodedPayload || !signature) {
      throw new Error('Invalid preview token');
    }
    const expected = sign(`${encodedHeader}.${encodedPayload}`, this.secret);
    if (!safeEqual(signature, expected)) {
      throw new Error('Invalid preview token signature');
    }
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload?.jti || !payload?.previewId || !payload?.sessionId || !payload?.userId) {
      throw new Error('Invalid preview token payload');
    }
    if (Number(payload.exp) * 1000 <= Date.now()) {
      this.bootstrap.delete(payload.jti);
      throw new Error('Preview token expired');
    }
    const entry = this.bootstrap.get(payload.jti);
    if (!entry) {
      throw new Error('Preview token already used or expired');
    }
    this.bootstrap.delete(payload.jti);
    if (entry.previewId !== payload.previewId || entry.sessionId !== payload.sessionId || entry.userId !== payload.userId) {
      throw new Error('Preview token mismatch');
    }
    if (host && entry.host && host !== entry.host) {
      throw new Error('Preview token host mismatch');
    }
    return entry;
  }

  createCookieSession(entry) {
    trimExpired(this.cookies);
    const sid = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + this.cookieTtlMs;
    this.cookies.set(sid, { ...entry, expiresAt });
    return {
      sid,
      cookie: this.serializeCookie(sid, expiresAt),
      entry: this.cookies.get(sid),
    };
  }

  verifyCookie(cookieHeader, { host } = {}) {
    trimExpired(this.cookies);
    const sid = parseCookies(cookieHeader).get(this.cookieName);
    if (!sid) return null;
    const entry = this.cookies.get(sid);
    if (!entry) return null;
    if (host && entry.host && host !== entry.host) return null;
    entry.expiresAt = Date.now() + this.cookieTtlMs;
    return { sid, entry };
  }

  serializeCookie(sid, expiresAt) {
    const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
    const parts = [
      `${this.cookieName}=${encodeURIComponent(sid)}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${maxAge}`,
      this.secureCookies ? 'SameSite=None' : 'SameSite=Lax',
    ];
    if (this.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  reapExpired() {
    trimExpired(this.bootstrap);
    trimExpired(this.cookies);
  }
}
