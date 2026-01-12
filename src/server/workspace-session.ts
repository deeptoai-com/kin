import { and, eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { agentSession } from '~/db/schema';

export async function getWorkspaceSession(userId: string, sessionId: string) {
  const [byId] = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.userId, userId)));

  if (byId) {
    return byId;
  }

  const [bySdk] = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.sdkSessionId, sessionId), eq(agentSession.userId, userId)));

  return bySdk ?? null;
}
