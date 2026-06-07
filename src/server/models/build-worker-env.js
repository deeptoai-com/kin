/**
 * buildWorkerEnv — request-time provider/model routing for the agent worker (PR2).
 *
 * Plain JS (no .ts) so `ws-server.mjs` can import it directly (ws-server runs as a
 * separate `node` process and imports only .js from src/, no tsx loader).
 *
 * Given a model's connection metadata + the source env, returns a NEW env object
 * with the ANTHROPIC_* vars set to route the spawned Claude Agent SDK child to that
 * connection + model. The secret is read from `sourceEnv[meta.tokenEnv]` — tokens
 * never travel in metadata/DB/UI.
 *
 * SDK 0.2.112 contract (see research/2026-06-multi-model-context-pack.md §C):
 *  - auth via env only (no query() apiKey/baseUrl option);
 *  - ANTHROPIC_AUTH_TOKEN (Bearer) PRECEDES ANTHROPIC_API_KEY (x-api-key) → set
 *    exactly one and DELETE the other to avoid ambiguity / double headers;
 *  - alias vars (DEFAULT_*_MODEL / SUBAGENT) only take effect on a gateway; set them
 *    per-connection so sub-agents/background calls stay on THIS account.
 *
 * @typedef {Object} ModelRouteMeta
 * @property {string} baseUrl
 * @property {'bearer'|'x-api-key'} authStyle
 * @property {string} tokenEnv     - NAME of the env var holding the token
 * @property {string} model        - gateway model string (e.g. "glm-5.1")
 * @property {Record<string,string>=} customHeaders
 * @property {string=} aliasOpus
 * @property {string=} aliasSonnet
 * @property {string=} aliasHaiku
 * @property {string=} aliasSubagent
 *
 * @param {ModelRouteMeta} meta
 * @param {Record<string,string|undefined>} sourceEnv
 * @returns {Record<string,string|undefined>} a new env object
 */
export function buildWorkerEnv(meta, sourceEnv) {
  if (!meta || !meta.baseUrl || !meta.tokenEnv || !meta.model) {
    throw new Error('buildWorkerEnv: incomplete model metadata (need baseUrl, tokenEnv, model)');
  }
  const token = sourceEnv?.[meta.tokenEnv];
  if (!token || !String(token).trim()) {
    throw new Error(`buildWorkerEnv: token env "${meta.tokenEnv}" is not set on the server`);
  }

  const env = { ...sourceEnv };

  // Route. Only ANTHROPIC_BASE_URL is documented; set API_URL too so a stale value
  // from the parent env can't shadow it.
  env.ANTHROPIC_BASE_URL = meta.baseUrl;
  env.ANTHROPIC_API_URL = meta.baseUrl;

  // Mutually-exclusive auth.
  if (meta.authStyle === 'x-api-key') {
    env.ANTHROPIC_API_KEY = token;
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    env.ANTHROPIC_AUTH_TOKEN = token;
    delete env.ANTHROPIC_API_KEY;
  }

  env.ANTHROPIC_MODEL = meta.model;

  // Aliases fall back to the selected model so sub-agents/background calls don't
  // cross accounts. (Gateway-only env vars; inert on direct api.anthropic.com.)
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = meta.aliasOpus || meta.model;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = meta.aliasSonnet || meta.model;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = meta.aliasHaiku || meta.model;
  env.CLAUDE_CODE_SUBAGENT_MODEL = meta.aliasSubagent || meta.model;

  if (meta.customHeaders && Object.keys(meta.customHeaders).length > 0) {
    env.ANTHROPIC_CUSTOM_HEADERS = serializeCustomHeaders(meta.customHeaders);
  }

  return env;
}

/** ANTHROPIC_CUSTOM_HEADERS is a newline-separated list of `Name: Value`. */
export function serializeCustomHeaders(headers) {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
