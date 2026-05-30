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
import { validateRelativePath } from '~/server/security/validate-relative-path';

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
        const trimmed = remainder.replace(/^\/+/, '');
        try {
          return decodeURIComponent(trimmed);
        } catch {
          return trimmed;
        }
      }
    }
  } catch {
    // Fall back to the route param if URL parsing fails.
  }
  return fallback;
}

function parseRawOptions(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get('raw');
    const download = url.searchParams.get('download');
    return {
      raw: raw === '1' || raw === 'true',
      download: download === '1' || download === 'true',
    };
  } catch {
    return { raw: false, download: false };
  }
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

export const Route = createFileRoute('/api/workspace/$sessionId/file/$filePath')({
  server: {
    handlers: {
      // GET /api/workspace/:sessionId/file/:filePath - Get file content
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId, filePath: rawFilePath } = params;
        const filePath = resolveFilePathFromRequest(request, sessionId, rawFilePath);
        const { raw, download } = parseRawOptions(request);

        // Validate file path
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

          if (raw) {
            const buffer = await readFile(fullFilePath);
            const headers = new Headers();
            headers.set('content-type', getContentType(filePath));
            headers.set('cache-control', 'no-store');
            if (download) {
              const filename = path.basename(filePath);
              headers.set('content-disposition', `attachment; filename="${filename}"`);
            }
            return new Response(buffer, { headers });
          }

          // Read file content as text
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
