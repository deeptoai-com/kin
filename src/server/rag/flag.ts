/**
 * RAG master switch — deliberately a single env flag (no DB/admin toggle).
 *
 * main carries the full RAG implementation (#153–#165) but the team has not adopted
 * it; the feature keeps evolving on the `rag-line` branch. Default OFF keeps RAG
 * completely dark on main deployments. A release that wants RAG sets RAG_ENABLED=true
 * in the deploy env (compose files forward it to the app service).
 *
 * The ws-query-worker is plain node (no TS imports) and mirrors this check inline —
 * keep the env name in sync there (ws-query-worker.mjs, kb_search registration).
 */
export function isRagEnabled(): boolean {
  return process.env.RAG_ENABLED === 'true';
}
