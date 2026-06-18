/**
 * useWorkspaceUploads — composer attachment upload manager (上传链路根治 PRD §3.3).
 *
 * Owns the per-file upload lifecycle for the chat composer:
 *   uploading(%) → parsing → ready | scanned | error
 * with REAL progress (XHR upload.onprogress), per-file CANCEL (xhr.abort), a
 * client-side SIZE gate (before any bytes leave the page), and parse-status
 * POLLING (the upload route now parses rich docs in the background — PRD §3.1).
 *
 * Why a hook: the composer was a single 760-line file; this isolates the async
 * machinery (XHR handles, poll timers, abort/cleanup) behind a small surface so
 * the composer just renders chips + gates Send on `hasPending`.
 *
 * Reference: in-repo XHR-progress upload (`routes/agents/documents/route.tsx`)
 * and the drag/paste idiom in `references/.../fragments/components/chat-input.tsx`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_ATTACH_MAX_BYTES, isAllowedType, isWithinLimit, tooLargeMessage, unsupportedTypeMessage } from '~/lib/upload-limits';
import { getWorkspaceParseStatus } from '~/server/function/workspace-files.server';

export type UploadStatus =
  | 'uploading' // bytes in flight
  | 'parsing' // bytes stored, server parsing rich doc → markdown in background
  | 'ready' // usable attachment (plain file, or parsed rich doc)
  | 'scanned' // rich doc with no text layer (stub .md written; sendable + noticed)
  | 'error'; // size/network/server failure — not sendable

export interface UploadItem {
  /** Stable local id (also the React key). */
  id: string;
  name: string;
  /** Workspace-relative stored path (== file name). */
  path: string;
  /** Path the Agent should Read: parsed `.md` for rich docs, else `path`. */
  agentPath?: string;
  mimeType?: string;
  fileSize: number;
  status: UploadStatus;
  /** 0–100 during `uploading`. */
  progress: number;
  /** Fatal message (status 'error'). */
  error?: string;
  /** Non-fatal note shown on the chip (scanned PDF, parse-skipped, …). */
  notice?: string;
}

/** Attachment shape consumed by the send path (runConfig.custom.attachments). */
export interface ReadyAttachment {
  originalName: string;
  filePath: string;
  mimeType?: string;
  fileSize?: number;
}

interface UploadResponse {
  filePath: string;
  parseStatus?: 'parsing';
}

const POLL_INTERVAL_MS = 1500;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `up_${Date.now().toString(36)}_${counter}`;
}

