/**
 * Session File Read API (Independent from Workspace)
 *
 * Part of P12: 会话文件树 + 变更同步
 *
 * GET /api/session/:sessionId/file/:filePath - Read a single file from session
 * Supports ?raw=1 for binary file reading (returns base64 data URL)
 *
 * This is separate from /api/workspace/:sessionId/file/* which is for Sandpack/Workspace.
 */

import { createFileRoute } from '@tanstack/react-router';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';
import { validateRelativePath } from '~/server/security/validate-relative-path';

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    json: 'application/json',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    md: 'text/markdown',
    txt: 'text/plain',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Check if a file extension indicates binary content
 */
function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop();
  const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'woff', 'woff2', 'ttf', 'eot'];
  return binaryExts.includes(ext || '');
}

/**
 * Decode URL-encoded file path
 */
function decodeFilePath(encodedPath: string): string {
  return encodedPath.split('/').map(segment => decodeURIComponent(segment)).join('/');
}

export const Route = createFileRoute('/api/session/$sessionId/file/$filePath')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId, filePath: encodedFilePath } = params;

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Decode URL-encoded file path
        const filePath = decodeFilePath(encodedFilePath);

        if (!validateRelativePath(filePath)) {
          return new Response(
            JSON.stringify({ error: 'Invalid file path' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        // Construct full path
        const fullPath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          filePath
        );

        // Check for raw parameter (binary reading)
        const url = new URL(request.url);
        const raw = url.searchParams.get('raw') === '1';

        try {
          const fileStats = await stat(fullPath);

          if (raw || isBinaryExtension(filePath)) {
            // P15: Binary file reading - return base64 data URL
            const buffer = await readFile(fullPath);
            const base64 = buffer.toString('base64');
            const mimeType = getMimeType(filePath);

            return Response.json({
              content: `data:${mimeType};base64,${base64}`,
              mimeType,
              size: fileStats.size,
              modified: fileStats.mtimeMs,
            });
          } else {
            // Text file reading
            const content = await readFile(fullPath, 'utf-8');

            return Response.json({
              content,
              mimeType: getMimeType(filePath),
              size: fileStats.size,
              modified: fileStats.mtimeMs,
            });
          }
        } catch (error) {
          console.error('[Session File API] Error reading file:', error);
          return new Response(
            JSON.stringify({ error: 'File not found or cannot be read' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }
      },
    },
  },
});
