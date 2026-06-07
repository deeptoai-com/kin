/**
 * Internal-API contract for model resolution (PR4 / arch finding A1).
 *
 * The shared, versioned shape exchanged across the ws-server ↔ web-app process
 * boundary. The web-app route validates its response against this schema; ws-server
 * (plain JS) validates the response it receives with the same field set. Defining the
 * contract once is the template the project's other untyped internal `/api/*`
 * endpoints should converge to (see 2026-06-architecture-observations.md §A1).
 *
 * NOTE: this carries `tokenEnv` (the env-var NAME) but NEVER a token value — the
 * secret stays in the backend process env and is read at spawn time.
 */

import { z } from 'zod';

export const RESOLVE_MODEL_CONTRACT_VERSION = 1;

export const resolveModelResponseSchema = z.object({
  v: z.literal(RESOLVE_MODEL_CONTRACT_VERSION),
  id: z.string(),
  model: z.string(),
  connectionId: z.string(),
  baseUrl: z.string().url(),
  authStyle: z.enum(['bearer', 'x-api-key']),
  tokenEnv: z.string(),
  anthropicVersion: z.string(),
  customHeaders: z.record(z.string(), z.string()).nullable(),
  aliasOpus: z.string().nullable(),
  aliasSonnet: z.string().nullable(),
  aliasHaiku: z.string().nullable(),
  aliasSubagent: z.string().nullable(),
  enabled: z.boolean(),
  health: z.enum(['healthy', 'unhealthy', 'unknown']),
});

export type ResolveModelResponse = z.infer<typeof resolveModelResponseSchema>;