export function useWorkspaceUploads(sessionId: string | null) {
  const [items, setItems] = useState<UploadItem[]>([]);
  // Imperative handles kept out of state so updates don't re-render: xhr (to
  // abort an in-flight upload) and poll timers (to stop polling on cancel).
  const handlesRef = useRef<Map<string, { xhr?: XMLHttpRequest; timer?: ReturnType<typeof setTimeout> }>>(new Map());

  const patch = useCallback((id: string, update: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...update } : it)));
  }, []);

  const cleanupHandle = useCallback((id: string) => {
    const h = handlesRef.current.get(id);
    if (h?.timer) clearTimeout(h.timer);
    handlesRef.current.delete(id);
  }, []);

  // Poll the parse-status route until the rich-doc parse reaches a terminal state.
  const pollParse = useCallback(
    (id: string, filePath: string) => {
      if (!sessionId) return;
      const tick = async () => {
        try {
          const statuses = await getWorkspaceParseStatus({ data: { sessionId, paths: [filePath] } });
          // The session may have switched (or the chip been dismissed) while we
          // awaited — if this id is no longer tracked, stop (don't reschedule onto
          // a dead session).
          if (!handlesRef.current.has(id)) return;
          const st = statuses?.[filePath];
          if (!st || st.status === 'parsing') {
            const timer = setTimeout(tick, POLL_INTERVAL_MS);
            handlesRef.current.set(id, { timer });
            return;
          }
          cleanupHandle(id);
          if (st.status === 'parsed') {
            patch(id, { status: 'ready', agentPath: st.parsedPath, progress: 100, notice: undefined });
          } else if (st.status === 'scanned') {
            patch(id, {
              status: 'scanned',
              agentPath: st.parsedPath,
              progress: 100,
              notice: '扫描件 PDF，无文字层，AI 暂时无法按文本读取',
            });
          } else {
            // Parse failed: the file IS uploaded, just no text version. Keep it
            // sendable (original path) but warn the AI may not read it as text.
            patch(id, {
              status: 'ready',
              agentPath: filePath,
              progress: 100,
              notice: '未能解析为文本，AI 可能无法读取其内容',
            });
          }
        } catch {
          // transient: retry until the staleness ceiling flips the sidecar to failed
          if (!handlesRef.current.has(id)) return;
          const timer = setTimeout(tick, POLL_INTERVAL_MS);
          handlesRef.current.set(id, { timer });
        }
      };
      const timer = setTimeout(tick, POLL_INTERVAL_MS);
      handlesRef.current.set(id, { timer });
    },
    [sessionId, patch, cleanupHandle],
  );

  const uploadOne = useCallback(
    (id: string, file: File) => {
      if (!sessionId) {
        patch(id, { status: 'error', error: '请先创建会话后再上传' });
        return;
      }
      const xhr = new XMLHttpRequest();
      handlesRef.current.set(id, { xhr });

      const form = new FormData();
      form.append('file', file);
      form.append('filePath', file.name);

      xhr.open('POST', `/api/workspace/${sessionId}/files`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          patch(id, { progress: Math.min(99, Math.round((e.loaded / e.total) * 100)) });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let result: UploadResponse | null = null;
          try {
            result = JSON.parse(xhr.responseText) as UploadResponse;
          } catch {
            /* fall through to error below */
          }
          if (!result) {
            patch(id, { status: 'error', error: '服务器响应异常' });
            cleanupHandle(id);
            return;
          }
          patch(id, { path: result.filePath, progress: 100 });
          if (result.parseStatus === 'parsing') {
            patch(id, { status: 'parsing' });
            pollParse(id, result.filePath);
          } else {
            // Plain text/code: immediately usable, Agent reads it directly.
            patch(id, { status: 'ready', agentPath: result.filePath });
            cleanupHandle(id);
          }
        } else {
          let message = `上传失败（HTTP ${xhr.status}）`;
          try {
            const payload = JSON.parse(xhr.responseText);
            if (payload?.error) message = payload.error;
          } catch {
            /* keep default */
          }
          patch(id, { status: 'error', error: message });
          cleanupHandle(id);
        }
      };
      xhr.onerror = () => {
        patch(id, { status: 'error', error: '上传失败（网络错误）' });
        cleanupHandle(id);
      };
      // onabort is handled by dismiss() (it removes the item), so no patch here.
      xhr.send(form);
    },
    [sessionId, patch, pollParse, cleanupHandle],
  );

  /** Add files: type- + size-gate each (返工2/PRD §3.2), then upload the allowed ones. */
  const addFiles = useCallback(
    (files: File[]) => {
      const newItems: UploadItem[] = [];
      const toUpload: Array<{ id: string; file: File }> = [];
      for (const file of files) {
        const id = nextId();
        const base: UploadItem = {
          id,
          name: file.name,
          path: file.name,
          mimeType: file.type,
          fileSize: file.size,
          status: 'uploading',
          progress: 0,
        };
        // 返工2: format whitelist — block .dmg/.exe/archives/etc. before upload.
        if (!isAllowedType(file.name, file.type)) {
          newItems.push({ ...base, status: 'error', error: unsupportedTypeMessage(file.name) });
          continue;
        }
        if (!isWithinLimit(file.size, CHAT_ATTACH_MAX_BYTES)) {
          newItems.push({ ...base, status: 'error', error: tooLargeMessage(CHAT_ATTACH_MAX_BYTES, 'chat') });
          continue;
        }
        newItems.push(base);
        toUpload.push({ id, file });
      }
      setItems((prev) => [...prev, ...newItems]);
      for (const { id, file } of toUpload) uploadOne(id, file);
    },
    [uploadOne],
  );

  /** Cancel an in-flight upload / stop a parse / remove a finished chip. */
  const dismiss = useCallback(
    (id: string) => {
      const h = handlesRef.current.get(id);
      h?.xhr?.abort();
      if (h?.timer) clearTimeout(h.timer);
      handlesRef.current.delete(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
    },
    [],
  );

  /** Reset everything (session switch / after attachments persisted). */
  const clear = useCallback(() => {
    for (const [, h] of handlesRef.current) {
      h.xhr?.abort();
      if (h.timer) clearTimeout(h.timer);
    }
    handlesRef.current.clear();
    setItems([]);
  }, []);

  // Start each session fresh, and drop all in-flight work when the session
  // changes (or the composer unmounts). The body clears items on session switch;
  // the cleanup aborts XHRs/timers so nothing leaks across sessions.
  const handlesForCleanup = handlesRef;
  useEffect(() => {
    setItems([]);
    return () => {
      for (const [, h] of handlesForCleanup.current) {
        h.xhr?.abort();
        if (h.timer) clearTimeout(h.timer);
      }
      handlesForCleanup.current.clear();
    };
  }, [sessionId, handlesForCleanup]);

  const hasPending = items.some((it) => it.status === 'uploading' || it.status === 'parsing');
  const hasError = items.some((it) => it.status === 'error');
  const readyAttachments: ReadyAttachment[] = items
    .filter((it) => it.status === 'ready' || it.status === 'scanned')
    .map((it) => ({
      originalName: it.name,
      filePath: it.agentPath ?? it.path,
      mimeType: it.mimeType,
      fileSize: it.fileSize,
    }));

  return { items, addFiles, dismiss, clear, hasPending, hasError, readyAttachments };
}
