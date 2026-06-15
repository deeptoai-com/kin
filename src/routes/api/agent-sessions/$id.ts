/**
 * Agent Session Detail API
 *
 * GET    /api/agent-sessions/:id - Get session details (visible to owner + project members)
 * PATCH  /api/agent-sessions/:id - Update session (title, favorite) — originator only
 * DELETE /api/agent-sessions/:id - Delete session — originator only
 *
 * Access goes through the resolver (canAccessSession / canMutateSession): load the row
 * by id, THEN authorize. Never re-add a raw `WHERE user_id` — that hides shared sessions.
 */

import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { db } from '~/db/db-config';
import { agentSession } from '~/db/schema';
import { user as userTable } from '~/db/schema/auth.schema';
import { requireUser } from '~/server/require-user';
import { canAccessSession, canMutateSession } from '~/server/projects/access';
import { removeMessagesOfSession } from '~/search/meilisearch';
import { rm } from 'fs/promises';
import { join } from 'path';

const notFound = () =>
  new Response(JSON.stringify({ error: 'Session not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

export const Route = createFileRoute('/api/agent-sessions/$id')({
  server: {
    handlers: {
      // GET /api/agent-sessions/:id - Get session details (owner or project member)
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { id } = params;

        const [session] = await db.select().from(agentSession).where(eq(agentSession.id, id));
        if (!session || !(await canAccessSession(user.id, session))) {
          return notFound();
        }

        // Attribution: owner name + avatar so the UI can show who started this conversation.
        const [owner] = await db
          .select({ name: userTable.name, image: userTable.image })
          .from(userTable)
          .where(eq(userTable.id, session.userId));

        return Response.json({ ...session, ownerName: owner?.name ?? null, ownerImage: owner?.image ?? null });
      },

      // PATCH /api/agent-sessions/:id - Update session (originator only)
      PATCH: async ({ request, params }) => {
        const user = await requireUser(request);
        const { id } = params;
        const body = await request.json();

        const [session] = await db.select().from(agentSession).where(eq(agentSession.id, id));
        if (!session || !canMutateSession(user.id, session)) {
          return notFound();
        }

        // Build update object with only provided fields. Note: only update updatedAt for
        // non-title changes (e.g., favorite) — title changes shouldn't bump the timestamp.
        const updateData: Partial<{ title: string; favorite: boolean; updatedAt: Date }> = {};
        if (typeof body.title === 'string') {
          updateData.title = body.title;
        }
        if (typeof body.favorite === 'boolean') {
          updateData.favorite = body.favorite;
          updateData.updatedAt = new Date();
        }

        const [updated] = await db
          .update(agentSession)
          .set(updateData)
          .where(eq(agentSession.id, id))
          .returning();

        return Response.json(updated);
      },

      // DELETE /api/agent-sessions/:id - Delete session (originator only)
      DELETE: async ({ request, params }) => {
        const user = await requireUser(request);
        const { id } = params;

        const [session] = await db.select().from(agentSession).where(eq(agentSession.id, id));
        if (!session || !canMutateSession(user.id, session)) {
          return notFound();
        }

        // Delete the DB record
        await db.delete(agentSession).where(eq(agentSession.id, id));

        // Purge this session's messages from the conversation-search index (FR8).
        // doc.sessionId = sdkSessionId; removeMessagesOfSession swallows its own errors.
        await removeMessagesOfSession(session.sdkSessionId);

        // Clean up workspace and JSONL files (best-effort; DB record is already gone)
        try {
          const sessionPath = join(session.claudeHomePath, 'sessions', session.sdkSessionId);
          await rm(sessionPath, { recursive: true, force: true });
          console.log('[Session Delete] Successfully cleaned up workspace:', sessionPath);
        } catch (error) {
          console.error('[Session Delete] Failed to cleanup workspace files:', error);
        }

        return Response.json({ success: true, deleted: session });
      },
    },
  },
});
