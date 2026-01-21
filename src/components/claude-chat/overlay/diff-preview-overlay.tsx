/**
 * DiffPreviewOverlay - Overlay for diff preview (Edit tool)
 *
 * Features:
 * - Side-by-side or unified diff view
 * - Syntax highlighting
 * - Line numbers
 * - Copy functionality
 *
 * Aligned with Craft's DiffPreviewOverlay.tsx implementation.
 */

import { useState, useCallback, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import { FullscreenOverlay } from './fullscreen-overlay';
import { DiffView } from '../../agent-chat/diff-view';

export interface DiffPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when the overlay should close */
  onClose: () => void;
  /** Original content (before edit) */
  oldContent: string;
  /** New content (after edit) */
  newContent: string;
  /** File path for display */
  filePath: string;
  /** Error message if edit failed */
  error?: string;
}

/**
 * Truncate file path for display
 */
function truncateFilePath(filePath: string, maxLength = 60): string {
  if (filePath.length <= maxLength) return filePath;
  const parts = filePath.split('/');
  if (parts.length <= 2) return '...' + filePath.slice(-maxLength + 3);

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

/**
 * Count diff statistics
 */
function getDiffStats(oldContent: string, newContent: string): { additions: number; deletions: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple line-based diff counting
  // A more accurate diff would use a proper diff algorithm
  const additions = Math.max(0, newLines.length - oldLines.length);
  const deletions = Math.max(0, oldLines.length - newLines.length);

  return { additions, deletions };
}

export function DiffPreviewOverlay({
  isOpen,
  onClose,
  oldContent,
  newContent,
  filePath,
  error,
}: DiffPreviewOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyNew = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(newContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [newContent]);

  const stats = useMemo(() => getDiffStats(oldContent, newContent), [oldContent, newContent]);

  return (
    <FullscreenOverlay
      isOpen={isOpen}
      onClose={onClose}
      accessibleTitle={`Edit ${filePath}`}
      title={truncateFilePath(filePath)}
      subtitle={`+${stats.additions} -${stats.deletions}`}
      badge={{
        icon: '✏️',
        label: 'Edit',
        variant: 'amber',
      }}
      error={error ? { label: 'Edit Failed', message: error } : undefined}
    >
      <div className="relative flex-1 overflow-auto">
        {/* Copy button */}
        <button
          onClick={handleCopyNew}
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
              <span>Copy New</span>
            </>
          )}
        </button>

        {/* Diff content */}
        <div className="p-4">
          <DiffView
            oldString={oldContent}
            newString={newContent}
            fileName={filePath}
          />
        </div>
      </div>
    </FullscreenOverlay>
  );
}
