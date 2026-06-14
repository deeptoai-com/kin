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
import { ocrImages, type OcrProvider } from '~/server/ocr/provider';

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
        const { contentBase64, images, mediaType, provider, prompt } = (body ?? {}) as Record<string, unknown>;
        const mt = typeof mediaType === 'string' ? mediaType : 'application/octet-stream';
        const prov: OcrProvider | undefined = provider === 'mimo' || provider === 'doubao' ? provider : undefined;
        // Custom prompt. The 表格 mode embeds the page's parser text (prose to keep) so the VLM
        // returns the full page with only the table fixed — so the cap must fit a page of text.
        const customPrompt = typeof prompt === 'string' && prompt.trim() ? prompt.slice(0, 12000) : undefined;

        // Multi-image (cross-page tables, table-v3): read several page images in one VLM call.
        if (Array.isArray(images) && images.length > 0) {
          const imgs = images.filter((v): v is string => typeof v === 'string').slice(0, 8);
          if (imgs.length === 0) return Response.json({ error: 'images empty' }, { status: 400 });
          const md = await ocrImages(imgs, mt === 'application/pdf' ? 'image/png' : mt, { provider: prov, prompt: customPrompt });
          return md ? Response.json({ markdown: md }) : Response.json({ error: 'OCR produced no text' }, { status: 422 });
        }

        if (typeof contentBase64 !== 'string' || !contentBase64) {
          return Response.json({ error: 'contentBase64 or images is required' }, { status: 400 });
        }
        const bytes = Buffer.from(contentBase64, 'base64');
        if (bytes.length === 0) return Response.json({ error: 'empty content' }, { status: 400 });

        const markdown =
          mt === 'application/pdf'
            ? await ocrPdfToMarkdown(bytes, { provider: prov, prompt: customPrompt })
            : await ocrImageToMarkdown(bytes, mt, { provider: prov, prompt: customPrompt });

        if (!markdown) return Response.json({ error: 'OCR produced no text' }, { status: 422 });
        return Response.json({ markdown });
      },
    },
  },
});
