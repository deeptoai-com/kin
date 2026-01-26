/**
 * Session Document Management API
 *
 * DELETE /api/workspace/:sessionId/documents/:documentId - Remove document from session
 * POST   /api/workspace/:sessionId/documents/:documentId/sync - Re-sync document
 */

import { createFileRoute } from '@tanstack/react-router';
import { eq, and } from 'drizzle-orm';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { db } from '~/db/db-config';
import { agentSession, sessionDocument, files } from '~/db/schema';
import { requireUser } from '~/server/require-user';
import { S3StaticFileImpl } from '~/server/s3/s3';

const fileService = new S3StaticFileImpl();

export const Route = createFileRoute('/api/workspace/$sessionId/documents/$documentId')({
  server: {
    handlers: {
      // DELETE /api/workspace/:sessionId/documents/:documentId
      DELETE: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId, documentId } = params as {
          sessionId: string;
          documentId: string;
        };

        // Verify session ownership (sessionId is sdk_session_id from frontend)
        const [session] = await db
          .select()
          .from(agentSession)
          .where(and(
            eq(agentSession.sdkSessionId, sessionId),
            eq(agentSession.userId, user.id)
          ));

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Get session document record (use DB ID for sessionId)
        const [sessionDoc] = await db
          .select()
          .from(sessionDocument)
          .where(and(
            eq(sessionDocument.id, documentId),
            eq(sessionDocument.sessionId, session.id)
          ));

        if (!sessionDoc) {
          return new Response(
            JSON.stringify({ error: 'Document not found in session' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Delete from database
        await db
          .delete(sessionDocument)
          .where(eq(sessionDocument.id, documentId));

        // Delete file from workspace
        try {
          const workspaceFilePath = path.join(
            session.claudeHomePath,
            'sessions',
            session.sdkSessionId,
            'workspace',
            sessionDoc.filePath
          );
          await rm(workspaceFilePath, { force: true });
          console.log(`[Session Documents] Removed file from workspace: ${workspaceFilePath}`);
        } catch (error) {
          console.error('[Session Documents] Error removing file from workspace:', error);
          // Don't fail the request if file deletion fails
        }

        return new Response(
          JSON.stringify({
            success: true,
            deletedId: documentId,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      },

      // POST /api/workspace/:sessionId/documents/:documentId/sync
      POST: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId, documentId } = params as {
          sessionId: string;
          documentId: string;
        };

        console.log('[SYNC] Starting sync for document:', documentId);

        // Verify session ownership (sessionId is sdk_session_id from frontend)
        const [session] = await db
          .select()
          .from(agentSession)
          .where(and(
            eq(agentSession.sdkSessionId, sessionId),
            eq(agentSession.userId, user.id)
          ));

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Get session document with file details (use DB ID for sessionId)
        const [sessionDoc] = await db
          .select({
            sessionDoc: sessionDocument,
            file: files,
          })
          .from(sessionDocument)
          .innerJoin(files, eq(sessionDocument.fileId, files.id))
          .where(and(
            eq(sessionDocument.id, documentId),
            eq(sessionDocument.sessionId, session.id)
          ));

        if (!sessionDoc) {
          return new Response(
            JSON.stringify({ error: 'Document not found in session' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        try {
          // Check if file has been updated in S3 by comparing updatedAt timestamps
          const fileUpdatedAt = sessionDoc.file.updatedAt;
          const lastSyncedAt = sessionDoc.sessionDoc.syncedAt;

          console.log('[SYNC] File updatedAt:', fileUpdatedAt);
          console.log('[SYNC] Last syncedAt:', lastSyncedAt);

          // Convert to Date objects for comparison
          const fileDate = fileUpdatedAt ? new Date(fileUpdatedAt) : null;
          const syncDate = lastSyncedAt ? new Date(lastSyncedAt) : null;

          // Skip sync if file hasn't been updated since last sync
          if (fileDate && syncDate && fileDate <= syncDate) {
            console.log('[SYNC] File not modified, skipping sync');
            return new Response(
              JSON.stringify({
                success: true,
                documentId,
                syncedAt: syncDate.toISOString(),
                skipped: true,
                message: 'File not modified since last sync',
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          }

          console.log('[SYNC] File modified, downloading from S3...');

          // Download fresh copy from S3 (use byte array to support binary files)
          const fileContent = await fileService.getFileByteArray(sessionDoc.file.key);
          if (!fileContent) {
            throw new Error('Failed to download from S3');
          }

          console.log('[SYNC] Downloaded, writing to workspace...');

          // Write to workspace
          const workspaceFilePath = path.join(
            session.claudeHomePath,
            'sessions',
            session.sdkSessionId,
            'workspace',
            sessionDoc.sessionDoc.filePath
          );
          await writeFile(workspaceFilePath, Buffer.from(fileContent));

          console.log('[SYNC] File written, updating timestamp...');

          // Update synced timestamp
          const now = new Date();
          await db
            .update(sessionDocument)
            .set({ syncedAt: now })
            .where(eq(sessionDocument.id, documentId));

          console.log(`[SYNC] SUCCESS: Re-synced ${sessionDoc.file.name} for session ${sessionId}`);

          return new Response(
            JSON.stringify({
              success: true,
              documentId,
              syncedAt: now.toISOString(),
              skipped: false,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        } catch (error) {
          console.error('[SYNC] ERROR:', error);
          return new Response(
            JSON.stringify({
              error: 'Failed to sync document',
              details: error instanceof Error ? error.message : 'Unknown error'
            }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
      },
    },
  },
});
