/**
 * Model health probe (PR3).
 *
 * Sends the SAME minimal request the SDK would (Anthropic Messages API at
 * `{baseUrl}/v1/messages`) to decide whether a model is actually usable
 * (reachable + authed + model-accepted). DB-free + dependency-injectable so it
 * unit-tests without a live DB or network. The DB write lives in the worker
 * processor (src/worker/processors/probeModels.ts).
 *
 * Status-code classification (see context pack §C / §G):
 *  200 → healthy · 429 → healthy (throttled but usable) · 401/403 → auth
 *  400/404 → model (gateways differ; ARK verified empirically) · 5xx → http_5xx
 *  abort → timeout · throw → network · missing token → auth
 */

export type ProbeHealth = 'healthy' | 'unhealthy';
export type ProbeError = 'auth' | 'model' | 'network' | 'timeout' | 'http_5xx' | `http_${number}` | null;
export type ProbeResult = { health: ProbeHealth; probeError: ProbeError; latencyMs: number };

export interface ProbeInput {
  baseUrl: string;
  authStyle: 'bearer' | 'x-api-key';
  tokenEnv: string;
  model: string;
  anthropicVersion?: string;
  customHeaders?: Record<string, string> | null;
}

export interface ProbeOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** Map an HTTP status to a probe verdict. */
export function classifyProbeStatus(status: number, latencyMs: number): ProbeResult {
  if (status >= 200 && status < 300) return { health: 'healthy', probeError: null, latencyMs };
  if (status === 429) return { health: 'healthy', probeError: null, latencyMs }; // throttled but usable
  if (status === 401 || status === 403) return { health: 'unhealthy', probeError: 'auth', latencyMs };
  if (status === 400 || status === 404) return { health: 'unhealthy', probeError: 'model', latencyMs };
  if (status >= 500) return { health: 'unhealthy', probeError: 'http_5xx', latencyMs };
  return { health: 'unhealthy', probeError: `http_${status}`, latencyMs };
}

/** Probe one model's connection. Reads the token from env[tokenEnv] (never logged). */
export async function probeModelMeta(meta: ProbeInput, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;

  const token = env[meta.tokenEnv];
  if (!token || !String(token).trim()) {
    return { health: 'unhealthy', probeError: 'auth', latencyMs: 0 };
  }

  const url = `${meta.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': meta.anthropicVersion || '2023-06-01',
    ...meta.customHeaders,
  };
  if (meta.authStyle === 'x-api-key') headers['x-api-key'] = token;
  else headers['authorization'] = `Bearer ${token}`;

  const body = JSON.stringify({
    model: meta.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
    return classifyProbeStatus(res.status, Date.now() - started);
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (error instanceof Error && error.name === 'AbortError') {
      return { health: 'unhealthy', probeError: 'timeout', latencyMs };
    }
    return { health: 'unhealthy', probeError: 'network', latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
