/**
 * Workspace Files API
 *
 * GET /api/workspace/:sessionId/files - List all files in workspace
 */

import { createFileRoute } from '@tanstack/react-router';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';
import { validateRelativePath } from '~/server/security/validate-relative-path';
import { needsParse, parseToMarkdown } from '~/server/documents/document-parser';

/**
 * System files to exclude from workspace listings
 * These are internal SDK/session files that users shouldn't see
 */
const EXCLUDED_FILES = new Set([
  '.artifacts.json',
  'session.jsonl',
  '.DS_Store',
  'Thumbs.db',
]);

/**
 * Patterns for hidden/system directories to skip
 */
const EXCLUDED_DIR_PATTERNS = [
  /^\./, // Hidden directories (start with .)
  /^node_modules$/, // node_modules
  /^__pycache__$/, // Python cache
];

/**
 * Check if a file/directory should be excluded
 */
function shouldExclude(name: string, isDirectory: boolean): boolean {
  // Check exact matches for files
  if (!isDirectory && EXCLUDED_FILES.has(name)) {
    return true;
  }

  // Check patterns for directories
  if (isDirectory) {
    for (const pattern of EXCLUDED_DIR_PATTERNS) {
      if (pattern.test(name)) {
        return true;
      }
    }
  }

  // Exclude hidden files (start with .) except for common config files
  if (name.startsWith('.') && !isDirectory) {
    // Allow certain config files
    const allowedDotFiles = ['.gitignore', '.env.example', '.editorconfig'];
    if (!allowedDotFiles.includes(name)) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively list all files in a directory
 * Filters out system/hidden files for cleaner user experience
 */
async function listFilesRecursive(dirPath: string, basePath: string = ''): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip excluded files and directories
      if (shouldExclude(entry.name, entry.isDirectory())) {
        continue;
      }

      const relativePath = path.join(basePath, entry.name);
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively list subdirectory
        const subFiles = await listFilesRecursive(fullPath, relativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch (error) {
    // Directory might not exist yet
    console.error(`[Workspace API] Error reading directory ${dirPath}:`, error);
  }

  return files;
}

export const Route = createFileRoute('/api/workspace/$sessionId/files')({
  server: {
    handlers: {
      // GET /api/workspace/:sessionId/files - List workspace files
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId } = params;

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Get workspace directory
        // Path structure: {claudeHomePath}/sessions/{sdkSessionId}/workspace/
        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );

        // List all files in workspace
        const files = await listFilesRecursive(workspacePath);

        return Response.json({
          sessionId: session.id,
          sdkSessionId: session.sdkSessionId,
          workspacePath,
          files,
        });
      },
      // POST /api/workspace/:sessionId/files - Upload a file into workspace
      POST: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId } = params;

        const formData = await request.formData();
        const file = formData.get('file');
        const rawFilePath = formData.get('filePath');
        const filePath = rawFilePath ? String(rawFilePath) : file instanceof File ? file.name : '';

        if (!(file instanceof File) || !filePath) {
          return new Response(
            JSON.stringify({ error: 'Missing file upload' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        if (!validateRelativePath(filePath)) {
          return new Response(
            JSON.stringify({ error: 'Invalid file path' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );
        const fullFilePath = path.join(workspacePath, filePath);

        try {
          await mkdir(path.dirname(fullFilePath), { recursive: true });
          const buffer = Buffer.from(await file.arrayBuffer());
          await writeFile(fullFilePath, buffer);

          // F2: parse rich docs (pdf/docx/...) → markdown so the Agent's Read tool can
          // use them. Plain text/code is left as-is (the Agent reads it directly).
          // Parse failure is non-fatal: the original file is still uploaded.
          let parsedPath: string | undefined;
          let parsedEngine: string | undefined;
          if (needsParse(filePath)) {
            try {
              const parsed = await parseToMarkdown(fullFilePath, filePath, buffer.byteLength);
              if (parsed.ok) {
                const mdRelPath = `${filePath}.md`;
                await writeFile(path.join(workspacePath, mdRelPath), parsed.markdown, 'utf8');
                parsedPath = mdRelPath;
                parsedEngine = parsed.engine ?? undefined;
              } else {
                console.error(`[Workspace API] Parse skipped/failed for ${filePath}: ${parsed.error}`);
              }
            } catch (parseError) {
              console.error('[Workspace API] Parse error:', parseError);
            }
          }

          return Response.json({
            sessionId: session.id,
            filePath,
            storedPath: fullFilePath,
            parsedPath,
            parsedEngine,
          });
        } catch (error) {
          console.error('[Workspace API] Error writing file:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to upload file' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
      },
    },
  },
});
