/**
 * JSONPreviewOverlay - Overlay for JSON data preview
 *
 * Features:
 * - Pretty-printed JSON display
 * - Syntax highlighting
 * - Collapsible sections (future)
 * - Copy functionality
 *
 * Aligned with Craft's JSONPreviewOverlay.tsx implementation.
 */

import { useState, useCallback, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import { FullscreenOverlay } from './fullscreen-overlay';
import { CodeBlock } from '../code-block';

export interface JSONPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when the overlay should close */
  onClose: () => void;
  /** The JSON data to display (can be object or string) */
  data: unknown;
  /** Title for the overlay */
  title?: string;
  /** Error message if parsing failed */
  error?: string;
}

/**
 * Format JSON with proper indentation
 */
function formatJSON(data: unknown): string {
  try {
    if (typeof data === 'string') {
      // Try to parse if it's a string
      const parsed = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(data, null, 2);
  } catch {
    // If parsing fails, return as-is
    return typeof data === 'string' ? data : String(data);
  }
}

/**
 * Get summary info about JSON data
 */
function getJSONSummary(data: unknown): string {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (Array.isArray(parsed)) {
      return `Array (${parsed.length} items)`;
    }
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed);
      return `Object (${keys.length} keys)`;
    }
    return typeof parsed;
  } catch {
    return 'Invalid JSON';
  }
}

export function JSONPreviewOverlay({
  isOpen,
  onClose,
  data,
  title = 'JSON Data',
  error,
}: JSONPreviewOverlayProps) {
  const [copied, setCopied] = useState(false);

  const formattedJSON = useMemo(() => formatJSON(data), [data]);
  const summary = useMemo(() => getJSONSummary(data), [data]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formattedJSON);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [formattedJSON]);

  return (
    <FullscreenOverlay
      isOpen={isOpen}
      onClose={onClose}
      accessibleTitle={title}
      title={title}
      subtitle={summary}
      badge={{
        icon: '{}',
        label: 'JSON',
        variant: 'purple',
      }}
      error={error ? { label: 'Parse Error', message: error } : undefined}
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

        {/* JSON content */}
        <div className="p-4">
          <CodeBlock
            code={formattedJSON}
            language="json"
            mode="full"
            className="w-full"
          />
        </div>
      </div>
    </FullscreenOverlay>
  );
}
