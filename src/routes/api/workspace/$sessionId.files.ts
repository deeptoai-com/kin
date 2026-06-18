/**
 * Workspace Files API
 *
 * GET /api/workspace/:sessionId/files - List all files in workspace
 */

import { createFileRoute } from '@tanstack/react-router';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';
import { validateRelativePath } from '~/server/security/validate-relative-path';
import { needsParse, parseToMarkdown } from '~/server/documents/document-parser';
import { writeParseStatus } from '~/server/documents/parse-status';
import { CHAT_ATTACH_MAX_BYTES, isAllowedType, tooLargeMessage, unsupportedTypeMessage } from '~/lib/upload-limits';

/** Server-side upload ceiling (PRD §3.2). Env-overridable; client gates first. */
const MAX_UPLOAD_BYTES = Number(process.env.WORKSPACE_UPLOAD_MAX_BYTES ?? CHAT_ATTACH_MAX_BYTES);

/**
 * Background markdown parse (PRD §3.1): runs AFTER the POST has already
 * responded. Materialises `<name>.md`, moves the original binary OUT of the
 * Agent-visible workspace into hidden `.uploads/`, and records the outcome in
 * the parse-status sidecar so the composer chip can poll it. Never throws —
 * the upload already succeeded; a parse failure just leaves no `.md`.
 */
async function backgroundParse(params: {
  workspacePath: string;
  fullFilePath: string;
  filePath: string;
  byteLength: number;
  startedAt: number;
}): Promise<void> {
  const { workspacePath, fullFilePath, filePath, byteLength, startedAt } = params;
  const mdRelPath = `${filePath}.md`;
  const stashOriginal = async () => {
    const hiddenAbs = path.join(workspacePath, '.uploads', filePath);
    await mkdir(path.dirname(hiddenAbs), { recursive: true });
    await rename(fullFilePath, hiddenAbs);
  };
  try {
    const parsed = await parseToMarkdown(fullFilePath, filePath, byteLength);
    if (parsed.ok) {
      await writeFile(path.join(workspacePath, mdRelPath), parsed.markdown, 'utf8');
      await stashOriginal();
      await writeParseStatus(workspacePath, filePath, {
        status: 'parsed', startedAt, updatedAt: Date.now(),
        parsedPath: mdRelPath, engine: parsed.engine ?? undefined,
      });
    } else if (parsed.reason === 'empty') {
      // Scanned / image-only doc: guiding stub so the Agent reads a deterministic
      // .md and tells the user, instead of failing silently. OCR is a follow-up.
      await writeFile(path.join(workspacePath, mdRelPath), buildScannedDocStub(path.basename(filePath)), 'utf8');
      await stashOriginal();
      await writeParseStatus(workspacePath, filePath, {
        status: 'scanned', startedAt, updatedAt: Date.now(),
        parsedPath: mdRelPath, engine: 'none-scanned',
      });
      console.warn(`[Workspace API] No text layer for ${filePath} (likely scanned); wrote guiding stub.`);
    } else {
      // too-large-for-inline-parse / unsupported / genuine error: keep the original
      // in place (no .md). The chip shows a notice; the file is still in the workspace.
      await writeParseStatus(workspacePath, filePath, {
        status: 'failed', startedAt, updatedAt: Date.now(), error: parsed.error,
      });
      console.error(`[Workspace API] Parse skipped/failed for ${filePath}: ${parsed.error}`);
    }
  } catch (parseError) {
    await writeParseStatus(workspacePath, filePath, {
      status: 'failed', startedAt, updatedAt: Date.now(),
      error: parseError instanceof Error ? parseError.message : String(parseError),
    }).catch(() => {});
    console.error('[Workspace API] Parse error:', parseError);
  }
}

/**
 * Guiding stub written in place of a real `.md` when a PDF has no extractable
 * text layer (scanned / image-only). Gives the Agent a deterministic file to
 * land on (the binary-doc Read redirect points here) and a clear instruction to
 * tell the user — instead of a silent no-op. OCR is a roadmap follow-up.
 */
function buildScannedDocStub(originalName: string): string {
  return [
    `# ${originalName} — 无法按文本读取`,
    '',
    '> ⚠️ 该文档（PDF）似乎是**扫描件 / 图片型**，没有可提取的文字层，',
    '> 系统的文本解析器（markitdown）没有提取到任何文字。OCR 尚未启用。',
    '',
    '**给 AI 助手：** 这份文档无法作为文本读取。请如实告知用户——',
    '它是扫描/图片版 PDF，暂时无法按文本解析；建议用户提供带文字层的版本，',
    '或直接把需要处理的关键内容以文本形式贴出来。',
    '请勿反复尝试 Read 原始 PDF（模型网关会拒绝二进制文档内容并返回 400）。',
    '',
  ].join('\n');
}

/**
 * System files to exclude from workspace listings
 * These are internal SDK/session files that users shouldn't see
 */
const EXCLUDED_FILES = new Set([
  '.artifacts.json',
  'session.jsonl',
  '.DS_Store',
  'Thumbs.db',
]);

/**
 * Patterns for hidden/system directories to skip
 */
const EXCLUDED_DIR_PATTERNS = [
  /^\./, // Hidden directories (start with .)
  /^node_modules$/, // node_modules
  /^__pycache__$/, // Python cache
];

