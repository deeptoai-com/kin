import path from 'node:path';

/**
 * Validate a caller-supplied **relative** file path before joining it onto a
 * server-side workspace root, to prevent path-traversal escapes.
 *
 * Shared by the workspace/session file & artifact API routes (B3 — previously each
 * route defined its own near-identical copy). This is the STRICTEST of those copies:
 * it rejects empty/whitespace and a bare "." in addition to the common checks.
 *
 * Rejects: empty/whitespace, `..` segments, `~`, absolute paths (POSIX or Windows),
 * and anything that still looks absolute or contains `..` after normalization.
 *
 * NOTE: this is the route-layer guard for URL/relative inputs. It is intentionally
 * separate from `src/claude/path-security.js` `canUseTool`, which guards the agent
 * SDK's tools against *absolute* paths with realpath + cross-user checks.
 *
 * @returns true if the path is safe to join onto a trusted base directory.
 */
export function validateRelativePath(filePath: string): boolean {
  if (!filePath || filePath.trim().length === 0) {
    return false;
  }

  // Backslashes never appear in a legitimate POSIX relative path (they are Windows
  // separators / UNC prefixes). On a POSIX server `path.isAbsolute('C:\\x')` is false,
  // so reject these explicitly for correct cross-platform behavior.
  if (filePath.includes('\\')) {
    return false;
  }
  // Windows drive-letter prefix (e.g. "C:/Windows") — also not absolute on POSIX.
  if (/^[a-zA-Z]:/.test(filePath)) {
    return false;
  }

  // Reject obvious traversal / absolute / home markers up front.
  if (filePath.includes('..') || filePath.includes('~') || path.isAbsolute(filePath)) {
    return false;
  }

  // Normalize and re-check (collapses things like "a/./../b"). Reject paths that
  // resolve to the directory itself (".", "./") or that still look absolute/traversing.
  const normalized = path.normalize(filePath);
  if (
    normalized === '.' ||
    normalized === './' ||
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    normalized.startsWith('\\')
  ) {
    return false;
  }

  return true;
}
