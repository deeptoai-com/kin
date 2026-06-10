import { eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { agentSession } from '~/db/schema';
import { canAccessSession } from '~/server/projects/access';

/**
 * Resolve a session (by internal id or sdkSessionId) the user may SEE — their own loose
 * session, or any session in a Project they belong to. Backs the workspace file/artifact
 * routes, so project members can view a shared session's files. Returns null if not
 * found or not visible (callers respond 404). Load-then-authorize; no raw `WHERE user_id`.
 */
export async function getWorkspaceSession(userId: string, sessionId: string) {
  const [byId] = await db.select().from(agentSession).where(eq(agentSession.id, sessionId));
  const session =
    byId ??
    (await db.select().from(agentSession).where(eq(agentSession.sdkSessionId, sessionId)))[0] ??
    null;

  if (!session) return null;
  return (await canAccessSession(userId, session)) ? session : null;
}
