/**
 * Session Knowledge Bases API
 *
 * POST /api/workspace/:sessionId/knowledge-bases - Add all documents from a KB to session
 */

import { createFileRoute } from '@tanstack/react-router';
import { eq, and } from 'drizzle-orm';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { db } from '~/db/db-config';
import { agentSession, sessionDocument, files, knowledgeBases, kbDocuments } from '~/db/schema';
import { requireUser } from '~/server/require-user';
import { S3StaticFileImpl } from '~/server/s3/s3';
import { needsParse, parseToMarkdown } from '~/server/documents/document-parser';

const fileService = new S3StaticFileImpl();

/**
 * Sanitize filename for workspace storage
 */
function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export const Route = createFileRoute('/api/workspace/$sessionId/knowledge-bases')({
  server: {
    handlers: {
      // POST /api/workspace/:sessionId/knowledge-bases - Add all documents from KB to session
      POST: async ({ request, params }) => {
        console.log('[POST /api/workspace/:sessionId/knowledge-bases] START');
        console.log('[POST] params:', params);

        const user = await requireUser(request);
        console.log('[POST] user:', user.id);
        const { sessionId } = params;

        // Parse request body
        const body = await request.json();
        console.log('[POST] body:', body);
        const { kbId } = body as { kbId: string };

        if (!kbId) {
          console.log('[POST] ERROR: Missing kbId');
          return new Response(
            JSON.stringify({ error: 'kbId is required' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        console.log('[POST] Processing KB:', kbId);

        // Verify KB ownership
        const [kb] = await db
          .select()
          .from(knowledgeBases)
          .where(and(
            eq(knowledgeBases.id, kbId),
            eq(knowledgeBases.userId, user.id)
          ));

        if (!kb) {
          console.log('[POST] ERROR: KB not found or not owned by user:', kbId);
          return new Response(
            JSON.stringify({ error: 'Knowledge base not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        console.log('[POST] KB found:', kb.name);

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

        // Get all documents in this KB
        const kbDocs = await db
          .select({
            kbDocId: kbDocuments.id,
            fileId: kbDocuments.fileId,
            file: files,
          })
          .from(kbDocuments)
          .innerJoin(files, eq(kbDocuments.fileId, files.id))
          .where(eq(kbDocuments.kbId, kbId));

        console.log('[POST] Found documents in KB:', kbDocs.length);

        if (kbDocs.length === 0) {
          return new Response(
            JSON.stringify({
              success: true,
              sessionId,
              kbId,
              kbName: kb.name,
              addedDocuments: [],
              total: 0,
              message: 'Knowledge base is empty',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        }

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

        // Process each file from KB
        for (const doc of kbDocs) {
          try {
            const file = doc.file;
            console.log(`[POST] Processing file: ${file.name} (${file.id})`);

            // Check if already added to this session
            const [existing] = await db
              .select()
              .from(sessionDocument)
              .where(and(
                eq(sessionDocument.sessionId, session.id),
                eq(sessionDocument.fileId, file.id)
              ));

            if (existing) {
              console.log(`[POST] File already in session: ${file.name}`);
              errors.push({ fileId: file.id, fileName: file.name, error: 'Already added to session' });
              continue;
            }

            // Create filename with KB prefix: [KB名称]原文件名
            const originalFilename = sanitizeFilename(file.name);
            const prefixedFilename = `[${kb.name}]${originalFilename}`;
            const workspaceFilePath = path.join(knowledgeBasePath, prefixedFilename);
            const relativeFilePath = `knowledge-base/${prefixedFilename}`;

            // Download from S3
            console.log(`[POST] Downloading from S3: ${file.key}`);
            const fileContent = await fileService.getFileByteArray(file.key);
            if (!fileContent) {
              console.log(`[POST] ERROR: Failed to download from S3: ${file.key}`);
              errors.push({ fileId: file.id, fileName: file.name, error: 'Failed to download from S3' });
              continue;
            }

            console.log(`[POST] Downloaded ${fileContent.length} bytes, writing to: ${workspaceFilePath}`);

            // Write to workspace with KB prefix
            await writeFile(workspaceFilePath, Buffer.from(fileContent));
            console.log(`[POST] File written successfully`);

            // F3: parse rich docs (pdf/docx/...) → markdown so the Agent can read them.
            // Non-fatal: a parse failure still leaves the original file in the workspace.
            if (needsParse(prefixedFilename)) {
              try {
                const parsed = await parseToMarkdown(workspaceFilePath, prefixedFilename, fileContent.length);
                if (parsed.ok) {
                  await writeFile(`${workspaceFilePath}.md`, parsed.markdown, 'utf8');
                } else {
                  console.error(`[POST] Parse skipped/failed for ${prefixedFilename}: ${parsed.error}`);
                }
              } catch (parseError) {
                console.error('[POST] Parse error:', parseError);
              }
            }

            // Create session_document record
            const [sessionDoc] = await db
              .insert(sessionDocument)
              .values({
                sessionId: session.id,
                fileId: file.id,
                filePath: relativeFilePath,
                syncedAt: new Date(),
              })
              .returning();

            addedDocuments.push({
              id: sessionDoc.id,
              fileId: file.id,
              fileName: file.name,
              workspaceFileName: prefixedFilename,
              filePath: relativeFilePath,
              syncedAt: sessionDoc.syncedAt?.toISOString() || new Date().toISOString(),
            });

            console.log(`[POST] SUCCESS: Added ${prefixedFilename} to session`);
          } catch (error) {
            console.error(`[POST] ERROR adding file ${doc.file.id}:`, error);
            errors.push({
              fileId: doc.file.id,
              fileName: doc.file.name,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        console.log(`[POST] Completed. Added: ${addedDocuments.length}, Errors: ${errors.length}`);

        return new Response(
          JSON.stringify({
            success: true,
            sessionId,
            kbId,
            kbName: kb.name,
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
