/**
 * RAG R1 smoke — the WHOLE ingest pipeline against a real DB + real Zhipu (final spec R1
 * Exit: "一个大文档能 ingest 到 ready 并可被向量近邻查到；小文档不入队").
 *
 *   DATABASE_URL=... ZHIPU_API_KEY=... npx tsx scripts/rag-r1-smoke.ts
 *
 * Builds a synthetic 'rag'-tier markdown (≥ threshold), runs ingestDocument() inline,
 * asserts: status=ready, parents+children with parentChunkId linkage, toc written,
 * cosine ANN finds the right section, and a small doc routes to 'inline' (no chunks).
 * Cleans up everything it created.
 */
import { eq, cosineDistance, isNotNull, and } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents, documentChunks } from '~/db/schema/document.schema';
import { embedTexts } from '~/server/rag/embedding';
import { ingestDocument } from '~/server/rag/ingest';
import { estimateTokens, routeTier } from '~/server/rag/tier';

function syntheticDoc(): string {
  const filler = (topic: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${topic}相关的说明第${i}条：这里是用于撑大文档体积的常规业务描述内容，与检索目标无关。`).join('\n\n');
  return [
    '# 第一章 总则',
    filler('总则', 140),
    '# 第二章 费用与退款',
    '本合同约定的退款费率为百分之四点五，自签约日起七日内可无理由退款。',
    filler('费用', 140),
    '# 第三章 保修条款',
    '本产品提供自购买之日起整整两年的免费保修服务，覆盖所有非人为损坏。',
    filler('保修', 140),
    '# 第四章 交付',
    filler('交付', 140),
  ].join('\n\n');
}

async function main() {
  const md = syntheticDoc();
  const tokens = estimateTokens(md);
  const tier = routeTier(tokens);
  console.log(`[smoke] synthetic doc ≈${tokens} tokens → tier=${tier}`);
  if (tier !== 'rag') throw new Error(`expected rag tier, got ${tier} — enlarge the synthetic doc`);
  if (routeTier(estimateTokens('小文档内容')) !== 'inline') throw new Error('small doc must route inline');

  const [file] = await db
    .insert(files)
    .values({ key: `rag-smoke-r1/${Date.now()}`, clientId: 'rag-smoke', fileType: 'text/markdown', name: 'r1.md', size: 0, url: '' })
    .returning();
  const [doc] = await db
    .insert(documents)
    .values({
      title: 'R1 冒烟大文档',
      content: md,
      sourceType: 'rag-smoke',
      userId: 'rag-smoke-user',
      fileId: file.id,
      tokenEstimate: tokens,
      ragTier: tier,
      ingestStatus: 'pending',
    })
    .returning();

  try {
    const result = await ingestDocument(doc.id);
    console.log('[smoke] ingest result:', JSON.stringify(result));
    if (result.status !== 'ready') throw new Error(`ingest status ${result.status}: ${result.reason}`);

    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    if (after.ingestStatus !== 'ready' || after.ingestProgress !== 100) throw new Error('doc not marked ready/100');
    if (!Array.isArray(after.toc) || (after.toc as unknown[]).length < 4) throw new Error('toc missing');

    const children = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(and(eq(documentChunks.documentId, doc.id), isNotNull(documentChunks.parentChunkId)));
    if (children.length === 0) throw new Error('no child chunks with parent linkage');

    const [qv] = await embedTexts(['保修期是多久？']);
    const distance = cosineDistance(documentChunks.embedding, qv);
    const hits = await db
      .select({ section: documentChunks.sectionPath, distance })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, doc.id))
      .orderBy(distance)
      .limit(3);
    console.log('[smoke] ANN top sections:', hits.map((h) => h.section).join(' | '));
    if (!hits[0]?.section?.includes('保修')) throw new Error(`top hit should be 保修 section, got ${hits[0]?.section}`);

    // Idempotency: a second run with unchanged content must hash-skip (no re-embed).
    const second = await ingestDocument(doc.id);
    console.log('[smoke] second run:', JSON.stringify(second));
    if (second.status !== 'skipped') throw new Error(`second run should be skipped, got ${second.status}`);

    console.log('✅ R1 smoke PASS — tier routing, full ingest, ANN retrieval, hash-skip all verified');
  } finally {
    await db.delete(documents).where(eq(documents.id, doc.id));
    await db.delete(files).where(eq(files.id, file.id));
    console.log('[smoke] cleaned up temp rows');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ R1 smoke FAIL:', err);
  process.exit(1);
});
