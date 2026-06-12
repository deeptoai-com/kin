/**
 * POST /api/rag/search — the kb_search retrieval endpoint (final spec D6/D7).
 *
 * Plain HTTP route (not a server-fn) ON PURPOSE: the per-session SDK worker is plain
 * node (no TS imports, no DB, by design) and calls back into the app with the user's
 * cookie — the same worker→app pattern as persistSession (/api/agent-sessions). The
 * cookie travels via the worker's stdin request, NOT its env, so agent-spawned Bash
 * children can't read it. Browser callers (DocsUI later) use the same endpoint.
 *
 * Isolation: requireUser → searchKb scopes BOTH recall legs through the access
 * resolver. No raw user_id filters here.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { searchKb } from '~/server/rag/search';
import { isRagEnabled } from '~/server/rag/flag';

export const Route = createFileRoute('/api/rag/search')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Flag off → the worker never registers kb_search, but the endpoint stays
        // reachable with a session cookie; refuse here too so RAG is fully dark.
        if (!isRagEnabled()) {
          return Response.json({ error: 'RAG disabled (RAG_ENABLED)' }, { status: 404 });
        }
        const user = await requireUser(request);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'invalid JSON body' }, { status: 400 });
        }
        const { query, k, documentId, kbId, kbIds } = (body ?? {}) as Record<string, unknown>;
        if (typeof query !== 'string' || !query.trim()) {
          return Response.json({ error: 'query is required' }, { status: 400 });
        }

        const hits = await searchKb(user.id, {
          query,
          k: typeof k === 'number' ? k : undefined,
          documentId: typeof documentId === 'string' ? documentId : undefined,
          kbId: typeof kbId === 'string' ? kbId : undefined,
          // Session scope picker (prd 阶段3): forwarded by the worker from the chat request.
          kbIds: Array.isArray(kbIds) ? kbIds.filter((v): v is string => typeof v === 'string') : undefined,
        });
        return Response.json({ hits });
      },
    },
  },
});
