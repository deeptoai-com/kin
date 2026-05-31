/**
 * Markdown Artifact Renderer
 *
 * Renders Markdown content with syntax highlighting and styling.
 */

import type { FC } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { useState, useEffect } from 'react'

export interface MarkdownArtifactProps {
  content: string
  title?: string
}

export const MarkdownArtifact: FC<MarkdownArtifactProps> = ({ content }) => {
  // Detect dark mode
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark')
    }
    return false
  })

  useEffect(() => {
    if (typeof document === 'undefined') return

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  return (
    <div className="artifact-markdown-content h-full w-full overflow-auto bg-card p-6 dark:bg-card">
      <div className="prose prose-slate max-w-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <p className="mb-4 leading-relaxed text-foreground last:mb-0 dark:text-foreground">
                {children}
              </p>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 dark:text-primary"
              >
                {children}
              </a>
            ),
            ul: ({ children }) => (
              <ul className="mb-4 list-disc pl-6 last:mb-0">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-4 list-decimal pl-6 last:mb-0">{children}</ol>
            ),
            li: ({ children }) => <li className="mb-1">{children}</li>,
            code: ({ node, inline, className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '')
              const language = match ? match[1] : ''

              // Code block with syntax highlighting
              if (!inline && language) {
                return (
                  <SyntaxHighlighter
                    style={isDark ? oneDark : oneLight}
                    language={language}
                    PreTag="div"
                    className="mb-4 last:mb-0 !rounded-lg !text-sm"
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                    }}
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                )
              }

              // Inline code
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground dark:bg-muted dark:text-foreground"
                  {...props}
                >
                  {children}
                </code>
              )
            },
            pre: ({ children }) => <>{children}</>,
            blockquote: ({ children }) => (
              <blockquote className="mb-4 border-l-4 border-primary pl-4 italic text-muted-foreground last:mb-0 dark:border-primary dark:text-muted-foreground">
                {children}
              </blockquote>
            ),
            h1: ({ children }) => (
              <h1 className="mb-4 text-3xl font-bold text-foreground dark:text-foreground">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-3 text-2xl font-bold text-foreground dark:text-foreground">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-2 text-xl font-semibold text-foreground dark:text-foreground">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="mb-2 text-lg font-semibold text-foreground dark:text-foreground">
                {children}
              </h4>
            ),
            h5: ({ children }) => (
              <h5 className="mb-2 font-semibold text-foreground dark:text-foreground">{children}</h5>
            ),
            h6: ({ children }) => (
              <h6 className="mb-2 font-semibold text-foreground dark:text-foreground">{children}</h6>
            ),
            hr: () => <hr className="my-6 border-border dark:border-border" />,
            table: ({ children }) => (
              <div className="mb-4 overflow-x-auto last:mb-0">
                <table className="min-w-full border-collapse border border-border dark:border-border">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-muted dark:bg-muted">{children}</thead>
            ),
            tbody: ({ children }) => <tbody>{children}</tbody>,
            tr: ({ children }) => (
              <tr className="border-b border-border dark:border-border">{children}</tr>
            ),
            th: ({ children }) => (
              <th className="border border-border px-4 py-2 text-left font-semibold dark:border-border">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-4 py-2 dark:border-border">
                {children}
              </td>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
