/**
 * Workspace File Content API
 *
 * GET /api/workspace/:sessionId/file/:filePath - Get file content
 */

import { createFileRoute } from '@tanstack/react-router';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';

/**
 * Validate file path to prevent path traversal attacks
 */
function validateFilePath(filePath: string): boolean {
  if (!filePath || filePath.trim().length === 0) {
    return false;
  }

  // Reject paths with path traversal patterns
  if (filePath.includes('..') || filePath.includes('~') || path.isAbsolute(filePath)) {
    return false;
  }

  // Normalize and check again
  const normalized = path.normalize(filePath);
  if (
    normalized === '.' ||
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    normalized.startsWith('\\')
  ) {
    return false;
  }

  return true;
}

function resolveFilePathFromRequest(
  request: Request,
  sessionId: string,
  fallback: string
): string {
  try {
    const url = new URL(request.url);
    const prefix = `/api/workspace/${sessionId}/file/`;
    if (url.pathname.startsWith(prefix)) {
      const remainder = url.pathname.slice(prefix.length);
      if (remainder) {
        return remainder.replace(/^\/+/, '');
      }
    }
  } catch {
    // Fall back to the route param if URL parsing fails.
  }
  return fallback;
}

export const Route = createFileRoute('/api/workspace/$sessionId/file/$filePath')({
  server: {
    handlers: {
      // GET /api/workspace/:sessionId/file/:filePath - Get file content
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId, filePath: rawFilePath } = params;
        const filePath = resolveFilePathFromRequest(request, sessionId, rawFilePath);

        // Validate file path
        if (!validateFilePath(filePath)) {
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

        // Get workspace directory
        // Path structure: {claudeHomePath}/sessions/{sdkSessionId}/workspace/
        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );
        const fullFilePath = path.join(workspacePath, filePath);

        try {
          const stats = await stat(fullFilePath);
          if (!stats.isFile()) {
            return new Response(
              JSON.stringify({ error: 'Path is not a file' }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            );
          }

          // Read file content
          const content = await readFile(fullFilePath, 'utf-8');

          return Response.json({
            sessionId: session.id,
            filePath,
            content,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return new Response(
              JSON.stringify({ error: 'File not found' }),
              { status: 404, headers: { 'content-type': 'application/json' } }
            );
          }

          if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
            return new Response(
              JSON.stringify({ error: 'Path is not a file' }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            );
          }

          console.error('[Workspace API] Error reading file:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to read file' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
      },
    },
  },
});
