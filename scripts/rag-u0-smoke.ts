/**
 * RAG U0 smoke — full-coverage embedding + single-chunk small docs (ingest-UX spec D5/D6),
 * against a real DB + real Zhipu.
 *
 *   DATABASE_URL=... ZHIPU_API_KEY=... npx tsx scripts/rag-u0-smoke.ts
 *
 * Asserts:
 *  1. a SMALL doc (well under the rag-tier threshold — would NOT have embedded under R1)
 *     ingests as exactly ONE chunk (ragTier='single', parentChunkId=null) and kb_search
 *     returns its WHOLE text — i.e. small KB docs are now searchable (the D5 fix).
 *  2. a LARGE doc ingests as 'structured' (many chunks, parent links present).
 * Cleans up.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents, documentChunks } from '~/db/schema/document.schema';
import { ingestDocument } from '~/server/rag/ingest';
import { searchKb } from '~/server/rag/search';
import { estimateTokens, SINGLE_CHUNK_MAX_TOKENS } from '~/server/rag/tier';

const USER = 'rag-u0-user';

async function makeDoc(title: string, content: string) {
  const [f] = await db
    .insert(files)
    .values({ key: `rag-u0/${title}-${Date.now()}`, clientId: USER, fileType: 'text/markdown', name: `${title}.md`, size: 0, url: '' })
    .returning();
  const [d] = await db
    .insert(documents)
    .values({ title, content, sourceType: 'rag-u0', userId: USER, fileId: f.id, ingestStatus: 'pending', parseStatus: 'ready' })
    .returning();
  const r = await ingestDocument(d.id);
  if (r.status !== 'ready') throw new Error(`ingest ${title} failed: ${r.reason}`);
  return { docId: d.id, fileId: f.id, chunks: r.chunks ?? 0 };
}

async function main() {
  // SMALL: a few hundred tokens — under R1 this routed to 'inline' and was NEVER embedded.
  const smallContent = '# 门禁政策\n\n访客须在前台登记并领取临时门禁卡，临时卡有效期为当日，离场时归还。紫罗兰会议室需提前一天预约。';
  const smallTokens = estimateTokens(smallContent);
  // LARGE: comfortably over the rag-tier threshold.
  const big = (t: string, n: number) => Array.from({ length: n }, (_, i) => `${t}相关说明第${i}条：流程性描述，用于撑大体积。`).join('\n\n');
  const largeContent = ['# 第一章 总则', big('总则', 140), '# 第二章 安保', '夜间巡逻每两小时一次，监控录像保留九十天。', big('安保', 140)].join('\n\n');
  const largeTokens = estimateTokens(largeContent);

  // U0: no 20k rag-tier gate anymore — anything over the single-chunk bound chunks structured.
  console.log(`[smoke] small≈${smallTokens}tok (≤${SINGLE_CHUNK_MAX_TOKENS}=single), large≈${largeTokens}tok (>${SINGLE_CHUNK_MAX_TOKENS}=structured)`);
  if (smallTokens > SINGLE_CHUNK_MAX_TOKENS) throw new Error('small fixture too big');
  if (largeTokens <= SINGLE_CHUNK_MAX_TOKENS) throw new Error('large fixture too small');

  const made: Array<{ docId: string; fileId: string }> = [];
  try {
    // ── 1. small doc → single chunk, fully searchable ──────────────────────────
    const small = await makeDoc('门禁政策手册', smallContent);
    made.push(small);
    if (small.chunks !== 1) throw new Error(`small doc should be 1 chunk, got ${small.chunks}`);
    const [smallDoc] = await db.select({ ragTier: documents.ragTier }).from(documents).where(eq(documents.id, small.docId));
    if (smallDoc.ragTier !== 'single') throw new Error(`small doc ragTier should be 'single', got ${smallDoc.ragTier}`);
    const onlyChunk = await db.select().from(documentChunks).where(eq(documentChunks.documentId, small.docId));
    if (onlyChunk.length !== 1 || onlyChunk[0].parentChunkId !== null) throw new Error('small doc must be 1 parentless chunk');

    const hits = await searchKb(USER, { query: '临时门禁卡有效期多久', k: 3, trace: false });
    const hit = hits.find((h) => h.documentTitle === '门禁政策手册');
    if (!hit) throw new Error('LEAK/GAP: small KB doc not retrievable by kb_search (the D5 bug)');
    if (!hit.text.includes('有效期为当日')) throw new Error('single-chunk hit should return WHOLE text');
    console.log('[smoke] ✓ small doc: 1 chunk, ragTier=single, kb_search returns whole text');

    // ── 2. large doc → structured ──────────────────────────────────────────────
    const large = await makeDoc('安保管理规范', largeContent);
    made.push(large);
    if (large.chunks < 3) throw new Error(`large doc should be many chunks, got ${large.chunks}`);
    const [largeDoc] = await db.select({ ragTier: documents.ragTier }).from(documents).where(eq(documents.id, large.docId));
    if (largeDoc.ragTier !== 'structured') throw new Error(`large doc ragTier should be 'structured', got ${largeDoc.ragTier}`);
    const children = await db.select({ id: documentChunks.id }).from(documentChunks)
      .where(and(eq(documentChunks.documentId, large.docId), isNull(documentChunks.parentChunkId)));
    if (children.length === large.chunks) throw new Error('large doc should have parent+child structure');
    console.log(`[smoke] ✓ large doc: ${large.chunks} chunks, ragTier=structured, parent/child present`);

    console.log('✅ U0 smoke PASS — full-coverage embedding + single-chunk small docs verified');
  } finally {
    for (const m of made) {
      await db.delete(documents).where(eq(documents.id, m.docId));
      await db.delete(files).where(eq(files.id, m.fileId));
    }
    console.log('[smoke] cleaned up');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ U0 smoke FAIL:', err);
  process.exit(1);
});
