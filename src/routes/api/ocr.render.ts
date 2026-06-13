/**
 * POST /api/ocr/render — rasterize a PDF to per-page PNGs for the standalone converter
 * (OCR module O2). The browser uploads the PDF; we return page images so the converter
 * can show the original (left pane) AND drive per-page OCR (逐页即显) via /api/ocr.
 *
 * Body: raw PDF bytes (application/pdf). Returns { count, truncated, pages: [{page, image}] }.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { isRagEnabled } from '~/server/rag/flag';
import { renderPdfViaSidecar } from '~/server/rag/parser-client';

export const Route = createFileRoute('/api/ocr/render')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isRagEnabled()) {
          return Response.json({ error: 'OCR disabled (RAG_ENABLED)' }, { status: 404 });
        }
        await requireUser(request);
        const url = new URL(request.url);
        const dpi = Number(url.searchParams.get('dpi')) || 150;
        const bytes = Buffer.from(await request.arrayBuffer());
        if (bytes.length === 0) return Response.json({ error: 'empty body' }, { status: 400 });
        const r = await renderPdfViaSidecar(bytes, { dpi });
        if (!r.ok || !r.pages) {
          return Response.json({ error: r.error || 'render failed' }, { status: 502 });
        }
        return Response.json({ count: r.count, truncated: r.truncated, pages: r.pages });
      },
    },
  },
});
