/**
 * Embedding provider A/B — Zhipu embedding-3@1024 vs Doubao doubao-embedding-vision@2048.
 * IN-MEMORY (brute-force cosine), touches NO tables — the two providers have different
 * dims so a DB comparison would require schema churn before we even know the winner.
 *
 *   DATABASE_URL not needed.
 *   ZHIPU_API_KEY=... ANTHROPIC_AUTH_TOKEN=<ark-key> npx tsx scripts/rag-embed-ab.ts
 *
 * Corpora:
 *  A. synthetic golden set v1 (2 docs, 14 tagged cases — same as scripts/rag-eval.ts)
 *  B. REAL prospectus subset (rag-test-docs/minimax.md, financial-info window) with 6
 *     paraphrase needle questions judged by expectText-in-chunk
 * Metrics: R@1 / R@4 / MRR per provider per corpus. Also reports embed throughput.
 */
import { readFileSync } from 'node:fs';
import { chunkMarkdown } from '../src/server/rag/chunker';
import { embedTexts as embedZhipu } from '../src/server/rag/zhipu';
import { GOLDEN_DOCS, GOLDEN_CASES } from '../tests/golden/rag-golden-set';

const ARK_BASE = process.env.ARK_EMBED_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_MODEL = 'doubao-embedding-vision-250615';

function arkKey(): string {
  const k = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!k) throw new Error('ANTHROPIC_AUTH_TOKEN (ARK key) not set');
  return k;
}

/** doubao-embedding-vision has NO batching: input[] is ONE multimodal sample → 1 vector. */
async function embedDoubao(texts: readonly string[], concurrency = 4, dimensions?: number): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  let next = 0;
  async function lane() {
    while (next < texts.length) {
      const i = next++;
      const res = await fetch(`${ARK_BASE}/embeddings/multimodal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${arkKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ARK_MODEL, input: [{ type: 'text', text: texts[i] }], ...(dimensions ? { dimensions } : {}) }),
      });
      if (!res.ok) throw new Error(`doubao ${res.status}: ${(await res.text()).slice(0, 200)}`);
      out[i] = (await res.json()).data.embedding as number[];
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface Corpus {
  name: string;
  chunks: Array<{ sectionPath: string; text: string }>;
  cases: Array<{ query: string; isHit: (c: { sectionPath: string; text: string }) => boolean }>;
}

function buildSynthetic(): Corpus {
  const chunks = GOLDEN_DOCS.flatMap((d) => {
    const { parents } = chunkMarkdown(d.title, d.markdown);
    return parents;
  });
  return {
    name: 'synthetic-v1 (14 cases)',
    chunks,
    cases: GOLDEN_CASES.map((c) => ({
      query: c.query,
      isHit: (chunk) => chunk.sectionPath.startsWith(c.doc) && chunk.sectionPath.includes(c.expectSection),
    })),
  };
}

const REAL_CASES: Array<{ query: string; expectText: string }> = [
  // 财务区
  { query: '研发团队有多少人', expectText: '約300名成員' },
  { query: '流动负债净额增长到了多少', expectText: '343.3' },
  { query: '公司预计每个月要烧多少钱', expectText: '28.1' },
  { query: '账上的现金结余还有多少', expectText: '1,046.2' },
  { query: '毛利率是怎么改善的', expectText: '24.7%' },
  { query: '2022年公司亏了多少钱', expectText: '73.7' },
  // 业务区
  { query: '产品覆盖了多少个国家的用户', expectText: '200個國家' },
  { query: '月活跃用户增长情况如何', expectText: '19.1百萬' },
  { query: '付费用户数量达到多少', expectText: '650,300' },
  { query: '开放平台付费用户是怎么定义的', expectText: '50美元' },
  { query: '视频生成用的是哪个模型', expectText: 'Hailuo-02' },
  { query: '语音合成模型叫什么', expectText: 'Speech-02' },
];

function buildReal(): Corpus {
  const md = readFileSync(new URL('../../rag-test-docs/minimax.md', import.meta.url), 'utf8');
  // Two anchored windows (business overview + financial info) so every expectText is
  // in-corpus, surrounded by plenty of distractor text (~real retrieval conditions).
  const windows = ['19.1百萬', '343.3'].map((a) => {
    const i = md.indexOf(a);
    if (i < 0) throw new Error(`anchor not found: ${a}`);
    return md.slice(Math.max(0, i - 60_000), i + 60_000);
  });
  const { parents } = chunkMarkdown('MiniMax招股书', windows.join('\n\n'));
  for (const c of REAL_CASES) {
    if (!parents.some((p) => p.text.includes(c.expectText))) {
      throw new Error(`expectText not in corpus window: ${c.expectText}`);
    }
  }
  return {
    name: `minimax-real (${REAL_CASES.length} cases, ${parents.length} chunks)`,
    chunks: parents,
    cases: REAL_CASES.map((c) => ({ query: c.query, isHit: (chunk) => chunk.text.includes(c.expectText) })),
  };
}

type Provider = { name: string; embed: (texts: readonly string[]) => Promise<number[][]> };

async function evalProvider(p: Provider, corpus: Corpus) {
  const inputs = corpus.chunks.map((c) => `${c.sectionPath}\n${c.text}`);
  const t0 = Date.now();
  const chunkVecs = await p.embed(inputs);
  const embedMs = Date.now() - t0;
  const queryVecs = await p.embed(corpus.cases.map((c) => c.query));

  let r1 = 0, r4 = 0, mrr = 0;
  const misses: string[] = [];
  for (let qi = 0; qi < corpus.cases.length; qi++) {
    const ranked = chunkVecs
      .map((v, i) => ({ i, s: cosine(queryVecs[qi], v) }))
      .sort((a, b) => b.s - a.s);
    const rank = ranked.findIndex((r) => corpus.cases[qi].isHit(corpus.chunks[r.i])) + 1;
    if (rank === 1) r1++;
    if (rank >= 1 && rank <= 4) r4++;
    if (rank >= 1) mrr += 1 / rank;
    if (rank < 1 || rank > 4) misses.push(`${corpus.cases[qi].query} (rank=${rank || 'none'})`);
  }
  const n = corpus.cases.length;
  return { r1: r1 / n, r4: r4 / n, mrr: mrr / n, embedMs, chunks: corpus.chunks.length, misses };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

async function main() {
  const providers: Provider[] = [
    { name: 'zhipu-1024', embed: (t) => embedZhipu(t) },
    { name: 'doubao-v-2048', embed: (t) => embedDoubao(t) },
    { name: 'doubao-v-1024', embed: (t) => embedDoubao(t, 4, 1024) },
  ];
  for (const corpus of [buildSynthetic(), buildReal()]) {
    console.log(`\n=== ${corpus.name} — ${corpus.chunks.length} chunks ===`);
    console.log(`${'provider'.padEnd(15)} ${'R@1'.padStart(4)} ${'R@4'.padStart(4)}   MRR    embed`);
    for (const p of providers) {
      const m = await evalProvider(p, corpus);
      console.log(
        `${p.name.padEnd(15)} ${pct(m.r1)} ${pct(m.r4)}  ${m.mrr.toFixed(3)}  ${(m.embedMs / 1000).toFixed(1)}s/${m.chunks}ch`,
      );
      for (const miss of m.misses) console.log(`    ✗ ${miss}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ A/B failed:', err);
  process.exit(1);
});
