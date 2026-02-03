import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { chromium } from 'playwright';

const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2MB
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MAX_DIMENSION = 12000;
const MIN_DIMENSION = 320;

type RenderRequest = {
  html: string;
  width?: number;
  height?: number;
  baseUrl?: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.toString().replace(/\/?$/, '/');
  } catch {
    return undefined;
  }
}

function injectBaseTag(html: string, baseUrl?: string): string {
  if (!baseUrl) return html;
  if (/<base\s/i.test(html)) return html;

  const baseTag = `<base href="${baseUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n  ${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>\n  ${baseTag}\n</head>`);
  }
  return `<head>${baseTag}</head>${html}`;
}

export const Route = createFileRoute('/api/artifacts/render-png')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await requireUser(request);

        let payload: RenderRequest;
        try {
          payload = (await request.json()) as RenderRequest;
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (!payload?.html || typeof payload.html !== 'string') {
          return new Response(JSON.stringify({ error: 'Missing html' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (payload.html.length > MAX_HTML_SIZE) {
          return new Response(JSON.stringify({ error: 'HTML too large' }), {
            status: 413,
            headers: { 'content-type': 'application/json' },
          });
        }

        const width = clamp(
          Number.isFinite(payload.width) ? Number(payload.width) : DEFAULT_WIDTH,
          MIN_DIMENSION,
          MAX_DIMENSION
        );
        const height = clamp(
          Number.isFinite(payload.height) ? Number(payload.height) : DEFAULT_HEIGHT,
          MIN_DIMENSION,
          MAX_DIMENSION
        );

        const baseUrl = normalizeBaseUrl(payload.baseUrl);
        const html = injectBaseTag(payload.html, baseUrl);
        const timeoutMs = 15000;
        const browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });

        try {
          const page = await browser.newPage({
            viewport: { width, height },
          });
          page.setDefaultTimeout(timeoutMs);

          await page.setContent(html, { waitUntil: 'networkidle' });

          const scrollHeight = await page.evaluate(() => {
            const docEl = document.documentElement;
            const body = document.body;
            return Math.max(
              docEl?.scrollHeight || 0,
              body?.scrollHeight || 0,
              docEl?.clientHeight || 0
            );
          });

          let screenshotBuffer: Buffer;
          if (scrollHeight > MAX_DIMENSION) {
            screenshotBuffer = await page.screenshot({
              type: 'png',
              clip: {
                x: 0,
                y: 0,
                width,
                height: MAX_DIMENSION,
              },
            });
          } else {
            screenshotBuffer = await page.screenshot({
              type: 'png',
              fullPage: true,
            });
          }

          return new Response(screenshotBuffer, {
            status: 200,
            headers: {
              'content-type': 'image/png',
              'cache-control': 'no-store',
            },
          });
        } catch (error) {
          console.error('[Artifacts] Failed to render PNG:', error);
          return new Response(JSON.stringify({ error: 'Failed to render PNG' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        } finally {
          await browser.close();
        }
      },
    },
  },
});
