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
 *
 * Run locally:  JAVA_HOME=/opt/homebrew/opt/openjdk node parser-sidecar/server.mjs
 * Container:    see parser-sidecar/Dockerfile (bundles a headless JRE).
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

async function parsePdf(bytes, mode) {
  const dir = await mkdtemp(join(tmpdir(), 'odl-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, bytes);
    const args = [
      '-o', dir, '-f', 'markdown', '--image-output', 'off', '-q',
      '--markdown-page-separator', '<!-- odl-page %page-number% -->',
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
    send(404, { ok: false, error: 'not found' });
  } catch (err) {
    send(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => console.log(`[parser-sidecar] listening on :${PORT} (engine: opendataloader-pdf)`));
