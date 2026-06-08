/**
 * Unit tests for the document parser pipeline (F2 — file-upload foundation).
 *
 * Verifies file-type detection + the SAFE contract: `parseToMarkdown` never throws and
 * degrades gracefully, so a parser failure (or a missing engine) can never break the
 * upload itself. The actual markitdown conversion is verified in the runtime image
 * (markitdown is installed there, not on dev machines).
 */
import { describe, it, expect } from 'vitest';
import { extOf, needsParse, parseToMarkdown } from '../../src/server/documents/document-parser';

describe('document-parser: extOf', () => {
  it('extracts a lowercase extension', () => {
    expect(extOf('Report.PDF')).toBe('pdf');
    expect(extOf('a.b.docx')).toBe('docx');
  });
  it('returns empty for no extension', () => {
    expect(extOf('README')).toBe('');
    expect(extOf('')).toBe('');
  });
});

describe('document-parser: needsParse', () => {
  it('is true for rich document types', () => {
    for (const f of ['x.pdf', 'x.docx', 'x.pptx', 'x.xlsx', 'x.doc', 'x.epub']) {
      expect(needsParse(f)).toBe(true);
    }
  });
  it('is false for plain text / code the Agent reads directly', () => {
    for (const f of ['notes.txt', 'README.md', 'data.csv', 'config.json', 'main.ts', 'noext']) {
      expect(needsParse(f)).toBe(false);
    }
  });
});

describe('document-parser: parseToMarkdown (safe contract)', () => {
  it('skips non-rich types without spawning a subprocess', async () => {
    const r = await parseToMarkdown('/tmp/whatever.txt', 'whatever.txt', 10);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-a-rich-type');
  });

  it('refuses oversized files before parsing (inline-parse cap)', async () => {
    const r = await parseToMarkdown('/tmp/big.pdf', 'big.pdf', 100, { maxBytes: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('too-large-for-inline-parse');
  });

  it('degrades gracefully (never throws) when the engine is unavailable', async () => {
    // markitdown is not installed on dev machines → the subprocess fails → ok:false.
    const r = await parseToMarkdown('/tmp/does-not-exist.pdf', 'does-not-exist.pdf', 10, {
      timeoutMs: 5000,
    });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.markdown).toBe('');
  });
});
