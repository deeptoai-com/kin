/**
 * Markdown Components - Enhanced markdown rendering with Shiki highlighting
 *
 * Features:
 * - Three render modes: terminal, minimal, full
 * - Syntax highlighting via Shiki
 * - GFM support (tables, task lists, strikethrough)
 * - Clickable links and file paths
 *
 * Aligned with Craft's Markdown.tsx implementation.
 */

import * as React from 'react';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock, InlineCode } from './code-block';
import { preprocessLinks } from './linkify';

export type RenderMode = 'terminal' | 'minimal' | 'full';

export interface MarkdownComponentsOptions {
  mode?: RenderMode;
  onUrlClick?: (url: string) => void;
  onFileClick?: (path: string) => void;
}

// File path detection regex - matches paths starting with /, ~/, or ./
const FILE_PATH_REGEX = /^(?:\/|~\/|\.\/)+[\w\-./@]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yaml|yml|py|go|rs|css|scss|less|html|htm|txt|log|sh|bash|zsh|swift|kt|java|c|cpp|h|hpp|rb|php|xml|toml|ini|cfg|conf|env|sql|graphql|vue|svelte|astro|prisma)$/i;

export const markdownRemarkPlugins = [remarkGfm];

/**
 * Create custom components based on render mode
 */
export function createMarkdownComponents(
  options: MarkdownComponentsOptions = {}
): Components {
  const { mode = 'minimal', onUrlClick, onFileClick } = options;

  const baseComponents: Partial<Components> = {
    // Links: Make clickable with callbacks
    a: ({ href, children }) => {
      const handleClick = (e: React.MouseEvent) => {
        if (!href) return;

        // Check if it's a file path
        if (FILE_PATH_REGEX.test(href) && onFileClick) {
          e.preventDefault();
          onFileClick(href);
        } else if (onUrlClick) {
          e.preventDefault();
          onUrlClick(href);
        }
        // If no handler, let default behavior work (open in new tab)
      };

      return (
        <a
          href={href}
          onClick={handleClick}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline cursor-pointer underline-offset-2"
        >
          {children}
        </a>
      );
    },
  };

  // Terminal mode: minimal formatting
  if (mode === 'terminal') {
    return {
      ...baseComponents,
      // No special code handling - just monospace
      code: ({ children }) => (
        <code className="font-mono">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="font-mono whitespace-pre-wrap my-2">{children}</pre>
      ),
      // Minimal paragraph spacing
      p: ({ children }) => <p className="my-1">{children}</p>,
      // Simple lists
      ul: ({ children }) => <ul className="list-disc list-inside my-1">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal list-inside my-1">{children}</ol>,
      li: ({ children }) => <li className="my-0.5">{children}</li>,
      // Plain tables
      table: ({ children }) => (
        <table className="my-2 font-mono text-sm">{children}</table>
      ),
      th: ({ children }) => <th className="text-left pr-4">{children}</th>,
      td: ({ children }) => <td className="pr-4">{children}</td>,
    };
  }

  // Minimal mode: clean with syntax highlighting
  if (mode === 'minimal') {
    return {
      ...baseComponents,
      // Inline code
      code: ({ className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '');
        const isBlock = 'node' in props && (props.node as { position?: { start: { line: number }; end: { line: number } } })?.position?.start.line !== (props.node as { position?: { start: { line: number }; end: { line: number } } })?.position?.end.line;

        // Block code - use CodeBlock with full mode
        if (match || isBlock) {
          const code = String(children).replace(/\n$/, '');
          return <CodeBlock code={code} language={match?.[1]} mode="full" className="my-2" />;
        }

        // Inline code
        return <InlineCode>{children}</InlineCode>;
      },
      pre: ({ children }) => <>{children}</>,
      // Comfortable paragraph spacing
      p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
      // Styled lists
      ul: ({ children }) => (
        <ul className="my-2 space-y-1 pl-4 list-disc marker:text-[#6b6a68] dark:marker:text-[#9a9893]">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-2 space-y-1 pl-6 list-decimal">{children}</ol>
      ),
      li: ({ children }) => <li>{children}</li>,
      // Clean tables
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
          <table className="min-w-full text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="border-b border-[#e5e4df] dark:border-[#3a3938]">{children}</thead>,
      th: ({ children }) => (
        <th className="text-left py-2 px-3 font-semibold text-[#6b6a68] dark:text-[#9a9893]">{children}</th>
      ),
      td: ({ children }) => (
        <td className="py-2 px-3 border-b border-[#e5e4df]/50 dark:border-[#3a3938]/50">{children}</td>
      ),
      // Headings
      h1: ({ children }) => <h1 className="font-sans text-lg font-bold mt-5 mb-3">{children}</h1>,
      h2: ({ children }) => <h2 className="font-sans text-base font-semibold mt-4 mb-3">{children}</h2>,
      h3: ({ children }) => <h3 className="font-sans text-base font-semibold mt-4 mb-2">{children}</h3>,
      // Blockquotes
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-[#6b6a68]/30 dark:border-[#9a9893]/30 pl-3 my-2 text-[#6b6a68] dark:text-[#9a9893] italic">
          {children}
        </blockquote>
      ),
      // Horizontal rules
      hr: () => <hr className="my-4 border-[#e5e4df] dark:border-[#3a3938]" />,
      // Strong/emphasis
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
    };
  }

  // Full mode: rich styling
  return {
    ...baseComponents,
    // Full code blocks with copy button
    code: ({ className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const isBlock = 'node' in props && (props.node as { position?: { start: { line: number }; end: { line: number } } })?.position?.start.line !== (props.node as { position?: { start: { line: number }; end: { line: number } } })?.position?.end.line;

      if (match || isBlock) {
        const code = String(children).replace(/\n$/, '');
        return <CodeBlock code={code} language={match?.[1]} mode="full" className="my-2" />;
      }

      return <InlineCode>{children}</InlineCode>;
    },
    pre: ({ children }) => <>{children}</>,
    // Rich paragraph spacing
    p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
    // Styled lists
    ul: ({ children }) => (
      <ul className="my-3 space-y-1.5 pl-4 list-disc marker:text-[#6b6a68] dark:marker:text-[#9a9893]">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 space-y-1.5 pl-6 list-decimal">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    // Beautiful tables
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto rounded-md border border-[#e5e4df] dark:border-[#3a3938]">
        <table className="min-w-full divide-y divide-[#e5e4df] dark:divide-[#3a3938]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-[#f8f8f6] dark:bg-[#1f1e1b]">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-[#e5e4df] dark:divide-[#3a3938]">{children}</tbody>,
    th: ({ children }) => (
      <th className="text-left py-3 px-4 font-semibold text-sm">{children}</th>
    ),
    td: ({ children }) => (
      <td className="py-3 px-4 text-sm">{children}</td>
    ),
    tr: ({ children }) => (
      <tr className="hover:bg-[#f0f0eb] dark:hover:bg-[#2a2928] transition-colors">{children}</tr>
    ),
    // Rich headings
    h1: ({ children }) => (
      <h1 className="font-sans text-lg font-bold mt-7 mb-4">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="font-sans text-base font-semibold mt-6 mb-3">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-sans text-base font-semibold mt-5 mb-3">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-sm font-semibold mt-3 mb-1">{children}</h4>
    ),
    // Styled blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-[#333]/30 dark:border-[#e5e4df]/30 bg-[#f8f8f6] dark:bg-[#1f1e1b] pl-4 pr-3 py-2 my-3 rounded-r-md">
        {children}
      </blockquote>
    ),
    // Task lists (GFM)
    input: ({ type, checked }) => {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-2 rounded border-[#6b6a68]"
          />
        );
      }
      return <input type={type} />;
    },
    // Horizontal rules
    hr: () => <hr className="my-6 border-[#e5e4df] dark:border-[#3a3938]" />,
    // Strong/emphasis
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through text-[#6b6a68] dark:text-[#9a9893]">{children}</del>,
  };
}

// Default components (minimal mode, no callbacks)
export const markdownComponents = createMarkdownComponents({ mode: 'minimal' });

// Re-export preprocessLinks for use in streaming markdown
export { preprocessLinks };
