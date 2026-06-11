/**
 * RAG U1 smoke — parser sidecar end to end with the REAL 716-page MiniMax prospectus
 * (ingest-UX spec §7/§4 Exit): spawn the sidecar → probe (engine recommendation) →
 * structured parse → ingest a real subset → kb_search hits a real financial needle.
 *
 *   DATABASE_URL=... ANTHROPIC_AUTH_TOKEN=<ark> JAVA_HOME=<jdk> npx tsx scripts/rag-u1-smoke.ts
 *
 * Notes: ingests a ~120k-char financial/business window (not all 716 pages) to keep the
 * smoke under ~2min of embedding; the S3-fetch branch of the parse pre-stage is not
 * exercised here (no MinIO bridge on host) — covered in compose. Cleans up after itself.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { files } from '~/db/schema/file.schema';
import { documents } from '~/db/schema/document.schema';
import { ingestDocument } from '~/server/rag/ingest';
import { searchKb } from '~/server/rag/search';
import { parsePdfViaSidecar, probePdfViaSidecar, stripPageMarkers } from '~/server/rag/parser-client';

const PDF = '/Users/peng/Dev/Projects/active/ClaudeAgentChat/rag-test-docs/minimax.pdf';

async function waitHealthy(url: string, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('sidecar did not become healthy');
}

async function main() {
  process.env.PARSER_SIDECAR_URL = 'http://127.0.0.1:7800';
  const sidecar = spawn('node', ['parser-sidecar/server.mjs'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk', PATH: `${process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk'}/bin:${process.env.PATH}` },
  });
  try {
    await waitHealthy('http://127.0.0.1:7800');
    console.log('[smoke] sidecar healthy');

    const bytes = readFileSync(PDF);

    // ① probe → engine recommendation (text-layer PDF must NOT recommend ocr)
    const probe = await probePdfViaSidecar(bytes);
    if (!probe.ok || !probe.recommend) throw new Error(`probe failed: ${probe.error}`);
    console.log(`[smoke] probe: ${probe.pages}p ${probe.chars}chars → recommend=${probe.recommend.method} (${probe.recommend.reason})`);
    if (probe.recommend.method === 'ocr') throw new Error('text-layer PDF misclassified as scanned');

    // ② structured parse of the full prospectus
    const parsed = await parsePdfViaSidecar(bytes, 'structured');
    if (!parsed.ok || !parsed.markdown) throw new Error(`parse failed: ${parsed.error}`);
    const md = stripPageMarkers(parsed.markdown);
    const headings = (md.match(/^#{1,6} /gm) || []).length;
    console.log(`[smoke] structured parse: ${parsed.pages}p, ${Math.round(md.length / 1024)}KB md, ${headings} headings, ${(parsed.ms / 1000).toFixed(1)}s`);
    if (parsed.pages < 700 || md.length < 500_000 || headings < 300) throw new Error('parse output below expectations');

    // ③ ingest a real subset (financial + business windows) and retrieve a real needle
    const windows = ['19.1百萬', '343.3'].map((a) => {
      const i = md.indexOf(a);
      if (i < 0) throw new Error(`anchor missing in parsed md: ${a}`);
      return md.slice(Math.max(0, i - 60_000), i + 60_000);
    });
    const [file] = await db.insert(files).values({ key: `rag-u1/${Date.now()}`, clientId: 'rag-smoke', fileType: 'text/markdown', name: 'minimax-subset.md', size: 0, url: '' }).returning();
    const [doc] = await db.insert(documents).values({
      title: 'MiniMax招股书(U1冒烟子集)', content: windows.join('\n\n'), sourceType: 'rag-smoke',
      userId: 'rag-u1-user', fileId: file.id, parseMethod: 'structured', parseStatus: 'ready', ingestStatus: 'pending',
    }).returning();
    try {
      const r = await ingestDocument(doc.id);
      if (r.status !== 'ready') throw new Error(`ingest: ${r.status} ${r.reason}`);
      console.log(`[smoke] ingested subset: ${r.chunks} chunks`);
      // Pipeline smoke, not a quality eval (that's golden-set v2): vector-only here
      // (no Meili on host, rerank off), so assert a high-signal needle lands in top-8.
      const hits = await searchKb('rag-u1-user', { query: '付费用户数量达到多少', k: 8, trace: false });
      console.log('[smoke] top hit:', hits[0]?.sectionPath, '|', hits[0]?.text.slice(0, 60));
      if (!hits.some((h) => h.text.includes('650,300') || h.text.includes('19.1百萬'))) {
        throw new Error('real needle not retrieved in top-8 (650,300 / 19.1百萬)');
      }
      console.log('✅ U1 smoke PASS — sidecar probe/parse + real-corpus ingest + retrieval verified');
    } finally {
      await db.delete(documents).where(eq(documents.id, doc.id));
      await db.delete(files).where(eq(files.id, file.id));
      console.log('[smoke] cleaned up');
    }
  } finally {
    sidecar.kill('SIGTERM');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ U1 smoke FAIL:', err);
  process.exit(1);
});
