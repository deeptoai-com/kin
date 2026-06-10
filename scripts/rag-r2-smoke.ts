/**
 * RAG R2 smoke — kb_search retrieval + THE isolation regression (final spec R2 Exit:
 * "非成员检索不到他人项目文档"), against a real DB + real Zhipu.
 *
 *   DATABASE_URL=... ZHIPU_API_KEY=... npx tsx scripts/rag-r2-smoke.ts
 *
 * Fixtures (cleaned up at the end): users = the two seeded test accounts; a project
 * owned by USER_A with USER_A as its only member; three small docs force-ingested:
 *   docPersonalA (personal, A) / docProject (in project) / docPersonalB (personal, B).
 * Asserts: A retrieves from docPersonalA + docProject but never docPersonalB;
 * B retrieves ONLY from docPersonalB — neither A's personal doc nor the project doc.
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { user } from '~/db/schema/auth.schema';
import { files } from '~/db/schema/file.schema';
import { documents } from '~/db/schema/document.schema';
import { project, projectMember } from '~/db/schema/project.schema';
import { ingestDocument } from '~/server/rag/ingest';
import { searchKb } from '~/server/rag/search';

async function makeDoc(title: string, marker: string, userId: string, projectId: string | null) {
  const [file] = await db
    .insert(files)
    .values({ key: `rag-smoke-r2/${title}-${Date.now()}`, clientId: userId, fileType: 'text/markdown', name: `${title}.md`, size: 0, url: '' })
    .returning();
  const [doc] = await db
    .insert(documents)
    .values({
      title,
      content: `# ${title}\n\n${marker}是本文档的核心机密内容，编号${title}。\n\n其余为常规说明文字。`,
      sourceType: 'rag-smoke',
      userId,
      projectId,
      fileId: file.id,
      ragTier: 'rag',
      ingestStatus: 'pending',
    })
    .returning();
  const r = await ingestDocument(doc.id);
  if (r.status !== 'ready') throw new Error(`ingest ${title} failed: ${r.reason}`);
  return { doc, file };
}

async function main() {
  const testUsers = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.email, ['alice@oxy.local', 'bob@oxy.local']));
  const userA = testUsers.find((u) => u.email === 'alice@oxy.local');
  const userB = testUsers.find((u) => u.email === 'bob@oxy.local');
  if (!userA || !userB) throw new Error('seeded test users alice/bob@oxy.local not found');

  const [proj] = await db
    .insert(project)
    .values({ ownerUserId: userA.id, name: 'RAG-R2-冒烟项目' })
    .returning();
  await db.insert(projectMember).values({ projectId: proj.id, userId: userA.id, role: 'owner' });

  const made: Array<{ doc: { id: string }; file: { id: string } }> = [];
  try {
    made.push(await makeDoc('个人A文档', '蓝色凤凰', userA.id, null));
    made.push(await makeDoc('项目共享文档', '银色山脉', userA.id, proj.id));
    made.push(await makeDoc('个人B文档', '红色峡谷', userB.id, null));
    console.log('[smoke] 3 docs ingested');

    // A sees own personal + project doc
    const aProject = await searchKb(userA.id, { query: '银色山脉的机密内容', k: 5 });
    if (!aProject.some((h) => h.documentTitle === '项目共享文档')) throw new Error('A should retrieve the project doc');
    const aOwn = await searchKb(userA.id, { query: '蓝色凤凰的机密内容', k: 5 });
    if (!aOwn.some((h) => h.documentTitle === '个人A文档')) throw new Error('A should retrieve own personal doc');
    // A must NOT see B's personal doc even when querying its exact marker
    const aLeak = await searchKb(userA.id, { query: '红色峡谷的机密内容', k: 5 });
    if (aLeak.some((h) => h.documentTitle === '个人B文档')) throw new Error('LEAK: A retrieved B\'s personal doc');

    // B (NOT a project member) must see neither the project doc nor A's personal doc
    const bProj = await searchKb(userB.id, { query: '银色山脉的机密内容', k: 5 });
    if (bProj.some((h) => h.documentTitle === '项目共享文档')) throw new Error('LEAK: non-member B retrieved the project doc');
    const bPersonalA = await searchKb(userB.id, { query: '蓝色凤凰的机密内容', k: 5 });
    if (bPersonalA.some((h) => h.documentTitle === '个人A文档')) throw new Error('LEAK: B retrieved A\'s personal doc');
    const bOwn = await searchKb(userB.id, { query: '红色峡谷的机密内容', k: 5 });
    if (!bOwn.some((h) => h.documentTitle === '个人B文档')) throw new Error('B should retrieve own personal doc');

    console.log('[smoke] sample hit:', JSON.stringify({ ...aProject[0], text: aProject[0]?.text.slice(0, 40) }));
    console.log('✅ R2 smoke PASS — hybrid retrieval works and isolation holds (非成员看不到)');
  } finally {
    for (const m of made) {
      await db.delete(documents).where(eq(documents.id, m.doc.id));
      await db.delete(files).where(eq(files.id, m.file.id));
    }
    await db.delete(project).where(eq(project.id, proj.id)); // member rows cascade
    console.log('[smoke] cleaned up fixtures');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ R2 smoke FAIL:', err);
  process.exit(1);
});