/**
 * Check if a file/directory should be excluded
 */
function shouldExclude(name: string, isDirectory: boolean): boolean {
  // Check exact matches for files
  if (!isDirectory && EXCLUDED_FILES.has(name)) {
    return true;
  }

  // Check patterns for directories
  if (isDirectory) {
    for (const pattern of EXCLUDED_DIR_PATTERNS) {
      if (pattern.test(name)) {
        return true;
      }
    }
  }

  // Exclude hidden files (start with .) except for common config files
  if (name.startsWith('.') && !isDirectory) {
    // Allow certain config files
    const allowedDotFiles = ['.gitignore', '.env.example', '.editorconfig'];
    if (!allowedDotFiles.includes(name)) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively list all files in a directory
 * Filters out system/hidden files for cleaner user experience
 */
async function listFilesRecursive(dirPath: string, basePath: string = ''): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip excluded files and directories
      if (shouldExclude(entry.name, entry.isDirectory())) {
        continue;
      }

      const relativePath = path.join(basePath, entry.name);
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively list subdirectory
        const subFiles = await listFilesRecursive(fullPath, relativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch (error) {
    // Directory might not exist yet
    console.error(`[Workspace API] Error reading directory ${dirPath}:`, error);
  }

  return files;
}

export const Route = createFileRoute('/api/workspace/$sessionId/files')({
  server: {
    handlers: {
      // GET /api/workspace/:sessionId/files - List workspace files
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId } = params;

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        // Get workspace directory
        // Path structure: {claudeHomePath}/sessions/{sdkSessionId}/workspace/
        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );

        // List all files in workspace
        const files = await listFilesRecursive(workspacePath);

        return Response.json({
          sessionId: session.id,
          sdkSessionId: session.sdkSessionId,
          workspacePath,
          files,
        });
      },
      // POST /api/workspace/:sessionId/files - Upload a file into workspace
      POST: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId } = params;

        // PRD §3.2: reject oversize uploads via Content-Length BEFORE buffering the
        // whole multipart body into memory (this is what hung on 200MB+ — BUG-002).
        // +1MB slack covers multipart boundary/field overhead; a precise file.size
        // check below is authoritative.
        const declaredLength = Number(request.headers.get('content-length') ?? 0);
        if (declaredLength && declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
          return new Response(
            JSON.stringify({ error: tooLargeMessage(MAX_UPLOAD_BYTES, 'chat') }),
            { status: 413, headers: { 'content-type': 'application/json' } }
          );
        }

        const formData = await request.formData();
        const file = formData.get('file');
        const rawFilePath = formData.get('filePath');
        const filePath = rawFilePath ? String(rawFilePath) : file instanceof File ? file.name : '';

        if (!(file instanceof File) || !filePath) {
          return new Response(
            JSON.stringify({ error: 'Missing file upload' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        if (!validateRelativePath(filePath)) {
          return new Response(
            JSON.stringify({ error: 'Invalid file path' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        // Precise size check (authoritative; the Content-Length gate above is a
        // cheap pre-filter that buys us out of buffering a huge body).
        if (file.size > MAX_UPLOAD_BYTES) {
          return new Response(
            JSON.stringify({ error: tooLargeMessage(MAX_UPLOAD_BYTES, 'chat') }),
            { status: 413, headers: { 'content-type': 'application/json' } }
          );
        }

        // 返工2: format whitelist server backstop — reject binaries/executables/
        // archives (.dmg/.exe/.zip/...) even if the client gate is bypassed.
        if (!isAllowedType(filePath, file.type)) {
          return new Response(
            JSON.stringify({ error: unsupportedTypeMessage(filePath) }),
            { status: 415, headers: { 'content-type': 'application/json' } }
          );
        }

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );
        const fullFilePath = path.join(workspacePath, filePath);

        try {
          await mkdir(path.dirname(fullFilePath), { recursive: true });
          const buffer = Buffer.from(await file.arrayBuffer());
          await writeFile(fullFilePath, buffer);

          // PRD §3.1: rich docs (pdf/docx/...) need a markdown parse before the Agent's
          // Read tool can use them — but that parse can take minutes (and used to block
          // the whole upload request → BUG-002). Now we respond IMMEDIATELY with
          // parseStatus 'parsing' and run the parse in the BACKGROUND, recording the
          // outcome in a sidecar the composer polls. Plain text/code needs no parse.
          let parseStatus: 'parsing' | undefined;
          if (needsParse(filePath)) {
            const startedAt = Date.now();
            await writeParseStatus(workspacePath, filePath, {
              status: 'parsing', startedAt, updatedAt: startedAt,
            });
            parseStatus = 'parsing';
            // Fire-and-forget: not awaited, so the response returns now. The server is a
            // long-lived Node process (not serverless), so the task runs to completion.
            void backgroundParse({
              workspacePath, fullFilePath, filePath, byteLength: buffer.byteLength, startedAt,
            });
          }

          return Response.json({
            sessionId: session.id,
            filePath,
            storedPath: fullFilePath,
            // parsedPath/engine are resolved later via the parse-status route (async parse).
            parseStatus,
          });
        } catch (error) {
          console.error('[Workspace API] Error writing file:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to upload file' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          );
        }
      },
    },
  },
});
