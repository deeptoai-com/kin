/**
 * Shared upload size limits + helpers (上传链路根治 PRD §3.2).
 *
 * One source of truth for BOTH entry points so they behave consistently
 * (acceptance: "两个入口一致受益"):
 *  - the chat composer (attach-to-chat, workspace files route)
 *  - the Documents page (RAG/KB ingest, S3/MinIO direct upload)
 *
 * Plain module (no server-only imports) so the route handler AND the browser
 * components can both import it. The browser uses these constants as the FIRST
 * gate (reject before any bytes leave the page); the server route re-checks
 * `Content-Length` as a backstop.
 */

const MB = 1024 * 1024;

/**
 * Max size for a file attached to a chat message (composer → workspace).
 * Rich docs over the inline-parse cap (25MB) won't get a text version anyway,
 * and the chat path is not the bulk-ingest path — big files belong in the KB.
 */
export const CHAT_ATTACH_MAX_BYTES = 50 * MB;

/**
 * Max size for a Documents-page (RAG/KB) upload. Larger than chat attach since
 * this is the bulk-ingest tier, but still bounded so a 200MB direct-to-MinIO
 * upload fails fast with a clear "超限" instead of stalling at 1% (BUG-006).
 */
export const DOC_UPLOAD_MAX_BYTES = 100 * MB;

/** Human-readable bytes, e.g. 52428800 → "50 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  const decimals = value >= 10 || power === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[power]}`;
}

/**
 * Clear, user-facing over-limit message. `kind` tailors the escape hatch:
 * the chat path points users at the knowledge base for big files.
 */
export function tooLargeMessage(maxBytes: number, kind: 'chat' | 'doc' = 'chat'): string {
  const cap = formatBytes(maxBytes);
  return kind === 'chat'
    ? `文件超过 ${cap} 上限，大文件请用「知识库」批量入库。`
    : `文件超过 ${cap} 上限，请压缩或拆分后再上传。`;
}

/** True if the file is within the limit (i.e. allowed to upload). */
export function isWithinLimit(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes <= maxBytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// 返工2 — 格式白名单 (format whitelist).
//
// The workspace is for documents / text / media the Agent can actually use.
// Binaries, executables, disk images and archives are pointless (and a footgun —
// a user uploaded a `.dmg`). We allow a curated, generous set and default-deny the
// rest, with an explicit block-list so notorious binaries are never let through
// even if some future allow entry overlaps. Threat model = prevent mistakes (北
// 极星: 防误操作), not lock down attackers.
// ─────────────────────────────────────────────────────────────────────────────

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Curated allow-list (lowercase, no dot). Generous across docs/text/code/media. */
const ALLOWED_EXTS = new Set<string>([
  // rich documents (parsed → markdown)
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'rtf', 'odt', 'ods', 'odp', 'epub', 'pages', 'key', 'numbers',
  // plain text / data
  'txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'json', 'jsonl', 'log', 'rst', 'tex', 'bib', 'srt', 'vtt',
  // code / config text
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'ipynb', 'java', 'kt', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs',
  'go', 'rs', 'rb', 'php', 'swift', 'sh', 'bash', 'zsh', 'fish', 'sql', 'html', 'htm', 'css', 'scss', 'less',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml', 'vue', 'svelte', 'dart', 'r', 'lua', 'pl', 'pm',
  'scala', 'clj', 'cljs', 'ex', 'exs', 'erl', 'hs', 'ml', 'gradle', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'heif', 'ico', 'avif',
  // audio
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff',
  // video
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', '3gp',
]);

/** Notorious binaries / executables / disk images / archives — always blocked. */
const BLOCKED_EXTS = new Set<string>([
  // disk images / installers / packages
  'dmg', 'iso', 'img', 'vhd', 'vmdk', 'vdi', 'qcow2', 'msi', 'pkg', 'deb', 'rpm', 'apk', 'cab', 'appimage',
  // executables / libraries / objects
  'exe', 'app', 'dll', 'so', 'dylib', 'bin', 'com', 'bat', 'cmd', 'scr', 'sys', 'o', 'a', 'lib', 'obj',
  'class', 'jar', 'wasm', 'node', 'msix', 'apkm',
  // archives (倾向先挡 — Agent can't use them directly; ask user to extract)
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz', 'lzma', 'z', 'arj', 'ace',
]);

/**
 * Whether this file type is allowed into the workspace. Extension-first (the most
 * reliable signal); falls back to the MIME family for extensionless-but-known
 * media/text. Unknown → blocked (default-deny).
 */
export function isAllowedType(name: string, mime?: string): boolean {
  const ext = extOf(name);
  if (ext && BLOCKED_EXTS.has(ext)) return false;
  if (ext && ALLOWED_EXTS.has(ext)) return true;
  // No / unknown extension: allow only if the MIME says image/audio/video/text.
  if (mime && /^(image|audio|video|text)\//i.test(mime)) return true;
  return false;
}

/** Clear, user-facing message for a rejected file type. */
export function unsupportedTypeMessage(name: string): string {
  const ext = extOf(name);
  return ext
    ? `不支持的文件格式（.${ext}）：仅支持文档 / 文本 / 代码 / 图片 / 音视频，二进制与压缩包请勿上传。`
    : '不支持的文件格式：仅支持文档 / 文本 / 代码 / 图片 / 音视频。';
}
