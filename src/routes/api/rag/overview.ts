/**
 * GET /api/rag/overview — what's searchable in the user's knowledge base.
 *
 * Called by the per-session SDK worker at startup (same cookie-callback pattern as
 * /api/rag/search) to inject a document inventory into the system prompt. The model
 * only reaches for kb_search when it KNOWS the knowledge base covers the question —
 * without this it falls back to web search even for ingested documents (the observed
 * "kb_search never fires" failure).
 */
import { createFileRoute } from '@tanstack/react-router';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { documents } from '~/db/schema/document.schema';
import { kbDocuments } from '~/db/schema/kb-document.schema';
import { knowledgeBases } from '~/db/schema/knowledge-base.schema';
import { requireUser } from '~/server/require-user';
import { isRagEnabled } from '~/server/rag/flag';
import { accessibleProjectIds, visibleDocumentsWhere } from '~/server/projects/access';

export const Route = createFileRoute('/api/rag/overview')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isRagEnabled()) {
          return Response.json({ documents: [] });
        }
        const user = await requireUser(request);
        const projectIds = await accessibleProjectIds(user.id);

        const rows = await db
          .select({
            id: documents.id,
            title: documents.title,
            fileId: documents.fileId,
            pageMap: documents.pageMap,
            tokenEstimate: documents.tokenEstimate,
          })
          .from(documents)
          .where(and(visibleDocumentsWhere(user.id, projectIds), eq(documents.ingestStatus, 'ready')))
          .limit(50);

        // Attach KB names so the model can mention which knowledge base covers what.
        const fileIds = rows.map((r) => r.fileId).filter((v): v is string => !!v);
        const links = fileIds.length
          ? await db
              .select({ fileId: kbDocuments.fileId, kbName: knowledgeBases.name })
              .from(kbDocuments)
              .innerJoin(knowledgeBases, eq(kbDocuments.kbId, knowledgeBases.id))
              .where(inArray(kbDocuments.fileId, fileIds))
          : [];
        const kbsByFile = new Map<string, string[]>();
        for (const l of links) {
          const arr = kbsByFile.get(l.fileId) ?? [];
          arr.push(l.kbName);
          kbsByFile.set(l.fileId, arr);
        }

        return Response.json({
          documents: rows.map((r) => ({
            title: r.title,
            pages: Array.isArray(r.pageMap) && r.pageMap.length > 0
              ? (r.pageMap[r.pageMap.length - 1] as { page?: number }).page ?? null
              : null,
            tokens: r.tokenEstimate,
            knowledgeBases: r.fileId ? (kbsByFile.get(r.fileId) ?? []) : [],
          })),
        });
      },
    },
  },
});
