/**
 * HTML Artifact Renderer
 *
 * Renders HTML artifacts in a sandboxed iframe.
 */

import { useEffect, useMemo, type FC, type Ref } from 'react'

export interface HTMLArtifactProps {
  content: string
  title?: string
  iframeRef?: Ref<HTMLIFrameElement>
}

export const HTMLArtifact: FC<HTMLArtifactProps> = ({ content, title, iframeRef }) => {
  // Create blob URL for iframe src
  const blobUrl = useMemo(() => {
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
    return URL.createObjectURL(blob)
  }, [content])

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
