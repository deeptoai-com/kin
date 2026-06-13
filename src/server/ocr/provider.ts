/**
 * OCR provider abstraction (OCR module O1) — one VLM-OCR core, pluggable backends.
 *
 * Model is ALWAYS configurable (env-overridable) with retained candidates. Two providers,
 * two API shapes, one `ocrImage()` returning markdown:
 *  - `doubao` (DEFAULT): ARK coding gateway `/v1/messages`, Anthropic Messages format,
 *    Bearer ANTHROPIC_AUTH_TOKEN, model `doubao-seed-2.0-mini`. Accurate on Chinese docs +
 *    runs on the team's own ARK quota (north-star: self-hosted, own gateway, no per-page $).
 *  - `mimo` (alternative): OpenRouter `/chat/completions`, OpenAI format, Bearer
 *    OPENROUTER_API_KEY, model `xiaomi/mimo-v2.5`. Accurate, ~14s/page. NB: mimo is a
 *    REASONING model — we MUST send `reasoning:{enabled:false}` or it burns the token
 *    budget on chain-of-thought (verified: 3300+ reasoning tokens) and returns empty/
 *    truncated OCR. OCR needs transcription, not reasoning.
 *
 * (gemma-4-31b dropped 2026-06-13: verified inaccurate on Chinese — misread company names,
 * emitted Burmese glyphs. doubao/mimo both clean on the same page.)
 *
 * Consumers: ① the `ocr` agent tool (via /api/ocr), ② RAG ingest scanned-file branch,
 * ③ the standalone converter module. All get markdown back. No auto-routing — the provider
 * is an explicit choice (OCR_PROVIDER env / UI selector), default doubao.
 *
 * NB: VLM OCR can hallucinate on hard cells. The prompt says don't fabricate, but the real
 * guardrail is the side-by-side + quality badge in the UI (PRD §6.1, blog D5).
 */

export type OcrProvider = 'doubao' | 'mimo';

/** Retained candidates for the UI selector (configurable; default first). */
export const OCR_PROVIDERS: ReadonlyArray<{
  id: OcrProvider;
  label: string;
  hint: string;
}> = [
  { id: 'doubao', label: '豆包 Seed 2.0 mini', hint: '自家 ARK 额度 · 准 · ~20s/页' },
  { id: 'mimo', label: '小米 MiMo v2.5', hint: '快 3 倍 ~6s/页 · 准 · 按页计费' },
];

export interface OcrOptions {
  /** Override the OCR instruction (e.g. table-focus / handwriting modes). */
  prompt?: string;
  /** Override the provider for this call (default = OCR_PROVIDER env, else doubao). */
  provider?: OcrProvider;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Default OCR instruction: faithful markdown, no fabrication of unreadable content. */
const DEFAULT_PROMPT =
  '提取这张图里的全部文字，按原始版面输出 markdown（标题、段落、表格都尽量还原结构）。' +
  '只输出文档内容本身，不要加任何说明或解释。看不清/无法确定的内容标注「[?]」，不要编造。';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

export function defaultOcrProvider(): OcrProvider {
  return process.env.OCR_PROVIDER === 'mimo' ? 'mimo' : 'doubao';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });
}

async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
      });
      if (res.ok) return res;
      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
        await sleep(800 * 2 ** attempt, signal);
        continue;
      }
      const text = await res.text().catch(() => '');
      throw new Error(`OCR provider HTTP ${res.status}: ${text.slice(0, 300)}`);
    } catch (err) {
      lastErr = err;
      if ((err as Error)?.name === 'AbortError' || (err as Error)?.message === 'aborted') throw err;
      if (attempt < MAX_RETRIES) {
        await sleep(800 * 2 ** attempt, signal);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('OCR request failed');
}

/** doubao via ARK coding gateway — Anthropic Messages format with a base64 image block. */
async function ocrDoubao(imageBase64: string, mediaType: string, opts: OcrOptions): Promise<string> {
  const key = process.env.ARK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key) throw new Error('ARK key not set (ARK_API_KEY or ANTHROPIC_AUTH_TOKEN) — required for doubao OCR.');
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding').replace(/\/$/, '');
  const model = process.env.OCR_DOUBAO_MODEL || 'doubao-seed-2.0-mini';
  const res = await postJsonWithRetry(
    `${base}/v1/messages`,
    { Authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: opts.maxTokens ?? 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt ?? DEFAULT_PROMPT },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          ],
        },
      ],
    },
    opts.signal,
  );
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}

/** mimo via OpenRouter — OpenAI chat format with a base64 data-url image. */
async function ocrMimo(imageBase64: string, mediaType: string, opts: OcrOptions): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set — required for mimo OCR.');
  const base = (process.env.OCR_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env.OCR_MIMO_MODEL || 'xiaomi/mimo-v2.5';
  const res = await postJsonWithRetry(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${key}` },
    {
      model,
      max_tokens: opts.maxTokens ?? 8192,
      // mimo is a reasoning model — disable it: OCR is transcription, and reasoning
      // tokens otherwise eat the budget and truncate/empty the output.
      reasoning: { enabled: false },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt ?? DEFAULT_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          ],
        },
      ],
    },
    opts.signal,
  );
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * OCR a single page image → markdown. `imageBase64` is the raw base64 (no data-url prefix);
 * `mediaType` like 'image/jpeg' | 'image/png'. Provider defaults to OCR_PROVIDER env (doubao).
 */
export async function ocrImage(
  imageBase64: string,
  mediaType: string,
  opts: OcrOptions = {},
): Promise<string> {
  const provider = opts.provider ?? defaultOcrProvider();
  return provider === 'mimo'
    ? ocrMimo(imageBase64, mediaType, opts)
    : ocrDoubao(imageBase64, mediaType, opts);
}
