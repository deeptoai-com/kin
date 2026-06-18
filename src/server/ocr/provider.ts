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
/**
 * BUG-008 OCR 卡死根治：每个 attempt 单独套超时 timeout；与外层 abort 用 AbortController 串联。
 * VLM 偶发上游慢/挂时，单次请求在 timeoutMs 内必定返回错误（→ 触发重试 / 上抛），不会把
 * 整张 OCR 流程吊死。`/api/ocr` 端点也会传入更大的总 budget signal 兜外层。
 *
 * Doubao（豆包）官方文档参考: ~20s/页；mimo ~6s/页。给单 attempt 60s 上限，足覆盖 P99，又不会
 * 让一页卡 5 分钟把整批顶死。重试 3 次共 ≤ ~3 分钟兜底，配合外层总超时形成两道闸。
 */
const ATTEMPT_TIMEOUT_MS = Number(process.env.OCR_PROVIDER_ATTEMPT_TIMEOUT_MS) || 60_000;

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
    // BUG-008: 每个 attempt 套独立超时（与外层 signal 串联），上游卡住时绝不挂死，
    // 触发 AbortError → 进入重试或最终上抛明确错误。
    const attemptCtl = new AbortController();
    const linkAbort = () => attemptCtl.abort();
    if (signal) {
      if (signal.aborted) attemptCtl.abort();
      else signal.addEventListener('abort', linkAbort, { once: true });
    }
    const timer = setTimeout(() => attemptCtl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: attemptCtl.signal,
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
      // 区分外层 abort（用户 Stop / 总超时） vs 单次 attempt 超时：
      // 外层 abort 直接上抛；单次超时映射成可重试错误。
      const aborted = (err as Error)?.name === 'AbortError' || (err as Error)?.message === 'aborted';
      if (aborted && signal?.aborted) throw err;
      if (aborted && !signal?.aborted) {
        lastErr = new Error(`OCR provider attempt timeout (${ATTEMPT_TIMEOUT_MS}ms)`);
      }
      if (attempt < MAX_RETRIES) {
        await sleep(800 * 2 ** attempt, signal);
        continue;
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', linkAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('OCR request failed');
}

/** doubao via ARK coding gateway — Anthropic Messages, one or more base64 image blocks. */
async function ocrDoubao(imagesB64: string[], mediaType: string, opts: OcrOptions): Promise<string> {
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
            ...imagesB64.map((data) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })),
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

/** mimo via OpenRouter — OpenAI chat, one or more base64 data-url images. */
async function ocrMimo(imagesB64: string[], mediaType: string, opts: OcrOptions): Promise<string> {
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
            ...imagesB64.map((b64) => ({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${b64}` } })),
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
 * OCR one or more page images together → markdown (multi-image = cross-page tables: the
 * VLM reads the pages in one message and can stitch a table that spans them).
 */
export async function ocrImages(imagesB64: string[], mediaType: string, opts: OcrOptions = {}): Promise<string> {
  if (imagesB64.length === 0) return '';
  const provider = opts.provider ?? defaultOcrProvider();
  return provider === 'mimo' ? ocrMimo(imagesB64, mediaType, opts) : ocrDoubao(imagesB64, mediaType, opts);
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
  return ocrImages([imageBase64], mediaType, opts);
}
