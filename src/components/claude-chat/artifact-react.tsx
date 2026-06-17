/**
 * React Artifact Renderer
 *
 * Three render paths by content shape:
 *  1. Multi-file React app (imports relative siblings like ./games/Snake) → the
 *     in-browser single-file Sandpack CANNOT resolve those siblings ("Could not find
 *     module ./games/Snake.jsx" → "Something went wrong"). Route to the REAL preview
 *     (sandbox build→dist), mirroring the HTML artifact's multi-file path.
 *  2. Self-contained React component (no relative imports) → Sandpack inline preview.
 *  3. Non-React JS/TS (vanilla DOM script, utility module) → read-only code.
 */

import { useEffect, useState, type FC } from 'react'
import { Sandpack } from '@codesandbox/sandpack-react'
import { Info, Loader2, Play, ExternalLink } from 'lucide-react'
import { CodeBlock } from './code-block'
import { startPreview } from '~/claude/adapters'
import { useSessionPreview } from '~/lib/hooks/use-session-workbench'

export interface ReactArtifactProps {
  content: string
  title?: string
  fileName?: string
}

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'

function looksLikeReactComponent(code: string): boolean {
  if (!code || !code.trim()) return false
  const importsReact =
    /\bfrom\s+['"]react['"]/.test(code) || /\brequire\(\s*['"]react['"]\s*\)/.test(code)
  const hasDefaultExport = /\bexport\s+default\b/.test(code)
  const returnsJsx = /return\s*\(?\s*</.test(code)
  return importsReact || hasDefaultExport || returnsJsx
}

// A component that imports relative siblings (./games/Snake, ../lib/x) is a MULTI-FILE
// app. Sandpack only has THIS one file, so those imports never resolve. Detect it and
// route to the real preview instead of crashing the in-browser bundler.
function hasRelativeImports(code: string): boolean {
  return /\bfrom\s+['"]\.\.?\//.test(code) || /\brequire\(\s*['"]\.\.?\//.test(code)
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case 'detecting':
      return '检测项目…'
    case 'installing':
      return '安装依赖…'
    case 'building':
      return '构建中…'
    case 'ready':
      return '预览就绪'
    default:
      return '运行中…'
  }
}

/**
 * Multi-file React app → the REAL sandbox preview (build→dist), shown in an iframe —
 * the same backend path as the HTML artifact and the Files-tab「运行预览」. Sandpack
 * can't run it (only has the single entry file), so we don't even try; we show the
 * code until the user runs it, then swap in the live iframe.
 */
const MultiFileReactPreview: FC<{ content: string; isTypeScript: boolean }> = ({
  content,
  isTypeScript,
}) => {
  const preview = useSessionPreview()
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (preview?.status) setStarting(false)
  }, [preview?.status])

  const status = preview?.status
  const busy =
    starting || status === 'detecting' || status === 'installing' || status === 'building'
  const liveUrl = status === 'ready' ? preview?.url : undefined

  // `force` rebuilds in place — preview is build-mode (no HMR), so edits only show
  // after a rebuild; a plain start would reuse the cached "ready" instance.
  const run = (force = false) => {
    setStarting(true)
    void startPreview(undefined, 'static', { force }).catch(() => setStarting(false))
  }

  return (
    <div className="artifact-react-content flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          {liveUrl
            ? '正在运行实时预览（沙盒真实构建 React+Vite，可交互）。'
            : '多文件 React App（引用了别的文件）——浏览器内打包器跑不了。点「运行预览」用沙盒真实构建运行。'}
        </span>
        <button
          type="button"
          onClick={() => run(Boolean(liveUrl))}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 font-medium text-amber-900 transition hover:bg-amber-200 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? statusLabel(status) : liveUrl ? '重新构建' : '运行预览'}
        </button>
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 font-medium text-amber-900 transition hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
          >
            打开 <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {liveUrl ? (
        <iframe
          src={liveUrl}
          title="React preview"
          className="min-h-0 w-full flex-1 border-0"
          sandbox={SANDBOX}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <CodeBlock
            code={content}
            language={isTypeScript ? 'typescript' : 'javascript'}
            mode="full"
            className="w-full"
          />
        </div>
      )}
    </div>
  )
}

export const ReactArtifact: FC<ReactArtifactProps> = ({ content, fileName = 'App.jsx' }) => {
  // Determine if this is TypeScript based on file extension
  const isTypeScript = Boolean(fileName?.endsWith('.tsx') || fileName?.endsWith('.ts'))

  // Non-React JS/TS (vanilla DOM scripts, utility modules): show as code rather
  // than crashing the React runtime.
  if (!looksLikeReactComponent(content)) {
    return (
      <div className="artifact-react-content h-full w-full overflow-auto p-3">
        <CodeBlock
          code={content}
          language={isTypeScript ? 'typescript' : 'javascript'}
          mode="full"
          className="w-full"
        />
      </div>
    )
  }

  // Multi-file React app: Sandpack can't resolve the relative siblings → real preview.
  if (hasRelativeImports(content)) {
    return <MultiFileReactPreview content={content} isTypeScript={isTypeScript} />
  }

  // Self-contained React component → Sandpack inline preview.
  // Sandpack React template uses /App.js (not .jsx) as the default entry file.
  const entryFile = isTypeScript ? '/App.tsx' : '/App.js'

  return (
    <div className="artifact-react-content h-full w-full">
      <Sandpack
        template={isTypeScript ? 'react-ts' : 'react'}
        files={{
          [entryFile]: {
            code: content,
            active: true,
          },
        }}
        options={{
          showNavigator: false,
          showTabs: true,
          showLineNumbers: true,
          editorHeight: '100%',
          editorWidthPercentage: 50,
        }}
        theme="auto"
      />
    </div>
  )
}
