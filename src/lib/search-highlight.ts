/**
 * XSS-safe rendering of Meili search-result snippets (conversation search P2-1).
 *
 * Meili's `_formatted.text` inserts highlight tags around matches but does NOT escape the
 * surrounding message body — rendering it raw with dangerouslySetInnerHTML would be stored
 * XSS (a message containing `<img onerror=…>` would execute). Defence:
 *   1. Meili emits NON-HTML sentinel tags (HL_PRE/HL_POST below) instead of `<em>`.
 *   2. We HTML-escape the whole snippet (so any markup in the body becomes inert text).
 *   3. Then swap the (escaping-safe, alphanumeric) sentinels for real `<mark>`/`</mark>`.
 * Only our own `<mark>` ever reaches the DOM. Pure (no DOM) so it works server- and client-side.
 */

// Alphanumeric + underscore only, so HTML-escaping leaves them untouched; long+random-ish to
// make a collision with real message text negligible. These are passed to Meili as the
// highlightPreTag/highlightPostTag (see searchMessages).
export const HL_PRE = 'KIN_HLB3F9A1_START';
export const HL_POST = 'KIN_HLB3F9A1_END';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turn a Meili snippet (with sentinel highlight tags) into safe HTML: body escaped,
 * highlights wrapped in `<mark>`. Safe to pass to dangerouslySetInnerHTML.
 */
export function renderSnippetHtml(snippet: string): string {
  if (!snippet) return '';
  return escapeHtml(snippet).split(HL_PRE).join('<mark>').split(HL_POST).join('</mark>');
}
