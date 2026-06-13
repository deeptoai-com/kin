#!/usr/bin/env node
/**
 * Parser sidecar — PDF → Markdown over HTTP (ingest-UX spec §7, U1).
 *
 * Owns the Java dependency (opendataloader-pdf) so the app/worker images stay slim
 * (Owner decision 2026-06-11: dedicated sidecar; the future OCR engine plugs in here
 * too as another route). Zero npm deps besides the engine; plain node http.
 *
 *   GET  /health                   → { ok, engine }
 *   POST /parse?mode=structured    → body: raw PDF bytes
 *        mode=structured : full layout analysis (headings/tables/reading order)
 *        mode=simple     : fast text-layer extraction (--reading-order off)
 *        mode=probe      : like simple but returns stats only (no markdown) — feeds
 *                          the "system recommends an engine" UX (spec §3)
 *        → { ok, engine, mode, pages, chars, ms, markdown? , recommend? }
 *   POST /render?dpi=150&maxPages=100  → body: raw PDF bytes (OCR module O1-b)
 *        Rasterize each page to PNG (pdftoppm). Feeds BOTH the VLM OCR input AND the
 *        converter's left-pane original-page display.
 *        → { ok, engine, dpi, count, truncated, pages: [{ page, image(base64 png) }] }
 *   POST /tables?maxPages=100          → body: raw PDF bytes (OCR module table-v3)
 *        Detect table LOCATIONS via JSON output (not extraction): page + bbox + rows×cols.
 *        The converter flags these + overlays bbox; VLM does the actual reading.
 *        → { ok, engine, count, tables: [{ page, bbox:[x0,y0,x1,y1]pt, rows, cols }] }
 *
 * Run locally:  JAVA_HOME=/opt/homebrew/opt/openjdk node parser-sidecar/server.mjs
 *               (also needs poppler `pdftoppm` on PATH for /render)
 * Container:    see parser-sidecar/Dockerfile (bundles a headless JRE + poppler-utils).
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PARSER_PORT) || 7800;
const MAX_BODY = Number(process.env.PARSER_MAX_BYTES) || 200 * 1024 * 1024; // 200MB
const TIMEOUT_MS = Number(process.env.PARSER_TIMEOUT_MS) || 10 * 60_000; // 10min
const CLI = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '.bin', 'opendataloader-pdf');

/** Per-page marker so ingest can map chunks → page ranges later. */
export const PAGE_MARK = (n) => `<!-- odl-page ${n} -->`;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}\n${String(stderr).slice(0, 500)}`)) : resolve(String(stdout)),
    );
  });
}

const MAX_RENDER_PAGES = Number(process.env.PARSER_MAX_RENDER_PAGES) || 100;

/** PDF → per-page PNG via poppler `pdftoppm` (OCR module O1-b). */
function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(`${cmd}: ${err.message}\n${String(stderr).slice(0, 500)}`)) : resolve(),
    );
  });
}

/** Detect tables via the JSON output (OCR module table-v3): location only, not extraction. */
async function detectTables(bytes, maxPages) {
  const dir = await mkdtemp(join(tmpdir(), 'tbl-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, bytes);
    const args = ['-o', dir, '-f', 'json', '--table-method', 'cluster', '-q'];
    if (maxPages) args.push('--pages', `1-${maxPages}`);
    const t0 = Date.now();
    await run([...args, input]);
    const jsonFile = (await readdir(dir)).find((f) => f.endsWith('.json'));
    if (!jsonFile) return { tables: [], ms: Date.now() - t0 };
    const doc = JSON.parse(await readFile(join(dir, jsonFile), 'utf8'));
    const tables = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (String(n.type || '').toLowerCase().includes('table') && Array.isArray(n['bounding box'])) {
        tables.push({
          page: n['page number'] ?? null,
          bbox: n['bounding box'], // [x0,y0,x1,y1] in PDF points (y from bottom)
          rows: n['number of rows'] ?? null,
          cols: n['number of columns'] ?? null,
        });
      }
      if (n.kids) walk(n.kids);
      if (n.children) walk(n.children);
    };
    walk(doc);
    return { tables, ms: Date.now() - t0 };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderPdf(bytes, dpi, maxPages, onlyPage) {
  const dir = await mkdtemp(join(tmpdir(), 'render-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, bytes);
    const t0 = Date.now();
    // pdftoppm -png -r <dpi> [-f N -l N | -l maxPages] input.pdf <dir>/page → page-N.png …
    // onlyPage → render that single page (lazy render for deep pages beyond the bulk cap).
    const range = onlyPage ? ['-f', String(onlyPage), '-l', String(onlyPage)] : ['-l', String(maxPages)];
    await runCmd('pdftoppm', ['-png', '-r', String(dpi), ...range, input, join(dir, 'page')]);
    const files = (await readdir(dir))
      .filter((f) => f.startsWith('page') && f.endsWith('.png'))
      .map((f) => ({ f, n: Number((f.match(/-(\d+)\.png$/) || [])[1] || 0) }))
      .sort((a, b) => a.n - b.n);
    const pages = [];
    for (const { f, n } of files) {
      pages.push({ page: n, image: (await readFile(join(dir, f))).toString('base64') });
    }
    return { pages, ms: Date.now() - t0 };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function parsePdf(bytes, mode) {
  const dir = await mkdtemp(join(tmpdir(), 'odl-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, bytes);
    const args = [
      '-o', dir, '-f', 'markdown', '--image-output', 'off', '-q',
      '--markdown-page-separator', '<!-- odl-page %page-number% -->',
      // Tables: `cluster` detects BORDERLESS tables (financial statements align by
      // whitespace, not borders — border-based misses them and flattens to prose).
      // `--markdown-with-html` emits <table> for complex/multi-span tables that markdown
      // pipes can't represent. Together: faithful table capture for converter + RAG.
      '--table-method', 'cluster',
      '--markdown-with-html',
    ];
    if (mode !== 'structured') args.push('--reading-order', 'off');
    const t0 = Date.now();
    await run([...args, input]);
    const md = (await readdir(dir)).find((f) => f.endsWith('.md'));
    const markdown = md ? await readFile(join(dir, md), 'utf8') : '';
    const pages = (markdown.match(/<!-- odl-page \d+ -->/g) || []).length;
    const chars = markdown.replace(/<!-- odl-page \d+ -->/g, '').replace(/\s+/g, '').length;
    return { markdown, pages, chars, ms: Date.now() - t0 };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Engine recommendation heuristic (spec §3): near-zero text per page → scanned. */
function recommend(pages, chars, markdown) {
  if (pages > 0 && chars / pages < 30) return { method: 'ocr', reason: '每页文字极少，疑似扫描件/图片型 PDF' };
  const headings = (markdown.match(/^#{1,6} /gm) || []).length;
  if (headings >= Math.max(3, pages / 10) || /\n\|.+\|\n/.test(markdown)) {
    return { method: 'structured', reason: '检测到标题层级/表格，建议结构化解析' };
  }
  return { method: 'simple', reason: '纯文本为主，快速解析即可' };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(200, { ok: true, engine: 'opendataloader-pdf' });
    }
    if (req.method === 'POST' && url.pathname === '/parse') {
      const mode = url.searchParams.get('mode') || 'structured';
      if (!['structured', 'simple', 'probe'].includes(mode)) return send(400, { ok: false, error: `bad mode ${mode}` });
      const bytes = await readBody(req);
      if (bytes.length === 0) return send(400, { ok: false, error: 'empty body' });
      const r = await parsePdf(bytes, mode === 'probe' ? 'simple' : mode);
      const base = { ok: true, engine: 'opendataloader-pdf', mode, pages: r.pages, chars: r.chars, ms: r.ms };
      if (mode === 'probe') return send(200, { ...base, recommend: recommend(r.pages, r.chars, r.markdown) });
      return send(200, { ...base, markdown: r.markdown });
    }
    if (req.method === 'POST' && url.pathname === '/tables') {
      const maxPages = Math.min(Number(url.searchParams.get('maxPages')) || MAX_RENDER_PAGES, 500);
      const bytes = await readBody(req);
      if (bytes.length === 0) return send(400, { ok: false, error: 'empty body' });
      const r = await detectTables(bytes, maxPages);
      return send(200, { ok: true, engine: 'opendataloader-pdf', count: r.tables.length, ms: r.ms, tables: r.tables });
    }
    if (req.method === 'POST' && url.pathname === '/render') {
      const dpi = Math.min(Math.max(Number(url.searchParams.get('dpi')) || 150, 72), 300);
      const maxPages = Math.min(Number(url.searchParams.get('maxPages')) || MAX_RENDER_PAGES, MAX_RENDER_PAGES);
      const onlyPage = Number(url.searchParams.get('page')) || 0; // single-page lazy render
      const bytes = await readBody(req);
      if (bytes.length === 0) return send(400, { ok: false, error: 'empty body' });
      const r = await renderPdf(bytes, dpi, maxPages, onlyPage > 0 ? onlyPage : undefined);
      return send(200, {
        ok: true,
        engine: 'pdftoppm',
        dpi,
        count: r.pages.length,
        truncated: r.pages.length >= maxPages,
        ms: r.ms,
        pages: r.pages,
      });
    }
    send(404, { ok: false, error: 'not found' });
  } catch (err) {
    send(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => console.log(`[parser-sidecar] listening on :${PORT} (engine: opendataloader-pdf)`));
