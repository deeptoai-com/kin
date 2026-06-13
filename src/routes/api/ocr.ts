/**
 * POST /api/ocr — VLM OCR endpoint (OCR module O1-d).
 *
 * Plain HTTP route (same worker→app pattern as /api/rag/search): the per-session SDK
 * worker's `ocr` tool reads a workspace file, base64s it, and POSTs here with the user's
 * cookie. Browser callers (the standalone converter, O2) use the same endpoint.
 *
 * Body: { contentBase64, mediaType, provider? }. PDF → render+per-page OCR; image → direct.
 * Returns { markdown }. The VLM provider (doubao default / mimo) is server-side config.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { isRagEnabled } from '~/server/rag/flag';
import { ocrPdfToMarkdown, ocrImageToMarkdown } from '~/server/rag/ocr-ingest';
import type { OcrProvider } from '~/server/ocr/provider';

export const Route = createFileRoute('/api/ocr')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isRagEnabled()) {
          return Response.json({ error: 'OCR disabled (RAG_ENABLED)' }, { status: 404 });
        }
        await requireUser(request);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'invalid JSON body' }, { status: 400 });
        }
        const { contentBase64, mediaType, provider } = (body ?? {}) as Record<string, unknown>;
        if (typeof contentBase64 !== 'string' || !contentBase64) {
          return Response.json({ error: 'contentBase64 is required' }, { status: 400 });
        }
        const mt = typeof mediaType === 'string' ? mediaType : 'application/octet-stream';
        const prov: OcrProvider | undefined = provider === 'mimo' || provider === 'doubao' ? provider : undefined;

        const bytes = Buffer.from(contentBase64, 'base64');
        if (bytes.length === 0) return Response.json({ error: 'empty content' }, { status: 400 });

        const markdown =
          mt === 'application/pdf'
            ? await ocrPdfToMarkdown(bytes, { provider: prov })
            : await ocrImageToMarkdown(bytes, mt, { provider: prov });

        if (!markdown) return Response.json({ error: 'OCR produced no text' }, { status: 422 });
        return Response.json({ markdown });
      },
    },
  },
});
