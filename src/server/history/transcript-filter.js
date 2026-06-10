/**
 * History-display filter for SDK transcript (JSONL) entries — pure predicate
 * deciding whether an entry is a synthetic/meaningless turn that must NOT be
 * rendered as a conversation message.
 *
 * Used by ws-server's parseJsonlContent (the JSONL→messages mapping behind the
 * `messages_loaded` resume event). Display-only: the live streaming path, the
 * branch(fork) copy logic and the worker never go through this.
 *
 * Drops exactly three artifact shapes (SDK pinned at 0.2.112 / ARK):
 *  1. The continuation prompt the SDK CLI injects into the transcript when a
 *     session is resumed without a user prompt. 0.2.112 marks it `isMeta:true`;
 *     the exact-string match is a fallback for entries written without the flag.
 *  2. Its synthetic auto-reply: an assistant entry with model "<synthetic>"
 *     whose only content is "No response requested.". Must be dropped together
 *     with (1), or the turn-coalescing history loader would merge that text
 *     into the previous assistant turn.
 *  3. Whitespace-only user prompts — the legacy eager-create init artifact
 *     (a single-space prompt) still present in old transcripts. Only pure
 *     text content counts: entries carrying any non-text block (tool_result
 *     backfills, images, …) are never dropped, and attachment messages are
 *     safe because the 【附件信息】 block makes their text non-empty.
 *
 * Anything else — real user/assistant messages, inherited (forkedFrom)
 * entries, synthetic error notices with other texts — is kept.
 */

export const SDK_CONTINUATION_PROMPT = 'Continue from where you left off.';
export const SYNTHETIC_NO_RESPONSE = 'No response requested.';

/**
 * Extract the plain text of a message content when (and only when) it is pure
 * text: a string, or an array consisting solely of `text` blocks.
 *
 * @param {unknown} content - `message.content` of a transcript entry.
 * @returns {string|null} Joined text, or null if any non-text block is present
 *   (tool_result, image, …) — callers must keep such entries.
 */
function extractPureText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'text') return null;
    texts.push(typeof block.text === 'string' ? block.text : '');
  }
  return texts.join('\n');
}

/**
 * @param {object} entry - One parsed transcript (JSONL) entry.
 * @returns {boolean} true if the entry is a synthetic/meaningless turn that
 *   must be dropped from history display.
 */
export function isSyntheticTranscriptEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
  const message = entry.message;
  if (!message || typeof message !== 'object') return false;

  if (type === 'user') {
    // Marker first: the SDK writes isMeta:true on injected meta prompts.
    if (entry.isMeta === true) return true;

    const text = extractPureText(message.content);
    if (text === null) return false; // non-text blocks present — always keep

    const trimmed = text.trim();
    if (trimmed === '') return true; // legacy eager-init " " prompt
    if (trimmed === SDK_CONTINUATION_PROMPT) return true; // string fallback
    return false;
  }

  if (type === 'assistant') {
    if (message.model !== '<synthetic>') return false;
    const text = extractPureText(message.content);
    // Only the no-op reply; synthetic error notices (other texts) stay visible.
    return text !== null && text.trim() === SYNTHETIC_NO_RESPONSE;
  }

  return false;
}
