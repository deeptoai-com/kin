/**
 * BullMQ processor: full backfill of the conversation-search index (FR3).
 *
 * Walks every agent_session row, locates its JSONL transcript, projects user/assistant text
 * into the Meili `messages` index. Idempotent (upsert by message uuid) so re-running is safe.
 * Run on demand or once on boot via MESSAGE_REINDEX_ON_BOOT. Mirrors reindexDocuments.ts.
 *
 * NOTE: doc.sessionId = sdkSessionId (the deep-link route id, /agents/c/$sessionId), while the
 * JSONL filename is realSdkSessionId — verified against claude-chat-controller.tsx:194.
 */

import { readFile } from 'node:fs/promises';
import { db } from '~/db/client';
import { agentSession } from '~/db/schema';
import { ensureIndexes, indexMessages } from '~/search/meilisearch';
import { extractIndexableMessages } from '~/server/sessions/jsonl';
import { locateSessionFile } from '~/server/sessions/locate';
import { logger } from '~/lib/logger';

export async function reindexMessages(): Promise<{ sessions: number; indexed: number; skipped: number }> {
  await ensureIndexes();

  const rows = await db
    .select({
      userId: agentSession.userId,
      projectId: agentSession.projectId,
      sdkSessionId: agentSession.sdkSessionId,
      realSdkSessionId: agentSession.realSdkSessionId,
      claudeHomePath: agentSession.claudeHomePath,
      title: agentSession.title,
    })
    .from(agentSession);

  let indexed = 0;
  let skipped = 0;

  for (const row of rows) {
    const fileId = row.realSdkSessionId ?? row.sdkSessionId;
    const file = await locateSessionFile(row.claudeHomePath, fileId);
    if (!file) {
      skipped++;
      continue;
    }
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      skipped++;
      continue;
    }
    const msgs = extractIndexableMessages(text, {
      sessionId: row.sdkSessionId,
      userId: row.userId,
      projectId: row.projectId,
      title: row.title ?? '',
    });
    if (msgs.length > 0) {
      await indexMessages(msgs);
      indexed += msgs.length;
    }
  }

  logger.info('[reindex-messages] done', { sessions: rows.length, indexed, skipped });
  return { sessions: rows.length, indexed, skipped };
}
