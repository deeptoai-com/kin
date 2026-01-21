/**
 * CodePreviewOverlay - Overlay for code file preview (Read/Write tools)
 *
 * Features:
 * - Shiki syntax highlighting
 * - Line numbers
 * - Copy button
 * - File path display
 *
 * Aligned with Craft's CodePreviewOverlay.tsx implementation.
 */

import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { FullscreenOverlay } from './fullscreen-overlay';
import { CodeBlock } from '../code-block';

export interface CodePreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when the overlay should close */
  onClose: () => void;
  /** The code content to display */
  content: string;
  /** File path for language detection and display */
  filePath: string;
  /** Language for syntax highlighting (auto-detected if not provided) */
  language?: string;
  /** Mode: 'read' or 'write' */
  mode?: 'read' | 'write';
  /** Error message if tool failed */
  error?: string;
  /** Callback to open file in external editor */
  onOpenFile?: (filePath: string) => void;
}

/**
 * Extract language from file path
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    dockerfile: 'dockerfile',
    xml: 'xml',
    toml: 'toml',
    ini: 'ini',
    graphql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
  };
  return languageMap[ext] || 'text';
}

/**
 * Truncate file path for display
 */
function truncateFilePath(filePath: string, maxLength = 60): string {
  if (filePath.length <= maxLength) return filePath;
  const parts = filePath.split('/');
  if (parts.length <= 2) return '...' + filePath.slice(-maxLength + 3);

  // Keep first and last parts, truncate middle
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const newResult = parts[i] + '/' + result;
    if (newResult.length > maxLength - 4) {
      return '.../' + result;
    }
    result = newResult;
  }
  return result;
}

export function CodePreviewOverlay({
  isOpen,
  onClose,
  content,
  filePath,
  language,
  mode = 'read',
  error,
  onOpenFile,
}: CodePreviewOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content]);

  const detectedLanguage = language || getLanguageFromPath(filePath);
  const lineCount = content.split('\n').length;

  return (
    <FullscreenOverlay
      isOpen={isOpen}
      onClose={onClose}
      accessibleTitle={`${mode === 'write' ? 'Write' : 'Read'} ${filePath}`}
      title={truncateFilePath(filePath)}
      subtitle={`${lineCount} lines`}
      badge={{
        icon: mode === 'write' ? '✏️' : '📄',
        label: mode === 'write' ? 'Write' : 'Read',
        variant: mode === 'write' ? 'amber' : 'blue',
      }}
      error={error ? { label: mode === 'write' ? 'Write Failed' : 'Read Failed', message: error } : undefined}
    >
      <div className="relative flex-1 overflow-auto">
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-md bg-[#f0f0eb] px-2.5 py-1.5 text-xs font-medium text-[#333] hover:bg-[#e5e5e0] dark:bg-[#2a2928] dark:text-[#e5e4df] dark:hover:bg-[#3a3938]"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-600" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>

        {/* Code content */}
        <div className="p-4">
          <CodeBlock
            code={content}
            language={detectedLanguage}
            mode="full"
            className="w-full"
          />
        </div>
      </div>
    </FullscreenOverlay>
  );
}
