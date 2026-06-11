/**
 * Parser sidecar client (U1, ingest-UX spec §7) — PDF → Markdown via the dedicated
 * sidecar container (which owns the Java/opendataloader dependency).
 *
 * PARSER_SIDECAR_URL: http://parser:7800 in compose; http://127.0.0.1:7800 local dev
 * (run: JAVA_HOME=/opt/homebrew/opt/openjdk node parser-sidecar/server.mjs).
 */

export type ParseMode = 'structured' | 'simple' | 'probe';

export interface SidecarParseResult {
  ok: boolean;
  mode: ParseMode;
  pages: number;
  chars: number;
  ms: number;
  markdown?: string;
  recommend?: { method: 'structured' | 'simple' | 'ocr'; reason: string };
  error?: string;
}

function sidecarUrl(): string {
  return (process.env.PARSER_SIDECAR_URL || 'http://127.0.0.1:7800').replace(/\/$/, '');
}

export function sidecarConfigured(): boolean {
  return Boolean(process.env.PARSER_SIDECAR_URL);
}

/** Strip the sidecar's page markers (when the page map is not needed). */
export function stripPageMarkers(markdown: string): string {
  return markdown.replace(/<!-- odl-page \d+ -->\n?/g, '');
}

/** Page breakpoint: stripped-markdown line `line` (0-based) is where `page` starts. */
export interface PageBreak {
  page: number;
  line: number;
}

/**
 * Strip the sidecar's `<!-- odl-page N -->` markers AND record where each page begins
 * in the stripped text. Marker semantics (verified against opendataloader output):
 * the marker is a standalone line at the START of page N — content after it belongs
 * to page N. The map is persisted on the document (documents.page_map) so re-ingests
 * can recompute chunk page ranges without re-parsing.
 */
export function extractPageMap(marked: string): { markdown: string; pageMap: PageBreak[] } {
  const out: string[] = [];
  const pageMap: PageBreak[] = [];
  for (const line of marked.split(/\r?\n/)) {
    const m = line.match(/^<!-- odl-page (\d+) -->\s*$/);
    if (m) {
      pageMap.push({ page: Number(m[1]), line: out.length });
      continue;
    }
    // Inline markers (not produced by the CLI today, but cheap to guard): drop without
    // touching line structure so breakpoint offsets stay valid.
    out.push(line.includes('<!-- odl-page') ? line.replace(/<!-- odl-page \d+ -->/g, '') : line);
  }
  return { markdown: out.join('\n'), pageMap };
}

/** Binary-search lookup: stripped-markdown line index → page number (null before page 1 / no map). */
export function pageLookup(pageMap: PageBreak[] | null | undefined): (line: number) => number | null {
  if (!pageMap?.length) return () => null;
  return (line) => {
    let lo = 0;
    let hi = pageMap.length - 1;
    let page: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pageMap[mid].line <= line) {
        page = pageMap[mid].page;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return page;
  };
}

export async function parsePdfViaSidecar(
  bytes: Uint8Array | Buffer,
  mode: Exclude<ParseMode, 'probe'> = 'structured',
  opts: { timeoutMs?: number } = {},
): Promise<SidecarParseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10 * 60_000);
  try {
    const res = await fetch(`${sidecarUrl()}/parse?mode=${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes as BodyInit,
      signal: controller.signal,
    });
    const json = (await res.json()) as SidecarParseResult;
    if (!res.ok || !json.ok) {
      return { ok: false, mode, pages: 0, chars: 0, ms: 0, error: json.error ?? `HTTP ${res.status}` };
    }
    return json;
  } catch (err) {
    return {
      ok: false, mode, pages: 0, chars: 0, ms: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fast text-layer probe → engine recommendation (spec §3 "system recommends"). */
export async function probePdfViaSidecar(bytes: Uint8Array | Buffer): Promise<SidecarParseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${sidecarUrl()}/parse?mode=probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes as BodyInit,
      signal: controller.signal,
    });
    return (await res.json()) as SidecarParseResult;
  } catch (err) {
    return { ok: false, mode: 'probe', pages: 0, chars: 0, ms: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
