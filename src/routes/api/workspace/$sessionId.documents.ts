/**
 * Session Documents API
 *
 * Manages the relationship between agent sessions and documents from the global library.
 *
 * POST   /api/workspace/:sessionId/documents      - Add document(s) to session
 * GET    /api/workspace/:sessionId/documents      - List session documents
 * DELETE /api/workspace/:sessionId/documents/:id  - Remove document from session
 */

import { createFileRoute } from '@tanstack/react-router';
import { eq, and } from 'drizzle-orm';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { db } from '~/db/db-config';
import { agentSession, sessionDocument, files } from '~/db/schema';
import { requireUser } from '~/server/require-user';
import { S3StaticFileImpl } from '~/server/s3/s3';

const fileService = new S3StaticFileImpl();

/**
 * Sanitize filename for workspace storage
 */
function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export const Route = createFileRoute('/api/workspace/$sessionId/documents')({
  server: {
    handlers: {
      // GET /api/workspace/:sessionId/documents - List documents in session
      GET: async ({ request, params }) => {
        console.log('[GET /api/workspace/:sessionId/documents] START');
        console.log('[GET] params:', params);

        const user = await requireUser(request);
        console.log('[GET] user:', user.id);
        const { sessionId } = params;

        // Verify session ownership (sessionId is sdk_session_id from frontend)
        const [session] = await db
          .select()
          .from(agentSession)
          .where(and(
            eq(agentSession.sdkSessionId, sessionId),
            eq(agentSession.userId, user.id)
          ));

        console.log('[GET] session found:', !!session);
        if (session) {
          console.log('[GET] session DB ID:', session.id);
        }

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Get all documents linked to this session with file details (use DB ID)
        const documentsRaw = await db
          .select({
            id: sessionDocument.id,
            fileId: sessionDocument.fileId,
            filePath: sessionDocument.filePath,
            syncedAt: sessionDocument.syncedAt,
            fileName: files.name,
            fileSize: files.size,
            mimeType: files.mimeType,
            fileKey: files.key,
          })
          .from(sessionDocument)
          .innerJoin(files, eq(sessionDocument.fileId, files.id))
          .where(eq(sessionDocument.sessionId, session.id));

        // Convert Date objects to ISO strings for JSON serialization
        const documents = documentsRaw.map((doc) => ({
          ...doc,
          syncedAt: doc.syncedAt?.toISOString() || new Date().toISOString(),
        }));

        console.log('[GET] Found documents:', documents.length);
        console.log('[GET] Returning response');

        return new Response(
          JSON.stringify({
            sessionId,
            documents,
            total: documents.length,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      },

      // POST /api/workspace/:sessionId/documents - Add document(s) to session
      POST: async ({ request, params }) => {
        console.log('[POST /api/workspace/:sessionId/documents] START');
        console.log('[POST] params:', params);

        const user = await requireUser(request);
        console.log('[POST] user:', user.id);
        const { sessionId } = params;

        // Parse request body
        const body = await request.json();
        console.log('[POST] body:', body);
        const { fileIds } = body as { fileIds: string[] };

        if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
          console.log('[POST] ERROR: Invalid fileIds:', fileIds);
          return new Response(
            JSON.stringify({ error: 'fileIds array is required' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        console.log('[POST] Processing fileIds:', fileIds);

        // Verify session ownership (sessionId is sdk_session_id from frontend)
        const [session] = await db
          .select()
          .from(agentSession)
          .where(and(
            eq(agentSession.sdkSessionId, sessionId),
            eq(agentSession.userId, user.id)
          ));

        console.log('[POST] session found:', !!session);

        if (!session) {
          console.log('[POST] ERROR: Session not found for sdkSessionId:', sessionId);
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        console.log('[POST] Session details:', {
          dbId: session.id,
          claudeHomePath: session.claudeHomePath,
          sdkSessionId: session.sdkSessionId,
        });

        // Get workspace knowledge-base path
        const knowledgeBasePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace',
          'knowledge-base'
        );

        // Ensure directory exists
        await mkdir(knowledgeBasePath, { recursive: true });

        const addedDocuments = [];
        const errors = [];

        // Process each file
        for (const fileId of fileIds) {
          try {
            console.log(`[POST] Processing file: ${fileId}`);

            // Get file details
            // Tenant isolation: only resolve files owned by the authenticated user
            // (prevents downloading another tenant's file by id — review Risk #3).
            const [file] = await db
              .select()
              .from(files)
              .where(and(eq(files.id, fileId), eq(files.clientId, user.id)));

            if (!file) {
              console.log(`[POST] ERROR: File not found: ${fileId}`);
              errors.push({ fileId, error: 'File not found' });
              continue;
            }

            console.log(`[POST] File found: ${file.name}, key: ${file.key}`);

            // Check if already added to this session (use DB ID, not SDK session ID)
            const [existing] = await db
              .select()
              .from(sessionDocument)
              .where(and(
                eq(sessionDocument.sessionId, session.id),
                eq(sessionDocument.fileId, fileId)
              ));

            if (existing) {
              errors.push({ fileId, error: 'Document already added to session' });
              continue;
            }

            // Sanitize filename
            const safeFilename = sanitizeFilename(file.name);
            const workspaceFilePath = path.join(knowledgeBasePath, safeFilename);
            const relativeFilePath = `knowledge-base/${safeFilename}`;

            // Download from S3 (use byte array to support binary files)
            console.log(`[POST] Downloading from S3: ${file.key}`);
            const fileContent = await fileService.getFileByteArray(file.key);
            if (!fileContent) {
              console.log(`[POST] ERROR: Failed to download from S3: ${file.key}`);
              errors.push({ fileId, error: 'Failed to download from S3' });
              continue;
            }

            console.log(`[POST] Downloaded ${fileContent.length} bytes, writing to: ${workspaceFilePath}`);

            // Write to workspace
            await writeFile(workspaceFilePath, Buffer.from(fileContent));
            console.log(`[POST] File written successfully`);

            // Create session_document record (use DB ID, not SDK session ID)
            const [sessionDoc] = await db
              .insert(sessionDocument)
              .values({
                sessionId: session.id,
                fileId,
                filePath: relativeFilePath,
                syncedAt: new Date(),
              })
              .returning();

            addedDocuments.push({
              id: sessionDoc.id,
              fileId,
              fileName: file.name,
              filePath: relativeFilePath,
              syncedAt: sessionDoc.syncedAt?.toISOString() || new Date().toISOString(),
            });

            console.log(`[POST] SUCCESS: Added ${file.name} to session ${session.id} (SDK: ${sessionId})`);
          } catch (error) {
            console.error(`[POST] ERROR adding file ${fileId}:`, error);
            errors.push({
              fileId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        console.log(`[POST] Completed. Added: ${addedDocuments.length}, Errors: ${errors.length}`);

        return new Response(
          JSON.stringify({
            success: true,
            sessionId,
            addedDocuments,
            errors: errors.length > 0 ? errors : undefined,
            total: addedDocuments.length,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      },
    },
  },
});
