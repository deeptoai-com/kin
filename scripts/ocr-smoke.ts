/**
 * OCR provider smoke test (OCR module O1) — verifies both VLM backends end-to-end.
 *   pnpm tsx scripts/ocr-smoke.ts <image-path>
 * Requires OCR env (ANTHROPIC_AUTH_TOKEN / OPENROUTER_API_KEY / OCR_*). Run with secrets sourced.
 */
import { readFileSync } from 'node:fs';
import { ocrImage, type OcrProvider } from '~/server/ocr/provider';

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: tsx scripts/ocr-smoke.ts <image-path>');
  const bytes = readFileSync(path);
  const b64 = bytes.toString('base64');
  const mediaType = path.endsWith('.png') ? 'image/png' : 'image/jpeg';

  for (const provider of ['doubao', 'mimo'] as OcrProvider[]) {
    process.stdout.write(`\n===== ${provider} =====\n`);
    const t0 = Date.now();
    try {
      const md = await ocrImage(b64, mediaType, { provider, maxTokens: 700 });
      process.stdout.write(`${md.slice(0, 500)}\n--- ${md.length} chars, ${Date.now() - t0}ms ---\n`);
    } catch (err) {
      process.stdout.write(`FAILED: ${(err as Error).message}\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
