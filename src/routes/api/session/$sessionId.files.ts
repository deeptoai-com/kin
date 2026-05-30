/**
 * Session Files API (Independent from Workspace)
 *
 * Part of P12: 会话文件树 + 变更同步
 *
 * GET /api/session/:sessionId/files - List all files in session root (recursive)
 * Scans the entire session directory, not just workspace/ subdirectory.
 *
 * This is separate from /api/workspace/:sessionId/files which is for Sandpack/Workspace.
 */

import { createFileRoute } from '@tanstack/react-router';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';

/**
 * System files to exclude from session listings
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
  /^\.git$/, // .git directory
];

/**
 * File metadata interface
 */
interface FileMetadata {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
}

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
    const allowedDotFiles = ['.gitignore', '.env.example', '.editorconfig'];
    if (!allowedDotFiles.includes(name)) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively scan session directory with metadata
 */
async function scanSessionFiles(
  sessionPath: string,
  relativePath: string = ''
): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];

  try {
    const fullPath = path.join(sessionPath, relativePath);
    const entries = await readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip excluded files and directories
      if (shouldExclude(entry.name, entry.isDirectory())) {
        continue;
      }

      const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const entryFullPath = path.join(fullPath, entry.name);

      if (entry.isDirectory()) {
        // Add directory entry
        files.push({
          path: entryRelativePath,
          name: entry.name,
          type: 'directory',
        });

        // Recursively scan subdirectory
        const subFiles = await scanSessionFiles(sessionPath, entryRelativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        // Get file stats
        try {
          const stats = await stat(entryFullPath);
          files.push({
            path: entryRelativePath,
            name: entry.name,
            type: 'file',
            size: stats.size,
            modified: stats.mtimeMs,
          });
        } catch {
          // If stat fails, add entry without metadata
          files.push({
            path: entryRelativePath,
            name: entry.name,
            type: 'file',
          });
        }
      }
    }
  } catch (error) {
    // Directory might not exist yet
    console.error(`[Session Files API] Error reading directory ${sessionPath}:`, error);
  }

  return files;
}

export const Route = createFileRoute('/api/session/$sessionId/files')({
  server: {
    handlers: {
      // GET /api/session/:sessionId/files - List all session files
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

        // Scan the entire session directory (not just workspace/)
        // Path structure: {claudeHomePath}/sessions/{sdkSessionId}/
        const sessionPath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId
        );

        const files = await scanSessionFiles(sessionPath);

        return Response.json({
          sessionId: session.id,
          sdkSessionId: session.sdkSessionId,
          sessionPath,
          files,
          count: files.length,
        });
      },
    },
  },
});
