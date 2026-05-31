/**
 * CodeBlock - Syntax highlighted code block using Shiki
 *
 * Features:
 * - Lazy-loads Shiki highlighting
 * - Caches results for performance
 * - Three render modes: terminal, minimal, full
 * - Copy button in full mode
 *
 * Aligned with Craft's CodeBlock.tsx implementation.
 */

import * as React from 'react';
import { useIntlayer } from 'react-intlayer';
import { codeToHtml, bundledLanguages, type BundledLanguage } from 'shiki';
import { cn, toLocalizedString } from '~/lib/utils';

export interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  /**
   * Render mode affects code block styling:
   * - 'terminal': Minimal, keeps control chars visible
   * - 'minimal': Clean code, basic styling
   * - 'full': Rich styling with background, copy button, etc.
   */
  mode?: 'terminal' | 'minimal' | 'full';
}

// Map common aliases to Shiki language names
const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  'js': 'javascript',
  'ts': 'typescript',
  'py': 'python',
  'sh': 'bash',
  'zsh': 'bash',
  'yml': 'yaml',
  'rb': 'ruby',
  'rs': 'rust',
  'kt': 'kotlin',
  'objc': 'objc',
};

// Simple LRU cache for highlighted code
const highlightCache = new Map<string, string>();
const CACHE_MAX_SIZE = 200;

function getCacheKey(code: string, lang: string, theme: string): string {
  return `${theme}:${lang}:${code}`;
}

function isValidLanguage(lang: string): lang is BundledLanguage {
  const normalized = LANGUAGE_ALIASES[lang] || lang;
  return normalized in bundledLanguages;
}

/**
 * Detect if we're in dark mode
 */
function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

export function CodeBlock({ code, language = 'text', className, mode = 'full' }: CodeBlockProps) {
  const content = useIntlayer('claude-chat');
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  // Resolve language alias
  const langLower = language.toLowerCase();
  const resolvedLang: string = LANGUAGE_ALIASES[langLower as keyof typeof LANGUAGE_ALIASES] || langLower;

  React.useEffect(() => {
    let cancelled = false;

    async function highlight() {
      const theme = isDarkMode() ? 'github-dark' : 'github-light';
      const cacheKey = getCacheKey(code, resolvedLang, theme);

      const cached = highlightCache.get(cacheKey);
      if (cached) {
        if (!cancelled) {
          setHighlighted(cached);
          setIsLoading(false);
        }
        return;
      }

      try {
        // Use valid language or fallback to plaintext
        const lang = isValidLanguage(resolvedLang) ? resolvedLang : 'text';

        const html = await codeToHtml(code, {
          lang,
          theme,
        });

        // Cache the result
        if (highlightCache.size >= CACHE_MAX_SIZE) {
          const firstKey = highlightCache.keys().next().value;
          if (firstKey) highlightCache.delete(firstKey);
        }
        highlightCache.set(cacheKey, html);

        if (!cancelled) {
          setHighlighted(html);
          setIsLoading(false);
        }
      } catch (error) {
        // Fallback to plain text on error
        console.warn(`Shiki highlighting failed for language "${resolvedLang}":`, error);
        if (!cancelled) {
          setHighlighted(null);
          setIsLoading(false);
        }
      }
    }

    highlight();

    return () => {
      cancelled = true;
    };
  }, [code, resolvedLang]);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }, [code]);

  // Terminal mode: raw monospace with minimal styling
  if (mode === 'terminal') {
    return (
      <pre className={cn('font-mono text-sm whitespace-pre-wrap', className)}>
        <code>{code}</code>
      </pre>
    );
  }

  // Minimal mode: just syntax highlighting, no chrome
  if (mode === 'minimal') {
    if (isLoading || !highlighted) {
      return (
        <pre className={cn('font-mono text-sm whitespace-pre-wrap', className)}>
          <code>{code}</code>
        </pre>
      );
    }

    return (
      <div
        className={cn('font-mono text-sm [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:!bg-transparent', className)}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  }

  // Full mode: rich styling with header and copy button
  return (
    <div className={cn('relative group rounded-lg overflow-hidden border bg-muted/30', className)}>
      {/* Language label + copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b text-xs">
        <span className="text-muted-foreground font-medium uppercase tracking-wide">
          {resolvedLang !== 'text' ? resolvedLang : 'plain text'}
        </span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          aria-label={toLocalizedString(content.message.copyCode)}
        >
          {copied ? (
            <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>

      {/* Code content */}
      <div className="p-3 overflow-x-auto">
        {isLoading || !highlighted ? (
          <pre className="font-mono text-sm whitespace-pre-wrap break-all">
            <code>{code}</code>
          </pre>
        ) : (
          <div
            className="font-mono text-sm [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * InlineCode - Styled inline code span
 */
export function InlineCode({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={cn(
      'px-1 py-0.5 rounded bg-foreground/[0.04] font-mono text-[13px]',
      className
    )}>
      {children}
    </code>
  );
}
