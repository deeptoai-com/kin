/**
 * Internal model-resolve endpoint (PR4) — token-free metadata for ws-server routing.
 *
 * GET /api/models/resolve/:id → the connection metadata ws-server needs to build the
 * worker env for the selected model. Returns NO secret (only `tokenEnv`, the name).
 * Cookie-authed like the other internal endpoints (src/routes/api/agent-sessions/*).
 * Response shape is validated against the shared contract (arch finding A1).
 */

import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { resolveModelMeta } from '~/server/models/registry';
import {
  RESOLVE_MODEL_CONTRACT_VERSION,
  resolveModelResponseSchema,
} from '~/server/models/resolve-contract';

export const Route = createFileRoute('/api/models/resolve/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        await requireUser(request); // any authenticated org user; metadata is non-secret
        const meta = await resolveModelMeta(params.id);
        if (!meta) {
          return new Response(JSON.stringify({ error: 'Model not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        // Validate our own output against the shared contract before sending.
        const body = resolveModelResponseSchema.parse({ v: RESOLVE_MODEL_CONTRACT_VERSION, ...meta });
        return Response.json(body);
      },
    },
  },
});
