/**
 * BullMQ processor: incrementally (re)index a single session's messages (FR2).
 *
 * Enqueued by ws-server at turn completion ({userId, sdkSessionId}). Looks up the session row
 * (authoritative claudeHomePath/projectId/title — never trust the payload for those), reads its
 * JSONL, and upserts its messages into Meili. Idempotent: re-indexing the whole transcript by
 * message uuid is cheap and safe (newer turns just add/refresh docs).
 */

import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db } from '~/db/client';
import { agentSession } from '~/db/schema';
import { indexMessages } from '~/search/meilisearch';
import { extractIndexableMessages } from '~/server/sessions/jsonl';
import { locateSessionFile } from '~/server/sessions/locate';
import { logger } from '~/lib/logger';

export async function indexSessionMessages(payload: {
  userId?: string;
  sdkSessionId?: string;
}): Promise<{ indexed: number }> {
  const userId = payload?.userId;
  const sdkSessionId = payload?.sdkSessionId;
  if (!userId || !sdkSessionId) {
    logger.warn('[index-session-messages] missing userId/sdkSessionId', { payload });
    return { indexed: 0 };
  }

  const [row] = await db
    .select({
      userId: agentSession.userId,
      projectId: agentSession.projectId,
      sdkSessionId: agentSession.sdkSessionId,
      realSdkSessionId: agentSession.realSdkSessionId,
      claudeHomePath: agentSession.claudeHomePath,
      title: agentSession.title,
    })
    .from(agentSession)
    .where(and(eq(agentSession.userId, userId), eq(agentSession.sdkSessionId, sdkSessionId)));

  if (!row) {
    logger.warn('[index-session-messages] session not found', { userId, sdkSessionId });
    return { indexed: 0 };
  }

  const fileId = row.realSdkSessionId ?? row.sdkSessionId;
  const file = await locateSessionFile(row.claudeHomePath, fileId);
  if (!file) return { indexed: 0 };

  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { indexed: 0 };
  }

  const msgs = extractIndexableMessages(text, {
    sessionId: row.sdkSessionId,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title ?? '',
  });
  if (msgs.length > 0) await indexMessages(msgs);

  logger.info('[index-session-messages] indexed', { sdkSessionId, count: msgs.length });
  return { indexed: msgs.length };
}
