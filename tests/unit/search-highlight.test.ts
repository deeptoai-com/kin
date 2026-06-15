/**
 * XSS-safety tests for search snippet rendering (A's review §3 P2-1).
 * The message body must be HTML-escaped; only our own <mark> reaches the DOM.
 */
import { describe, it, expect } from 'vitest';
import { renderSnippetHtml, escapeHtml, HL_PRE, HL_POST } from '~/lib/search-highlight';

describe('renderSnippetHtml', () => {
  it('wraps sentinel highlights in <mark> and escapes everything else', () => {
    const snippet = `${HL_PRE}contract${HL_POST} clause`;
    expect(renderSnippetHtml(snippet)).toBe('<mark>contract</mark> clause');
  });

  it('neutralizes injected HTML in the message body (stored XSS)', () => {
    const snippet = `${HL_PRE}hi${HL_POST} <img src=x onerror=alert(1)><script>bad()</script>`;
    const html = renderSnippetHtml(snippet);
    expect(html).toBe('<mark>hi</mark> &lt;img src=x onerror=alert(1)&gt;&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('escapes ampersands and quotes', () => {
    expect(escapeHtml(`a & b "c" 'd' <e>`)).toBe('a &amp; b &quot;c&quot; &#39;d&#39; &lt;e&gt;');
  });

  it('returns empty string for empty input', () => {
    expect(renderSnippetHtml('')).toBe('');
  });
});
