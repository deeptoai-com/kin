// @vitest-environment node
/**
 * Unit tests for RAG tier routing + the structure-aware chunker (final spec D5/D10).
 * These pin the routing boundaries (only 'rag' documents get embedded — the cost valve)
 * and the chunker contracts the ingest pipeline relies on.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAG_MIN_TOKENS,
  INLINE_MAX_TOKENS,
  estimateTokens,
  routeTier,
} from '../../src/server/rag/tier';
import { SINGLE_CHUNK_MAX_TOKENS, chunkStrategy } from '../../src/server/rag/tier';
import { CHILD_MAX_TOKENS, chunkMarkdown } from '../../src/server/rag/chunker';
import { extractPageMap, pageLookup } from '../../src/server/rag/parser-client';
import { rrfFuse } from '../../src/server/rag/fuse';

describe('estimateTokens', () => {
  it('counts CJK ~1:1 and latin ~4 chars/token', () => {
    expect(estimateTokens('中文十个字符的估算测试')).toBe(11);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('chunkStrategy — KB docs embed regardless of size; size only picks how to chunk (spec D6)', () => {
  it('small doc → single chunk (whole doc, preserves global structure)', () => {
    expect(chunkStrategy(0)).toBe('single');
    expect(chunkStrategy(SINGLE_CHUNK_MAX_TOKENS)).toBe('single');
  });
  it('large doc → structured parent/child', () => {
    expect(chunkStrategy(SINGLE_CHUNK_MAX_TOKENS + 1)).toBe('structured');
    expect(chunkStrategy(100_000)).toBe('structured');
  });
});

describe('routeTier — legacy chat-attachment tiering', () => {
  it('small docs are inline (never embedded)', () => {
    expect(routeTier(500, DEFAULT_RAG_MIN_TOKENS)).toBe('inline');
    expect(routeTier(INLINE_MAX_TOKENS, DEFAULT_RAG_MIN_TOKENS)).toBe('inline');
  });

  it('mid-size docs are grep (workspace Read/Grep, not embedded)', () => {
    expect(routeTier(INLINE_MAX_TOKENS + 1, DEFAULT_RAG_MIN_TOKENS)).toBe('grep');
    expect(routeTier(DEFAULT_RAG_MIN_TOKENS - 1, DEFAULT_RAG_MIN_TOKENS)).toBe('grep');
  });

  it('only ≥ threshold goes to rag', () => {
    expect(routeTier(DEFAULT_RAG_MIN_TOKENS, DEFAULT_RAG_MIN_TOKENS)).toBe('rag');
  });
});

const MD = `前言段落，介绍这份文档。

# 第一章 总则

本合同约定退款费率为 4.5%。

## 1.1 适用范围

适用于全部订单。

# 第二章 保修

保修期为两年。`;

describe('chunkMarkdown', () => {
  it('builds heading-scoped sections with full sectionPath and toc', () => {
    const r = chunkMarkdown('测试合同', MD);
    const paths = r.parents.map((p) => p.sectionPath);
    expect(paths).toContain('测试合同'); // preamble
    expect(paths).toContain('测试合同 > 第一章 总则');
    expect(paths).toContain('测试合同 > 第一章 总则 > 1.1 适用范围');
    expect(paths).toContain('测试合同 > 第二章 保修'); // sibling heading pops the stack
    expect(r.toc.map((t) => t.path)).toEqual([
      '测试合同 > 第一章 总则',
      '测试合同 > 第一章 总则 > 1.1 适用范围',
      '测试合同 > 第二章 保修',
    ]);
  });

  it('every child stays under CHILD_MAX_TOKENS and points at a valid parent', () => {
    const bigSection = `# 大章节\n\n${Array.from({ length: 80 }, (_, i) => `这是第${i}段，包含一些用于撑大体积的中文内容，重复重复重复重复重复重复重复重复重复重复。`).join('\n\n')}`;
    const r = chunkMarkdown('大文档', bigSection);
    expect(r.children.length).toBeGreaterThan(1);
    for (const c of r.children) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHILD_MAX_TOKENS);
      expect(r.parents[c.parentIndex]).toBeDefined();
      expect(c.sectionPath).toBe(r.parents[c.parentIndex].sectionPath);
    }
  });

  it('hard-splits a single oversized paragraph instead of dropping it', () => {
    const giant = `# 表格\n\n${Array.from({ length: 200 }, (_, i) => `行${i}：很长的一行中文内容用来模拟巨型表格的单元格数据`).join('\n')}`;
    const r = chunkMarkdown('表格文档', giant);
    expect(r.children.length).toBeGreaterThan(1);
    for (const c of r.children) expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHILD_MAX_TOKENS);
  });

  it('empty/whitespace markdown produces no chunks', () => {
    const r = chunkMarkdown('空', '\n\n  \n');
    expect(r.parents).toHaveLength(0);
    expect(r.children).toHaveLength(0);
  });
});

// Marker semantics (verified against opendataloader output): `<!-- odl-page N -->` is a
// standalone line at the START of page N.
const MARKED = `<!-- odl-page 1 -->
前言

# 第一章
第一章内容A

<!-- odl-page 2 -->
第一章内容B

# 第二章
<!-- odl-page 3 -->
第二章内容`;

describe('extractPageMap + pageLookup — sidecar page markers → page map', () => {
  it('strips markers and records where each page begins (stripped line index)', () => {
    const { markdown, pageMap } = extractPageMap(MARKED);
    expect(markdown).not.toContain('odl-page');
    expect(pageMap).toEqual([
      { page: 1, line: 0 },
      { page: 2, line: 5 },
      { page: 3, line: 8 },
    ]);
    expect(markdown.split('\n')[5]).toBe('第一章内容B');
    expect(markdown.split('\n')[8]).toBe('第二章内容');
  });

  it('pageLookup maps line index → page (null before first break / empty map)', () => {
    const { pageMap } = extractPageMap(MARKED);
    const at = pageLookup(pageMap);
    expect(at(0)).toBe(1);
    expect(at(4)).toBe(1);
    expect(at(5)).toBe(2);
    expect(at(7)).toBe(2);
    expect(at(8)).toBe(3);
    expect(at(999)).toBe(3);
    expect(pageLookup([])(0)).toBeNull();
    expect(pageLookup(null)(0)).toBeNull();
  });
});

describe('chunkMarkdown — page ranges (citation mapping)', () => {
  it('chunks and toc carry page ranges when pageOfLine is provided', () => {
    const { markdown, pageMap } = extractPageMap(MARKED);
    const r = chunkMarkdown('文档', markdown, pageLookup(pageMap));

    const preamble = r.parents.find((p) => p.sectionPath === '文档')!;
    expect([preamble.pageStart, preamble.pageEnd]).toEqual([1, 1]);

    // 第一章 spans the page-2 boundary: 内容A on p.1, 内容B on p.2.
    const ch1 = r.parents.find((p) => p.sectionPath === '文档 > 第一章')!;
    expect([ch1.pageStart, ch1.pageEnd]).toEqual([1, 2]);

    const ch2 = r.parents.find((p) => p.sectionPath === '文档 > 第二章')!;
    expect([ch2.pageStart, ch2.pageEnd]).toEqual([3, 3]);

    for (const c of r.children) {
      const parent = r.parents[c.parentIndex];
      expect(c.pageStart).toBe(parent.pageStart);
      expect(c.pageEnd).toBe(parent.pageEnd);
    }

    expect(r.toc).toEqual([
      { path: '文档 > 第一章', level: 1, pageStart: 1 },
      { path: '文档 > 第二章', level: 1, pageStart: 3 },
    ]);
  });

  it('child pieces of a multi-page section get per-piece (not parent-wide) ranges', () => {
    // Two pages of distinct repeated paragraphs large enough to force ≥2 children.
    const pageA = Array.from({ length: 30 }, (_, i) => `第一页第${i}段，中文内容撑大体积重复重复重复重复重复重复。`).join('\n\n');
    const pageB = Array.from({ length: 30 }, (_, i) => `第二页第${i}段，中文内容撑大体积重复重复重复重复重复重复。`).join('\n\n');
    const marked = `<!-- odl-page 1 -->\n# 大章节\n${pageA}\n<!-- odl-page 2 -->\n${pageB}`;
    const { markdown, pageMap } = extractPageMap(marked);
    const r = chunkMarkdown('大文档', markdown, pageLookup(pageMap));
    expect(r.children.length).toBeGreaterThan(1);
    const first = r.children[0];
    const last = r.children[r.children.length - 1];
    expect(first.pageStart).toBe(1);
    expect(last.pageEnd).toBe(2);
    // Every child range is sane and within the document's page span.
    for (const c of r.children) {
      expect(c.pageStart).not.toBeNull();
      expect(c.pageEnd).not.toBeNull();
      expect(c.pageStart!).toBeLessThanOrEqual(c.pageEnd!);
    }
  });

  it('without pageOfLine all page fields are null (back-compat)', () => {
    const r = chunkMarkdown('测试合同', MD);
    for (const p of r.parents) expect(p.pageStart).toBeNull();
    for (const c of r.children) expect(c.pageEnd).toBeNull();
    for (const t of r.toc) expect(t.pageStart).toBeNull();
  });
});

describe('rrfFuse — reciprocal-rank fusion (final spec D7)', () => {

  it('an id ranked top in both legs beats single-leg ids', () => {
    const scores = rrfFuse([
      ['a', 'b', 'c'],
      ['a', 'c', 'd'],
    ]);
    const sorted = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(sorted[0]).toBe('a');
    expect(scores.get('d')).toBeLessThan(scores.get('c')!);
  });

  it('handles empty legs', () => {
    expect(rrfFuse([[], []]).size).toBe(0);
  });
});
