/**
 * POST /api/ocr — VLM OCR endpoint (OCR module O1-d).
 *
 * Plain HTTP route (same worker→app pattern as /api/rag/search): the per-session SDK
 * worker's `ocr` tool reads a workspace file, base64s it, and POSTs here with the user's
 * cookie. Browser callers (the standalone converter, O2) use the same endpoint.
 *
 * Body: { contentBase64, mediaType, provider? }. PDF → render+per-page OCR; image → direct.
 * Returns { markdown }. The VLM provider (doubao default / mimo) is server-side config.
 *
 * BUG-008 OCR 大文件解析卡死根治（2026-06-18）：旧版本既无总超时也无 body 闸，VLM 上游慢/挂时
 * 整个端点会无限挂住，前端的 fetch 也就一直转圈不报错。这版加了 3 道闸：
 *  1. body 大小白名单（默认 25MB），超限明确 413 拒绝、不静默；
 *  2. 总 budget 超时（默认 5 分钟）通过 AbortSignal 串到 provider，超时返回明确 504；
 *  3. provider 内部每 attempt 60s 超时 + 3 次重试（见 src/server/ocr/provider.ts），
 *     最坏情况 ~3 分钟也兜得住，与本路由的 5 分钟总闸形成两道护栏。
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { isRagEnabled } from '~/server/rag/flag';
import { ocrPdfToMarkdown, ocrImageToMarkdown } from '~/server/rag/ocr-ingest';
import { ocrImages, type OcrProvider } from '~/server/ocr/provider';

/** 单次请求 body 上限（base64 inflated 已经 ~33%；25MB 解码后约 18.7MB，覆盖到 2.4MB 年报×8 张图远远够）。 */
const MAX_BODY_BYTES = Number(process.env.OCR_MAX_BODY_BYTES) || 25 * 1024 * 1024;
/** 单次 /api/ocr 请求总超时；触底返回 504，前端转明确失败而不是死转。 */
const TOTAL_BUDGET_MS = Number(process.env.OCR_TOTAL_BUDGET_MS) || 5 * 60_000;
/** 单图 base64 上限（防滥发巨图榨干 attempt 超时；解码后 ~7.5MB 已超 doubao 推荐图大小）。 */
const MAX_SINGLE_IMAGE_B64 = Number(process.env.OCR_MAX_SINGLE_IMAGE_B64) || 10 * 1024 * 1024;

export const Route = createFileRoute('/api/ocr')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isRagEnabled()) {
          return Response.json({ error: 'OCR disabled (RAG_ENABLED)' }, { status: 404 });
        }
        await requireUser(request);

        // BUG-008 闸 1: body 大小检查。content-length 不可靠（可能没设置）→ 用 arrayBuffer 长度
        // 双重把关。超限明确 413 而不是静默截断/跑空。
        const contentLengthHeader = request.headers.get('content-length');
        if (contentLengthHeader) {
          const declared = Number(contentLengthHeader);
          if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
            return Response.json(
              { error: `body too large: ${declared} > ${MAX_BODY_BYTES}` },
              { status: 413 },
            );
          }
        }

        let raw: ArrayBuffer;
        try {
          raw = await request.arrayBuffer();
        } catch (e) {
          return Response.json(
            { error: `failed to read body: ${e instanceof Error ? e.message : String(e)}` },
            { status: 400 },
          );
        }
        if (raw.byteLength > MAX_BODY_BYTES) {
          return Response.json(
            { error: `body too large: ${raw.byteLength} > ${MAX_BODY_BYTES}` },
            { status: 413 },
          );
        }

        let body: unknown;
        try {
          body = JSON.parse(new TextDecoder().decode(raw));
        } catch {
          return Response.json({ error: 'invalid JSON body' }, { status: 400 });
        }
        const { contentBase64, images, mediaType, provider, prompt } = (body ?? {}) as Record<string, unknown>;
        const mt = typeof mediaType === 'string' ? mediaType : 'application/octet-stream';
        const prov: OcrProvider | undefined = provider === 'mimo' || provider === 'doubao' ? provider : undefined;
        // Custom prompt. The 表格 mode embeds the page's parser text (prose to keep) so the VLM
        // returns the full page with only the table fixed — so the cap must fit a page of text.
        const customPrompt = typeof prompt === 'string' && prompt.trim() ? prompt.slice(0, 12000) : undefined;

        // BUG-008 闸 2: 总 budget 超时 + 客户端断连 abort。超时把 AbortSignal 翻给 provider，
        // 一路串到 fetch，整个端点最长 TOTAL_BUDGET_MS 必返回明确错误。
        const ctl = new AbortController();
        const onClientAbort = () => ctl.abort();
        request.signal?.addEventListener('abort', onClientAbort, { once: true });
        const budgetTimer = setTimeout(() => ctl.abort(), TOTAL_BUDGET_MS);

        try {
          // Multi-image (cross-page tables, table-v3): read several page images in one VLM call.
          if (Array.isArray(images) && images.length > 0) {
            const imgs = images.filter((v): v is string => typeof v === 'string').slice(0, 8);
            if (imgs.length === 0) return Response.json({ error: 'images empty' }, { status: 400 });
            const tooBig = imgs.find((b) => b.length > MAX_SINGLE_IMAGE_B64);
            if (tooBig) {
              return Response.json(
                { error: `single image base64 too large: ${tooBig.length} > ${MAX_SINGLE_IMAGE_B64}` },
                { status: 413 },
              );
            }
            const md = await ocrImages(imgs, mt === 'application/pdf' ? 'image/png' : mt, {
              provider: prov,
              prompt: customPrompt,
              signal: ctl.signal,
            });
            return md ? Response.json({ markdown: md }) : Response.json({ error: 'OCR produced no text' }, { status: 422 });
          }

          if (typeof contentBase64 !== 'string' || !contentBase64) {
            return Response.json({ error: 'contentBase64 or images is required' }, { status: 400 });
          }
          if (contentBase64.length > MAX_SINGLE_IMAGE_B64 * 4 /* PDF 多页可大些 */) {
            return Response.json(
              { error: `contentBase64 too large: ${contentBase64.length}` },
              { status: 413 },
            );
          }
          const bytes = Buffer.from(contentBase64, 'base64');
          if (bytes.length === 0) return Response.json({ error: 'empty content' }, { status: 400 });

          const markdown =
            mt === 'application/pdf'
              ? await ocrPdfToMarkdown(bytes, { provider: prov, prompt: customPrompt, signal: ctl.signal })
              : await ocrImageToMarkdown(bytes, mt, { provider: prov, prompt: customPrompt, signal: ctl.signal });

          if (!markdown) return Response.json({ error: 'OCR produced no text' }, { status: 422 });
          return Response.json({ markdown });
        } catch (err) {
          // BUG-008: budget 超时或 provider 真错都从这里冒出来；客户端拿到的不再是死转。
          const aborted = (err as Error)?.name === 'AbortError' || (err as Error)?.message === 'aborted';
          if (aborted && !request.signal?.aborted) {
            return Response.json(
              { error: `OCR timeout after ${TOTAL_BUDGET_MS}ms — try smaller file or retry` },
              { status: 504 },
            );
          }
          if (aborted) {
            return Response.json({ error: 'OCR aborted by client' }, { status: 499 });
          }
          return Response.json(
            { error: err instanceof Error ? err.message : 'OCR failed' },
            { status: 500 },
          );
        } finally {
          clearTimeout(budgetTimer);
          request.signal?.removeEventListener('abort', onClientAbort);
        }
      },
    },
  },
});
