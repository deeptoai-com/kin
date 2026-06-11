/**
 * RAG golden-set eval (R4-①) — the falsification harness: every retrieval change
 * (chunk size, K, embedding model, rerank on/off) gets judged here, not by feel.
 *
 *   DATABASE_URL=... ZHIPU_API_KEY=... [MEILI_HOST=... MEILI_API_KEY=...] \
 *     npx tsx scripts/rag-eval.ts
 *
 * Ingests the golden docs under a throwaway eval user, runs every golden case in
 * three ablation modes, prints Recall@1/@4 + MRR per mode and per question type,
 * then cleans up. Traces are disabled for eval runs.
 *
 *   vector   — embedding ANN only          (skipBm25 + skipRerank)
 *   hybrid   — vector ∥ BM25 → RRF         (skipRerank)
 *   +rerank  — full pipeline               (production config)
 *
 * NOTE on BM25: if Meili is unreachable (host-local runs without a bridge), the
 * hybrid/+rerank modes silently equal vector mode — the script detects and labels this.
 */
import { eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents } from '~/db/schema/document.schema';
import { ingestDocument } from '~/server/rag/ingest';
import { searchKb, type KbSearchParams } from '~/server/rag/search';
import { GOLDEN_DOCS, GOLDEN_CASES } from '../tests/golden/rag-golden-set';

const EVAL_USER = 'rag-eval-user';

type Mode = 'vector' | 'hybrid' | '+rerank';
const MODES: Record<Mode, Partial<KbSearchParams>> = {
  vector: { skipBm25: true, skipRerank: true },
  hybrid: { skipRerank: true },
  // explicit: production default is rerank-OFF (golden-set evidence), so force it here
  '+rerank': { skipRerank: false },
};

interface CaseResult {
  type: string;
  rank: number | null; // 1-based rank of the first correct hit, null = miss
}

function metrics(results: CaseResult[]) {
  const n = results.length;
  const r1 = results.filter((r) => r.rank === 1).length / n;
  const r4 = results.filter((r) => r.rank != null && r.rank <= 4).length / n;
  const mrr = results.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n;
  return { r1, r4, mrr };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

async function main() {
  // ── Setup: ingest golden docs (personal docs of the eval user) ─────────────
  const created: Array<{ docId: string; fileId: string }> = [];
  console.log(`[eval] ingesting ${GOLDEN_DOCS.length} golden docs …`);
  for (const g of GOLDEN_DOCS) {
    const [f] = await db
      .insert(files)
      .values({ key: `rag-eval/${g.title}-${Date.now()}`, clientId: EVAL_USER, fileType: 'text/markdown', name: `${g.title}.md`, size: 0, url: '' })
      .returning();
    const [d] = await db
      .insert(documents)
      .values({ title: g.title, content: g.markdown, sourceType: 'rag-eval', userId: EVAL_USER, fileId: f.id, ragTier: 'rag', ingestStatus: 'pending' })
      .returning();
    const r = await ingestDocument(d.id);
    if (r.status !== 'ready') throw new Error(`ingest ${g.title} failed: ${r.reason}`);
    created.push({ docId: d.id, fileId: f.id });
    console.log(`[eval]   ${g.title}: ${r.chunks} chunks`);
  }

  try {
    // BM25 availability probe (labels the report honestly when Meili is absent)
    let bm25Available = true;
    try {
      const { meili } = await import('~/search/meilisearch');
      await meili.health();
    } catch {
      bm25Available = false;
    }

    const byMode = new Map<Mode, CaseResult[]>();
    for (const mode of Object.keys(MODES) as Mode[]) {
      const results: CaseResult[] = [];
      for (const c of GOLDEN_CASES) {
        const hits = await searchKb(EVAL_USER, {
          query: c.query,
          k: 8,
          ...MODES[mode],
          trace: false,
        });
        const idx = hits.findIndex(
          (h) => h.documentTitle === c.doc && (h.sectionPath ?? '').includes(c.expectSection),
        );
        results.push({ type: c.type, rank: idx >= 0 ? idx + 1 : null });
      }
      byMode.set(mode, results);
    }

    // ── Report ──────────────────────────────────────────────────────────────
    console.log(`\n=== RAG golden-set eval — ${GOLDEN_CASES.length} cases, k=8 ===`);
    if (!bm25Available) console.log('⚠️  Meili unreachable: hybrid/+rerank degenerate to vector-only on this run');
    console.log(`${'mode'.padEnd(9)} ${'R@1'.padStart(4)} ${'R@4'.padStart(4)}   MRR`);
    for (const [mode, results] of byMode) {
      const m = metrics(results);
      console.log(`${mode.padEnd(9)} ${pct(m.r1)} ${pct(m.r4)}  ${m.mrr.toFixed(3)}`);
    }
    for (const t of ['keyword', 'paraphrase', 'entity']) {
      const line = [...byMode.entries()]
        .map(([mode, results]) => {
          const sub = results.filter((r) => r.type === t);
          return `${mode}=${pct(metrics(sub).r1)}/${pct(metrics(sub).r4)}`;
        })
        .join('  ');
      console.log(`  ${t.padEnd(10)} (R@1/R@4)  ${line}`);
    }

    // Per-case misses of the production mode, for actionable debugging
    const prod = byMode.get('+rerank')!;
    const misses = GOLDEN_CASES.filter((_, i) => prod[i].rank == null || prod[i].rank! > 4);
    if (misses.length) {
      console.log('\nproduction-mode misses (rank>4 or none):');
      for (const m of misses) console.log(`  ✗ [${m.type}] ${m.query} → ${m.expectSection}`);
    } else {
      console.log('\n✅ no production-mode misses at R@4');
    }
  } finally {
    for (const c of created) {
      await db.delete(documents).where(eq(documents.id, c.docId));
      await db.delete(files).where(eq(files.id, c.fileId));
    }
    console.log('[eval] cleaned up golden docs');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ eval failed:', err);
  process.exit(1);
});
