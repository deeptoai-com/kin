/**
 * HTML Artifact Renderer
 *
 * Renders HTML artifacts in a sandboxed iframe.
 *
 * Graceful degradation: an HTML file that references RELATIVE external resources
 * (e.g. <script src="app.js">, <link href="style.css">) is a multi-file app. The
 * single-file blob: preview can't resolve those siblings, so its scripts never
 * load and interaction (add/edit, localStorage, form submit) silently fails or
 * breaks the preview. We detect that and show a clear notice instead of leaving
 * the user with a dead/broken page. A real, runnable multi-file preview is Phase C
 * (the sandbox line); see docs/project/research/2026-06-real-preview-v1-implementation-plan.md.
 */

import { useEffect, useMemo, type FC, type Ref } from 'react'
import { Info } from 'lucide-react'

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

export const HTMLArtifact: FC<HTMLArtifactProps> = ({ content, title, iframeRef }) => {
  // Create blob URL for iframe src
  const blobUrl = useMemo(() => {
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
    return URL.createObjectURL(blob)
  }, [content])

  const isMultiFile = useMemo(() => referencesUnresolvableSiblings(content), [content])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return (
    <div className="artifact-html-container h-full w-full flex flex-col">
      {title && (
        <div className="artifact-title px-4 py-2 border-b bg-muted/50 text-sm font-medium">
          {title}
        </div>
      )}
      {isMultiFile && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            这是多文件 App（引用了外部 JS/CSS）。单文件预览只能看静态结构，交互（增删改、本地存储、表单提交）不会生效；完整可运行的预览将随沙盒（Phase&nbsp;C）上线。
          </span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={blobUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        className="artifact-iframe flex-1 w-full border-0 bg-white"
        title={title || 'Artifact Preview'}
      />
    </div>
  )
}
