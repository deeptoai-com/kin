/**
 * Agent Session Lookup by SDK Session ID
 *
 * GET /api/agent-sessions/by-sdk-id/:sdkId - Get session by sdkSessionId
 *
 * Visible to the owner AND project members (this backs the WS resume path, so a member
 * can OPEN/VIEW a shared project session). Writing a new turn to a non-owned session is
 * blocked at the WS layer (non-owner reply → branch, step C).
 */

import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { agentSession } from '~/db/schema';
import { user as userTable } from '~/db/schema/auth.schema';
import { requireUser } from '~/server/require-user';
import { canAccessSession } from '~/server/projects/access';

export const Route = createFileRoute('/api/agent-sessions/by-sdk-id/$sdkId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sdkId } = params;

        const [session] = await db
          .select()
          .from(agentSession)
          .where(eq(agentSession.sdkSessionId, sdkId));

        if (!session || !(await canAccessSession(user.id, session))) {
          return new Response(JSON.stringify({ error: 'Session not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }

        // Attribution: who owns this session (so the thread/banner can show the
        // initiator's name + avatar, distinguishing A's conversation from B's).
        const [owner] = await db
          .select({ name: userTable.name, image: userTable.image })
          .from(userTable)
          .where(eq(userTable.id, session.userId));

        return Response.json({ ...session, ownerName: owner?.name ?? null, ownerImage: owner?.image ?? null });
      },
    },
  },
});
