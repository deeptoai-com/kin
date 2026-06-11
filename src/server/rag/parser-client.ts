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

/** Strip the sidecar's page markers for clean chunking (page-range mapping = follow-up). */
export function stripPageMarkers(markdown: string): string {
  return markdown.replace(/<!-- odl-page \d+ -->\n?/g, '');
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
