/**
 * Locate a session's JSONL transcript on disk (conversation search indexer).
 * Ported from ws-server.mjs:479 locateSessionFile so the worker (TS) can find transcripts.
 * Files live at: {claudeHome}/.claude/projects/{project}/{sessionId}.jsonl — we scan project
 * dirs because the project subdir name isn't stored. `sessionId` here is the JSONL filename
 * (= realSdkSessionId, falling back to sdkSessionId).
 */

import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function locateSessionFile(claudeHome: string, sessionId: string): Promise<string | null> {
  if (!claudeHome || !sessionId) return null;
  const projectsRoot = path.join(path.resolve(claudeHome), '.claude', 'projects');

  try {
    await access(projectsRoot);
  } catch {
    return null;
  }

  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(projectsRoot, entry.name, `${sessionId}.jsonl`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // next project dir
      }
    }
  } catch {
    // projects root unreadable — treat as not found
  }
  return null;
}
