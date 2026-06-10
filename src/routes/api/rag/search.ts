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

export const Route = createFileRoute('/api/rag/search')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser(request);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'invalid JSON body' }, { status: 400 });
        }
        const { query, k, documentId, kbId } = (body ?? {}) as Record<string, unknown>;
        if (typeof query !== 'string' || !query.trim()) {
          return Response.json({ error: 'query is required' }, { status: 400 });
        }

        const hits = await searchKb(user.id, {
          query,
          k: typeof k === 'number' ? k : undefined,
          documentId: typeof documentId === 'string' ? documentId : undefined,
          kbId: typeof kbId === 'string' ? kbId : undefined,
        });
        return Response.json({ hits });
      },
    },
  },
});
