/**
 * PUT /api/documents/upload?id=<fileId>&key=<objectKey> — binary direct upload.
 *
 * Replaces the base64-over-server-fn fallback for file bytes (KB redesign prd 阶段5):
 * the browser PUTs the RAW file body via XHR so it gets a real upload progress bar,
 * the payload is 25% smaller (no base64), and neither side builds giant strings.
 * The files row is created beforehand by initDocumentUpload — this only stores bytes
 * and finalizes url/size. Used whenever presigned upload is off (always in the tunnel
 * prod stack: MinIO is not browser-reachable).
 */
import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents } from '~/db/schema/document.schema';
import { requireUser } from '~/server/require-user';
import { isRagEnabled } from '~/server/rag/flag';
import { S3StaticFileImpl } from '~/server/s3/s3';

const fileService = new S3StaticFileImpl();

export const Route = createFileRoute('/api/documents/upload')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const user = await requireUser(request);
        const url = new URL(request.url);
        const id = url.searchParams.get('id');
        const key = url.searchParams.get('key');
        if (!id || !key) {
          return Response.json({ error: 'id and key are required' }, { status: 400 });
        }

        const [file] = await db
          .select()
          .from(files)
          .where(and(eq(files.id, id), eq(files.clientId, user.id)))
          .limit(1);
        if (!file || file.key !== key) {
          return Response.json({ error: 'File record not found' }, { status: 404 });
        }

        const body = Buffer.from(await request.arrayBuffer());
        if (body.length === 0) {
          return Response.json({ error: 'Empty body' }, { status: 400 });
        }

        await fileService.uploadContent(key, body);
        const fullUrl = await fileService.getFullFileUrl(key);
        const now = new Date();
        await db
          .update(files)
          .set({ url: fullUrl, size: body.length, updatedAt: now, accessedAt: now })
          .where(eq(files.id, file.id));

        // Bytes are in S3 now → schedule a content-less KB document awaiting ingest (race-free,
        // dedup by jobId). Without this, a content-less PDF uploaded via the KB/upload flow stays
        // 'pending' forever unless the user separately triggers the parse dialog. Inlined (NOT a
        // shared helper import) so this api route never drags db/postgres into the client bundle.
        if (isRagEnabled()) {
          const [doc] = await db
            .select({ id: documents.id, ingestStatus: documents.ingestStatus, content: documents.content })
            .from(documents)
            .where(eq(documents.fileId, file.id))
            .limit(1);
          if (doc && doc.ingestStatus === 'pending' && !doc.content?.trim().length) {
            const { scheduleRagIngest } = await import('~/server/rag/queue');
            await scheduleRagIngest(doc.id);
          }
        }

        return Response.json({ id: file.id, url: fullUrl, size: body.length });
      },
    },
  },
});
