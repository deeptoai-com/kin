/**
 * RAG golden-set eval v2 — REAL corpus: the FULL 716-page MiniMax prospectus through the
 * production pipeline (ingest → pgvector+Meili → searchKb), 3 ablation modes.
 *
 *   DATABASE_URL=... ANTHROPIC_AUTH_TOKEN=<ark> [MEILI_HOST/MEILI_API_KEY] \
 *     npx tsx scripts/rag-eval-v2.ts [--cleanup]
 *
 * The golden document PERSISTS between runs (sourceType 'rag-golden'): the first run
 * embeds the whole book (~minutes); later runs hit ingest's hash-skip and only query.
 * --cleanup deletes it. Eval queries run with trace:false.
 */
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents } from '~/db/schema/document.schema';
import { ingestDocument } from '~/server/rag/ingest';
import { searchKb, type KbSearchParams } from '~/server/rag/search';
import { REAL_GOLDEN_CASES, REAL_GOLDEN_DOC_TITLE } from '../tests/golden/rag-golden-set';

const MD_PATH = '/Users/peng/Dev/Projects/active/ClaudeAgentChat/rag-test-docs/minimax.md';
const EVAL_USER = 'rag-golden-user';
const K = 8;

type Mode = 'vector' | 'hybrid' | '+rerank';
const MODES: Record<Mode, Partial<KbSearchParams>> = {
  vector: { skipBm25: true, skipRerank: true },
  hybrid: { skipRerank: true },
  '+rerank': { skipRerank: false },
};

async function ensureGoldenDoc(): Promise<string> {
  const [existing] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.sourceType, 'rag-golden'), eq(documents.title, REAL_GOLDEN_DOC_TITLE)))
    .limit(1);
  if (existing) {
    console.log(`[eval-v2] reusing golden doc ${existing.id} (ingest=${existing.ingestStatus})`);
    if (existing.ingestStatus !== 'ready') {
      const r = await ingestDocument(existing.id);
      if (r.status === 'failed') throw new Error(`re-ingest failed: ${r.reason}`);
    }
    return existing.id;
  }
  const md = readFileSync(MD_PATH, 'utf8').replace(/<!-- page \d+ -->\n?/g, '');
  const [f] = await db
    .insert(files)
    .values({ key: `rag-golden/minimax-${Date.now()}`, clientId: EVAL_USER, fileType: 'text/markdown', name: 'minimax.md', size: 0, url: '' })
    .returning();
  const [d] = await db
    .insert(documents)
    .values({ title: REAL_GOLDEN_DOC_TITLE, content: md, sourceType: 'rag-golden', userId: EVAL_USER, fileId: f.id, parseMethod: 'structured', parseStatus: 'ready', ingestStatus: 'pending' })
    .returning();
  console.log('[eval-v2] embedding the FULL prospectus (first run only — minutes) …');
  const t0 = Date.now();
  const r = await ingestDocument(d.id);
  if (r.status !== 'ready') throw new Error(`ingest failed: ${r.reason}`);
  console.log(`[eval-v2] ingested ${r.chunks} chunks in ${Math.round((Date.now() - t0) / 1000)}s`);
  return d.id;
}

async function cleanup() {
  const rows = await db.select().from(documents).where(eq(documents.sourceType, 'rag-golden'));
  for (const d of rows) {
    await db.delete(documents).where(eq(documents.id, d.id));
    if (d.fileId) await db.delete(files).where(eq(files.id, d.fileId));
  }
  console.log(`[eval-v2] cleaned up ${rows.length} golden doc(s)`);
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

async function main() {
  if (process.argv.includes('--cleanup')) { await cleanup(); process.exit(0); }

  await ensureGoldenDoc();

  let bm25Available = true;
  try { const { meili } = await import('~/search/meilisearch'); await meili.health(); } catch { bm25Available = false; }

  console.log(`\n=== golden v2 — FULL minimax, ${REAL_GOLDEN_CASES.length} cases, k=${K} ===`);
  if (!bm25Available) console.log('⚠️  Meili unreachable: hybrid/+rerank degenerate to vector-only');
  console.log(`${'mode'.padEnd(9)} ${'R@1'.padStart(4)} ${'R@4'.padStart(4)} ${'R@8'.padStart(4)}   MRR`);

  for (const mode of Object.keys(MODES) as Mode[]) {
    let r1 = 0, r4 = 0, r8 = 0, mrr = 0;
    const misses: string[] = [];
    // v2.1: per-type breakdown — the lexical-anchor cases (keyword/entity/clause) exist
    // to judge the BM25 leg / rerank on THEIR home turf instead of a paraphrase-only set.
    const byType = new Map<string, { n: number; r1: number; r4: number; mrr: number }>();
    for (const c of REAL_GOLDEN_CASES) {
      const hits = await searchKb(EVAL_USER, { query: c.query, k: K, ...MODES[mode], trace: false });
      const rank = hits.findIndex((h) => h.text.includes(c.expectText)) + 1;
      if (rank === 1) r1++;
      if (rank >= 1 && rank <= 4) r4++;
      if (rank >= 1) { r8++; mrr += 1 / rank; }
      if (rank < 1 || rank > 4) misses.push(`[${c.type}] ${c.query} (rank=${rank || 'none'})`);
      const t = byType.get(c.type) ?? { n: 0, r1: 0, r4: 0, mrr: 0 };
      t.n++;
      if (rank === 1) t.r1++;
      if (rank >= 1 && rank <= 4) t.r4++;
      if (rank >= 1) t.mrr += 1 / rank;
      byType.set(c.type, t);
    }
    const n = REAL_GOLDEN_CASES.length;
    console.log(`${mode.padEnd(9)} ${pct(r1 / n)} ${pct(r4 / n)} ${pct(r8 / n)}  ${(mrr / n).toFixed(3)}`);
    for (const [type, t] of [...byType.entries()].sort()) {
      console.log(`    ${type.padEnd(10)} n=${String(t.n).padEnd(2)} R@1 ${pct(t.r1 / t.n)} R@4 ${pct(t.r4 / t.n)} MRR ${(t.mrr / t.n).toFixed(3)}`);
    }
    for (const m of misses) console.log(`    ✗ ${m}`);
  }
  console.log('\n(golden doc kept for re-runs — `--cleanup` to remove)');
  process.exit(0);
}

main().catch((err) => { console.error('❌ eval-v2 failed:', err); process.exit(1); });
