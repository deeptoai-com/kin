/**
 * Server-side document parsing pipeline (F2 — file-upload foundation).
 *
 * Standard pattern (LobeChat `file-loaders` / onyx MarkItDown / open-webui loaders):
 * at upload, parse rich documents (pdf/docx/...) to Markdown TEXT and materialise the
 * `.md` into the session workspace, so the Agent's existing Read/Grep tools can use it.
 * Deterministic, cached, and owned by us — unlike handing the model a convert tool at
 * query time. Because the pipeline is ours, parsers are tried in order: if markitdown
 * yields nothing (e.g. a scanned PDF), a future OCR parser can be appended to the chain.
 *
 * Safety: the parser runs an untrusted file in a child process with a hard timeout, an
 * output-size cap, and a SECRET-FREE env (no ANTHROPIC_AUTH_TOKEN etc. — defense-in-depth,
 * mirroring the worker's buildSafeEnv). Threat model = semi-trusted colleagues (see
 * CLAUDE.md north star). Hardening follow-up: route this through the srt/ExecutionRuntime
 * sandbox like Bash/Python tools.
 */
import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = Number(process.env.DOC_PARSE_TIMEOUT_MS ?? 60_000);
const DEFAULT_MAX_BYTES = Number(process.env.DOC_PARSE_MAX_BYTES ?? 25 * 1024 * 1024); // 25MB
const MAX_OUTPUT_BYTES = Number(process.env.DOC_PARSE_MAX_OUTPUT_BYTES ?? 16 * 1024 * 1024); // 16MB

/** Rich extensions we parse to markdown. Plain-text/code is read directly by the Agent. */
const RICH_EXT = new Set([
  'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'rtf', 'odt', 'epub',
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** True if this file needs server-side parsing before the Agent can read it as text. */
export function needsParse(filename: string): boolean {
  return RICH_EXT.has(extOf(filename));
}

export interface ParseResult {
  ok: boolean;
  engine: string | null;
  markdown: string;
  error?: string;
  /**
   * When `ok` is false, why the parse produced no text — lets callers special-case
   * scanned/image-only PDFs (`empty`) versus genuine failures (`error`).
   */
  reason?: 'empty' | 'too-large' | 'unsupported' | 'error';
}

interface DocParser {
  name: string;
  canHandle: (ext: string) => boolean;
  run: (absPath: string, timeoutMs: number) => Promise<string>;
}

/** Minimal, secret-free env for the parser subprocess (defense-in-depth). */
function safeEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: process.env.LANG ?? 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
  };
}

// markitdown is installed in the runtime image (Dockerfile: `pip install markitdown-mcp`,
// which pulls in the `markitdown` library). Invoke the library directly so we don't depend
// on a CLI entry point being on PATH.
const MARKITDOWN_PY = [
  'import sys',
  'from markitdown import MarkItDown',
  'sys.stdout.write(MarkItDown().convert(sys.argv[1]).text_content or "")',
].join('\n');

function runChild(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: safeEnv(), windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : stdout.toString('utf8'));
      },
    );
  });
}

/** Ordered parser chain — first non-empty result wins; append OCR here later. */
const PARSERS: DocParser[] = [
  {
    name: 'markitdown',
    canHandle: (ext) => RICH_EXT.has(ext),
    run: (absPath, timeoutMs) => runChild('python3', ['-c', MARKITDOWN_PY, absPath], timeoutMs),
  },
  // Future fallback for scanned PDFs / images:
  // { name: 'ocr', canHandle: (ext) => ext === 'pdf', run: (absPath, t) => runChild('ocrmypdf'|'tesseract', ...) },
];

/**
 * Parse a document file to Markdown using the parser chain.
 * NEVER throws: on failure returns `{ ok: false }` so the upload itself still succeeds —
 * the original file is kept; the Agent just won't have a text version of it.
 */
export async function parseToMarkdown(
  absPath: string,
  filename: string,
  sizeBytes: number,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<ParseResult> {
  const ext = extOf(filename);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!needsParse(filename)) {
    return { ok: false, engine: null, markdown: '', error: 'not-a-rich-type', reason: 'unsupported' };
  }
  if (sizeBytes > maxBytes) {
    // Large docs are out of scope for inline parse — they belong to the RAG ingest tier.
    return { ok: false, engine: null, markdown: '', error: 'too-large-for-inline-parse', reason: 'too-large' };
  }

  let lastError: string | undefined;
  let sawEmpty = false;
  for (const parser of PARSERS) {
    if (!parser.canHandle(ext)) continue;
    try {
      const md = (await parser.run(absPath, timeoutMs)).trim();
      if (md.length > 0) {
        return { ok: true, engine: parser.name, markdown: md };
      }
      sawEmpty = true;
      lastError = `${parser.name}: empty output`;
      // empty → fall through to the next parser (e.g. OCR) in the chain
    } catch (error) {
      lastError = `${parser.name}: ${error instanceof Error ? error.message : String(error)}`;
      // try the next parser in the chain
    }
  }
  // `empty` = every matching parser ran but extracted no text (e.g. a scanned/
  // image-only PDF with no text layer). `error` = a parser actually failed.
  return {
    ok: false,
    engine: null,
    markdown: '',
    error: lastError ?? 'no-parser-matched',
    reason: sawEmpty ? 'empty' : 'error',
  };
}
