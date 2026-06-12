/**
 * Structure-aware Markdown chunker (final spec D10) — pure, unit-tested.
 *
 * Parents = heading-delimited sections (small-to-big retrieval returns these).
 * Children = paragraph-packed slices of a parent, ≤ CHILD_MAX_TOKENS each (safety margin
 * under Zhipu's 3072-token per-text hard limit).
 * Every chunk carries its `sectionPath` ("§ 标题 > 子标题") for citations and for the
 * free-tier contextual prefix (final spec D9).
 *
 * Page ranges: pass `pageOfLine` (built from the parser sidecar's page map, see
 * parser-client.ts pageLookup) and every chunk + toc entry gets pageStart/pageEnd for
 * citations — kb_search already renders them as "(p.X-Y)". Without it they stay null.
 */
import { estimateTokens } from './tier';

export const CHILD_MAX_TOKENS = 1_024;
export const PARENT_MAX_TOKENS = 2_500;

/** Line index (in the chunked markdown) → page number; null = unknown. */
export type PageOfLine = (lineIndex: number) => number | null;

export interface ParentChunk {
  sectionPath: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface ChildChunk {
  /** Index into the parents array (resolved to parentChunkId at insert time). */
  parentIndex: number;
  sectionPath: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface TocEntry {
  path: string;
  level: number;
  pageStart: number | null;
}

export interface ChunkResult {
  parents: ParentChunk[];
  children: ChildChunk[];
  toc: TocEntry[];
}

interface Section {
  path: string[];
  level: number;
  lines: string[];
  /** Original line index (pre-split) of each entry in `lines` — feeds pageOfLine. */
  lineNos: number[];
}

/** Split markdown into heading-scoped sections; preamble before any heading keeps the doc title. */
function splitSections(markdown: string, docTitle: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { path: [docTitle], level: 0, lines: [], lineNos: [] };
  const stack: Array<{ level: number; title: string }> = [];

  const allLines = markdown.split(/\r?\n/);
  for (let lineNo = 0; lineNo < allLines.length; lineNo++) {
    const line = allLines[lineNo];
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (current.lines.some((l) => l.trim() !== '')) sections.push(current);
      const level = m[1].length;
      const title = m[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      current = { path: [docTitle, ...stack.map((s) => s.title)], level, lines: [], lineNos: [] };
    } else {
      current.lines.push(line);
      current.lineNos.push(lineNo);
    }
  }
  if (current.lines.some((l) => l.trim() !== '')) sections.push(current);
  return sections;
}

/** Pack paragraphs into pieces of ≤ maxTokens, hard-splitting any oversized paragraph. */
function packParagraphs(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) pieces.push(buf.trim());
    buf = '';
  };

  for (let p of paragraphs) {
    // A single paragraph beyond the limit (e.g. a giant table) gets hard-split by lines.
    if (estimateTokens(p) > maxTokens) {
      flush();
      let part = '';
      for (const line of p.split('\n')) {
        if (estimateTokens(part) + estimateTokens(line) > maxTokens && part) {
          pieces.push(part.trim());
          part = '';
        }
        part += line + '\n';
      }
      if (part.trim()) pieces.push(part.trim());
      continue;
    }
    if (buf && estimateTokens(buf) + estimateTokens(p) > maxTokens) flush();
    buf += (buf ? '\n\n' : '') + p;
  }
  flush();
  return pieces;
}

/**
 * Locate each piece's [first,last] line within `lines` (a contiguous window of section
 * lines). Pieces come from packParagraphs(lines.join('\n')) so their non-empty lines are
 * verbatim source lines (modulo trim); pieces are in source order, so a monotone cursor
 * keeps duplicate lines (e.g. repeated table rows) anchored to the right occurrence.
 */
function locatePieces(
  pieces: string[],
  lines: string[],
  from: number,
  to: number,
): Array<{ start: number; end: number }> {
  let cursor = from;
  return pieces.map((piece) => {
    const pieceLines = piece.split('\n').map((l) => l.trim()).filter(Boolean);
    if (pieceLines.length === 0) return { start: cursor, end: cursor };
    let start = -1;
    for (let i = cursor; i <= to; i++) {
      if (lines[i].trim() === pieceLines[0]) {
        start = i;
        break;
      }
    }
    if (start === -1) start = Math.min(cursor, to); // defensive: keep ranges sane
    let at = start;
    for (let pi = 1; pi < pieceLines.length; pi++) {
      for (let i = at + 1; i <= to; i++) {
        if (lines[i].trim() === pieceLines[pi]) {
          at = i;
          break;
        }
      }
    }
    cursor = at + 1;
    return { start, end: at };
  });
}

const NO_PAGE: PageOfLine = () => null;

/**
 * Chunk a markdown document. `docTitle` roots every sectionPath (it is also the
 * context prefix root, so "费率为4.5%" embeds as "合同X > §3 退款政策\n费率为4.5%").
 */
export function chunkMarkdown(
  docTitle: string,
  markdown: string,
  pageOfLine: PageOfLine = NO_PAGE,
): ChunkResult {
  const sections = splitSections(markdown, docTitle);
  const parents: ParentChunk[] = [];
  const children: ChildChunk[] = [];
  const toc: TocEntry[] = [];

  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body) continue;
    const sectionPath = section.path.join(' > ');
    const firstContent = section.lines.findIndex((l) => l.trim() !== '');
    if (section.level > 0) {
      toc.push({
        path: sectionPath,
        level: section.level,
        pageStart: firstContent >= 0 ? pageOfLine(section.lineNos[firstContent]) : null,
      });
    }

    // Parent = the section, capped so small-to-big expansion stays context-friendly.
    // body is the TRIMMED join of section.lines — leading blank lines never match in
    // locatePieces (it compares non-empty lines only), so offsets stay aligned.
    const parentPieces = packParagraphs(body, PARENT_MAX_TOKENS);
    const parentLocs = locatePieces(parentPieces, section.lines, 0, section.lines.length - 1);
    for (let k = 0; k < parentPieces.length; k++) {
      const parentText = parentPieces[k];
      const { start, end } = parentLocs[k];
      const parentIndex = parents.length;
      parents.push({
        sectionPath,
        text: parentText,
        pageStart: pageOfLine(section.lineNos[start]),
        pageEnd: pageOfLine(section.lineNos[end]),
      });
      const childPieces = packParagraphs(parentText, CHILD_MAX_TOKENS);
      const childLocs = locatePieces(childPieces, section.lines, start, end);
      for (let c = 0; c < childPieces.length; c++) {
        children.push({
          parentIndex,
          sectionPath,
          text: childPieces[c],
          pageStart: pageOfLine(section.lineNos[childLocs[c].start]),
          pageEnd: pageOfLine(section.lineNos[childLocs[c].end]),
        });
      }
    }
  }
  return { parents, children, toc };
}
