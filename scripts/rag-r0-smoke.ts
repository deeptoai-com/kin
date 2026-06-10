/**
 * RAG R0 smoke test — proves the foundation end to end against a REAL database and the
 * REAL Zhipu API (final spec R0 Exit: "能写入一条 1024 维 chunk 并 cosine 近邻查回").
 *
 *   DATABASE_URL=... ZHIPU_API_KEY=... npx tsx scripts/rag-r0-smoke.ts
 *   (locally: source the values from oxygenie/.env.local)
 *
 * Flow: embed 3 sample chunks → insert temp file/document/chunks → embed a query →
 * HNSW cosine search → assert the semantically-right chunk ranks first → cleanup.
 * Everything it creates is deleted at the end (FKs cascade from the document/file).
 */
import { eq, cosineDistance } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents, documentChunks } from '~/db/schema/document.schema';
import { embedTexts, EMBED_DIM, EMBED_MODEL } from '~/server/rag/zhipu';

const SAMPLES = [
  { section: '§3 退款政策', text: '本合同约定退款费率为 4.5%，七日内可无理由退款。' },
  { section: '§5 保修条款', text: '本产品自购买之日起提供两年免费保修服务。' },
  { section: '§8 交付时间', text: '订单确认后十五个工作日内完成交付。' },
];
const QUERY = '保修期有多久？';
const EXPECTED_SECTION = '§5 保修条款';

async function main() {
  console.log(`[smoke] embedding ${SAMPLES.length} chunks via ${EMBED_MODEL}@${EMBED_DIM} …`);
  const vectors = await embedTexts(SAMPLES.map((s) => `RAG冒烟文档 > ${s.section}\n${s.text}`));

  const [file] = await db
    .insert(files)
    .values({
      key: `rag-smoke/${Date.now()}`,
      clientId: 'rag-smoke',
      fileType: 'text/markdown',
      name: 'rag-r0-smoke.md',
      size: 0,
      url: '',
    })
    .returning();

  const [doc] = await db
    .insert(documents)
    .values({
      title: 'RAG R0 smoke 临时文档',
      content: SAMPLES.map((s) => s.text).join('\n'),
      sourceType: 'rag-smoke',
      userId: 'rag-smoke-user',
      fileId: file.id,
      ragTier: 'rag',
      ingestStatus: 'ready',
      embedModel: EMBED_MODEL,
      embedDim: EMBED_DIM,
    })
    .returning();

  try {
    await db.insert(documentChunks).values(
      SAMPLES.map((s, i) => ({
        documentId: doc.id,
        fileId: file.id,
        chunkIndex: i,
        text: s.text,
        embedding: vectors[i],
        sectionPath: s.section,
        contextPrefix: `RAG冒烟文档 > ${s.section}`,
      })),
    );
    console.log(`[smoke] inserted document ${doc.id} + ${SAMPLES.length} chunks`);

    const [queryVec] = await embedTexts([QUERY]);
    const distance = cosineDistance(documentChunks.embedding, queryVec);
    const hits = await db
      .select({ section: documentChunks.sectionPath, text: documentChunks.text, distance })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, doc.id))
      .orderBy(distance)
      .limit(3);

    console.log('[smoke] ANN results for:', QUERY);
    for (const h of hits) console.log(`   ${String(h.distance).slice(0, 6)}  ${h.section}  ${h.text}`);

    if (hits[0]?.section !== EXPECTED_SECTION) {
      throw new Error(`top-1 should be ${EXPECTED_SECTION}, got ${hits[0]?.section}`);
    }
    console.log('✅ R0 smoke PASS — 1024-dim write + cosine ANN retrieval verified');
  } finally {
    await db.delete(documents).where(eq(documents.id, doc.id)); // chunks cascade
    await db.delete(files).where(eq(files.id, file.id));
    console.log('[smoke] cleaned up temp rows');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ R0 smoke FAIL:', err);
  process.exit(1);
});
