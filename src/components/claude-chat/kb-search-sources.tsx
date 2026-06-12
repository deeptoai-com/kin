/**
 * kb_search citations (KB redesign 收尾): turn the model's [1][2] markers into
 * something a non-technical user can USE — a clickable chip that pops the source
 * (document title / section path / page range / passage text).
 *
 * Data comes from parsing the kb_search tool result envelope the worker formats:
 *   <retrieved-passages note="...">
 *   [1] 标题 — 章节路径 (p.21) \n 正文
 *   \n\n---\n\n
 *   [2] ...
 *   </retrieved-passages>
 * The format is ours (ws-query-worker.mjs), so parsing it client-side is stable and
 * costs zero extra tokens (no JSON duplication into the prompt).
 */

'use client';

import { BookOpen, FileText } from 'lucide-react';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '~/components/ui/hover-card';

export interface KbSource {
  n: number;
  title: string;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
}

/** Parse the worker's retrieved-passages envelope into structured sources. */
export function parseKbSearchResult(raw: unknown): KbSource[] | null {
  const text = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : '';
  if (!text.includes('<retrieved-passages')) return null;
  const inner = text
    .replace(/^[\s\S]*?<retrieved-passages[^>]*>\n?/, '')
    .replace(/\n?<\/retrieved-passages>[\s\S]*$/, '');
  const blocks = inner.split(/\n\n---\n\n/);
  const sources: KbSource[] = [];
  for (const block of blocks) {
    const m = block.match(/^\[(\d+)\]\s*([^\n]*)\n([\s\S]*)$/);
    if (!m) continue;
    let header = m[2].trim();
    let pageStart: number | null = null;
    let pageEnd: number | null = null;
    const pm = header.match(/\s*\(p\.(\d+)(?:-(\d+))?\)\s*$/);
    if (pm) {
      pageStart = Number(pm[1]);
      pageEnd = pm[2] ? Number(pm[2]) : pageStart;
      header = header.slice(0, pm.index).trim();
    }
    const dash = header.indexOf(' — ');
    const title = dash >= 0 ? header.slice(0, dash).trim() : header;
    const section = dash >= 0 ? header.slice(dash + 3).trim() : null;
    sources.push({ n: Number(m[1]), title, section, pageStart, pageEnd, text: m[3].trim() });
  }
  return sources.length > 0 ? sources : null;
}

function pageLabel(s: KbSource): string | null {
  if (s.pageStart == null) return null;
  return s.pageEnd && s.pageEnd !== s.pageStart ? `第 ${s.pageStart}-${s.pageEnd} 页` : `第 ${s.pageStart} 页`;
}

/** The [n] chip in answer text — hover/click pops the source passage. */
export function KbCitation({ n, source }: { n: number; source?: KbSource }) {
  if (!source) {
    return <sup className="mx-0.5 text-[11px] text-muted-foreground">[{n}]</sup>;
  }
  const pages = pageLabel(source);
  return (
    <HoverCard openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>
        <sup>
          <button
            type="button"
            className="mx-0.5 inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded bg-primary/15 px-1 align-super text-[10px] font-medium text-primary transition-colors hover:bg-primary/25"
          >
            {n}
          </button>
        </sup>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 p-3">
        <div className="flex items-start gap-2">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{source.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {source.section ?? ''}
              {source.section && pages ? ' · ' : ''}
              {pages ?? ''}
            </p>
          </div>
        </div>
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
          {source.text}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Source list card — rendered for the kb_search tool detail (drawer / inline). */
export function KbSearchSources({ sources }: { sources: KbSource[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">从你的知识库中检索到 {sources.length} 段相关内容：</p>
      {sources.map((s) => {
        const pages = pageLabel(s);
        return (
          <div key={s.n} data-kb-src={s.n} className="rounded-lg border border-border/70 p-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[11px] font-medium text-primary">
                {s.n}
              </span>
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.title}</span>
              {pages && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{pages}</span>
              )}
            </div>
            {s.section && <p className="mt-1 truncate pl-7 text-xs text-muted-foreground">{s.section}</p>}
            <p className="mt-1.5 line-clamp-3 pl-7 text-xs leading-relaxed text-foreground/80">{s.text}</p>
          </div>
        );
      })}
    </div>
  );
}
