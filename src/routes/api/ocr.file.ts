/**
 * GET /api/ocr/file?jobId=<id> — stream the original file stored for an OCR history job.
 *
 * History (ocr_jobs) keeps the uploaded file in S3 (fileId); on reopen the converter needs the
 * real PDF bytes back to render page previews + run table OCR. MinIO isn't browser-reachable,
 * so the app proxies the bytes (server-side S3 read). Scoped to the job's owner.
 */
import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { ocrJobs } from '~/db/schema/ocr-job.schema';
import { files } from '~/db/schema/file.schema';
import { requireUser } from '~/server/require-user';
import { isRagEnabled } from '~/server/rag/flag';

export const Route = createFileRoute('/api/ocr/file')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isRagEnabled()) return Response.json({ error: 'OCR disabled' }, { status: 404 });
        const user = await requireUser(request);
        const jobId = new URL(request.url).searchParams.get('jobId');
        if (!jobId) return Response.json({ error: 'jobId required' }, { status: 400 });

        const [job] = await db
          .select({ fileId: ocrJobs.fileId })
          .from(ocrJobs)
          .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.userId, user.id)))
          .limit(1);
        if (!job?.fileId) return Response.json({ error: 'file not found' }, { status: 404 });

        const [file] = await db.select().from(files).where(eq(files.id, job.fileId)).limit(1);
        if (!file?.key) return Response.json({ error: 'file not found' }, { status: 404 });

        const { S3StaticFileImpl } = await import('~/server/s3/s3');
        const bytes = await new S3StaticFileImpl().getFileByteArray(file.key);
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            'Content-Type': file.mimeType || file.fileType || 'application/octet-stream',
            'Content-Length': String(bytes.byteLength),
          },
        });
      },
    },
  },
});
