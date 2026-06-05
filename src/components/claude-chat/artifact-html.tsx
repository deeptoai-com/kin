/**
 * HTML Artifact Renderer
 *
 * Renders HTML artifacts in a sandboxed iframe.
 *
 * Single-file HTML previews directly from a blob: URL. A multi-file app (HTML that
 * references RELATIVE <script src>/<link href> siblings) can't run from a blob:
 * preview — its scripts never load, so interaction (add/edit, localStorage, form
 * submit) fails. For those we offer 「运行预览」 (Phase C): the preview backend runs
 * the app in a per-session sandbox and returns a live URL we render here instead.
 * See docs/project/research/2026-06-real-preview-v1-implementation-plan.md.
 */

import { useEffect, useMemo, useState, type FC, type Ref } from 'react'
import { AlertTriangle, Info, Loader2, Play } from 'lucide-react'
import { startPreview } from '~/claude/adapters'
import { useSessionPreview } from '~/lib/hooks/use-session-workbench'

export interface HTMLArtifactProps {
  content: string
  title?: string
  iframeRef?: Ref<HTMLIFrameElement>
}

/**
 * True when the HTML references a relative <script src>/<link href> that a blob:
 * single-file preview cannot load. Absolute (http/https/protocol-relative),
 * data:/blob:, and in-page (#) refs DO resolve in the iframe, so they don't count.
 */
function referencesUnresolvableSiblings(html: string): boolean {
  if (!html) return false
  const refRe = /<(?:script[^>]*\bsrc|link[^>]*\bhref)\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = refRe.exec(html)) !== null) {
    const url = match[1].trim()
    if (!url) continue
    if (/^(https?:)?\/\//i.test(url)) continue // absolute / protocol-relative
    if (/^(data|blob|mailto|tel):/i.test(url)) continue
    if (url.startsWith('#')) continue // in-page anchor
    return true // a relative sibling file → won't resolve from a blob: URL
  }
  return false
}

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'

function statusLabel(status: string | undefined, error?: string): string {
  switch (status) {
    case 'detecting': return '检测项目…'
    case 'installing': return '安装依赖…'
    case 'building': return '构建中…'
    case 'ready': return '预览就绪'
    case 'stopped': return '预览已停止'
    case 'error': return error || '预览失败'
    default: return ''
  }
}

export const HTMLArtifact: FC<HTMLArtifactProps> = ({ content, title, iframeRef }) => {
  // Create blob URL for the single-file static preview
  const blobUrl = useMemo(() => {
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
    return URL.createObjectURL(blob)
  }, [content])

  const isMultiFile = useMemo(() => referencesUnresolvableSiblings(content), [content])

  const preview = useSessionPreview()
  const [starting, setStarting] = useState(false)

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  // Clear the local "starting" bridge once a real backend status arrives.
  useEffect(() => {
    if (preview?.status) setStarting(false)
  }, [preview?.status])

  const status = preview?.status
  const busy = starting || status === 'detecting' || status === 'installing' || status === 'building'
  const failed = status === 'error'
  const liveUrl = status === 'ready' ? preview?.url : undefined

  const runPreview = () => {
    setStarting(true)
    void startPreview().catch(() => setStarting(false))
  }

  return (
    <div className="artifact-html-container h-full w-full flex flex-col">
      {title && (
        <div className="artifact-title px-4 py-2 border-b bg-muted/50 text-sm font-medium">
          {title}
        </div>
      )}

      {isMultiFile && (
        <div className="flex flex-col gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              {liveUrl
                ? '正在运行实时预览（沙盒）。下方为可交互的真实应用。'
                : '这是多文件 App（外部 JS/CSS）。下方是静态结构；点「运行预览」在沙盒里真正运行（可交互、本地存储生效）。'}
            </span>
            <button
              type="button"
              onClick={runPreview}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 font-medium text-amber-900 transition hover:bg-amber-200 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {busy ? '运行中…' : liveUrl ? '重新运行' : '运行预览'}
            </button>
          </div>
          {(busy || failed) && (
            <div className="flex items-center gap-1.5 pl-5 text-[11px] text-amber-800 dark:text-amber-300">
              {failed ? (
                <AlertTriangle className="h-3 w-3 shrink-0" />
              ) : (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              )}
              <span className="truncate">{statusLabel(status, preview?.error)}</span>
            </div>
          )}
        </div>
      )}

      {liveUrl ? (
        // Live, runnable preview from the Phase C sandbox (separate origin).
        <iframe
          key="live"
          src={liveUrl}
          sandbox={SANDBOX}
          className="artifact-iframe flex-1 w-full border-0 bg-white"
          title={title || 'App Preview'}
        />
      ) : (
        // Static single-file preview.
        <iframe
          key="static"
          ref={iframeRef}
          src={blobUrl}
          sandbox={SANDBOX}
          className="artifact-iframe flex-1 w-full border-0 bg-white"
          title={title || 'Artifact Preview'}
        />
      )}
    </div>
  )
}
