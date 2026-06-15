/**
 * Shared JSONL parsing + indexable-message extraction (conversation search, Kin).
 *
 * Messages are NOT in Postgres — they live only in the Claude Agent SDK's per-session JSONL
 * transcripts (/data/users/{userId}/.claude/projects/{project}/{sdkSessionId}.jsonl). To search
 * message bodies we project those files into a Meili index. This module is the single source of
 * the parse + extract logic so the worker (indexer) and any other server-side consumer don't
 * drift. (ws-server.mjs keeps its own parse for rendering and only ENQUEUES the index job —
 * plain node can't import .ts, so we never import this from there.)
 *
 * Spec §3.2. Extraction rules: only user/assistant `text` blocks; skip tool_use/tool_result/
 * thinking; skip empty; createdAt comes from the JSONL `timestamp` (NOT a fresh Date()).
 */

import { isSyntheticTranscriptEntry } from '~/server/history/transcript-filter.js';

export interface SearchMessage {
  /** Composite Meili primary key `${sessionId}__${messageId}`. MUST scope by session: a
   *  branched/forked session copies the source transcript and reuses its message uuids, so
   *  keying on uuid alone would collide across sessions and silently overwrite hits. */
  id: string;
  /** Raw SDK message uuid — the deep-link DOM anchor (#msg-{messageId}). */
  messageId: string;
  /** sdkSessionId (= the /agents/c/$sessionId route id; deep-link target). */
  sessionId: string;
  /** Session owner — isolation filter. */
  userId: string;
  projectId: string | null;
  role: 'user' | 'assistant';
  /** Searchable body (joined text blocks). */
  text: string;
  /** JSONL timestamp → epoch ms (0 if absent) — sort key. */
  createdAt: number;
  /** Session title — result display. */
  title: string;
}

export interface IndexContext {
  sessionId: string;
  userId: string;
  projectId: string | null;
  title: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface JsonlEntry {
  type?: string;
  uuid?: string;
  timestamp?: string;
  session_id?: string;
  sessionId?: string;
  message?: { role?: string; content?: string | ContentBlock[] };
  [key: string]: unknown;
}

/**
 * Parse JSONL transcript content into normalized SDK entries.
 * Mirrors ws-server.mjs:516 parseJsonlContent (skip summary + synthetic, normalize sessionId,
 * tolerate malformed lines).
 */
export function parseJsonlContent(content: string): JsonlEntry[] {
  if (!content) return [];
  const out: JsonlEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let parsed: JsonlEntry;
    try {
      parsed = JSON.parse(trimmed) as JsonlEntry;
    } catch {
      continue;
    }
    const type = typeof parsed.type === 'string' ? parsed.type.toLowerCase() : '';
    if (type === 'summary') continue;
    if (isSyntheticTranscriptEntry(parsed)) continue;
    if ('sessionId' in parsed) {
      parsed.session_id = parsed.sessionId;
      delete parsed.sessionId;
    }
    out.push(parsed);
  }
  return out;
}

/** Join only the `text` blocks of a message's content (string or block array). */
function extractText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    // Only user-visible prose. Skip tool_use / tool_result / thinking to keep results clean.
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

/**
 * Project a session's JSONL transcript into indexable message docs.
 * Skips non user/assistant entries, empty-text entries, and entries without a stable uuid.
 */
export function extractIndexableMessages(jsonlText: string, ctx: IndexContext): SearchMessage[] {
  const out: SearchMessage[] = [];
  for (const entry of parseJsonlContent(jsonlText)) {
    const role = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
    if (role !== 'user' && role !== 'assistant') continue;

    const text = extractText(entry.message?.content);
    if (!text) continue;

    const messageId = typeof entry.uuid === 'string' && entry.uuid.length > 0 ? entry.uuid : null;
    if (!messageId) continue; // need a stable uuid for the deep-link anchor + per-session dedupe

    const parsedTs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    out.push({
      id: `${ctx.sessionId}__${messageId}`,
      messageId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      role,
      text,
      createdAt: Number.isFinite(parsedTs) ? parsedTs : 0,
      title: ctx.title,
    });
  }
  return out;
}
