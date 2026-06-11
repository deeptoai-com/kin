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
