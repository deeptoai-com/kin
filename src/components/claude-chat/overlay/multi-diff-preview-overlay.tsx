/**
 * MultiDiffPreviewOverlay - Overlay for multiple file changes (Edit/Write tools)
 *
 * Features:
 * - Sidebar navigation when multiple files changed
 * - Consolidated view (group by file)
 * - Unified diff viewer for each change
 *
 * Aligned with Craft's MultiDiffPreviewOverlay.tsx implementation.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { FullscreenOverlay } from './fullscreen-overlay';
import { DiffView } from '../../agent-chat/diff-view';
import { cn } from '~/lib/utils';

/**
 * A single file change (Edit or Write)
 */
export interface FileChange {
  /** Unique ID for this change */
  id: string;
  /** Absolute file path */
  filePath: string;
  /** Tool type: Edit or Write */
  toolType: 'Edit' | 'Write';
  /** For Edit: the old_string; For Write: empty or previous content if available */
  original: string;
  /** For Edit: the new_string; For Write: the written content */
  modified: string;
  /** Error message if the tool failed */
  error?: string;
}

export interface MultiDiffPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when the overlay should close */
  onClose: () => void;
  /** List of file changes to display */
  changes: FileChange[];
  /** ID of change to focus on initially */
  focusedChangeId?: string;
  /** Callback to open file in external editor */
  onOpenFile?: (filePath: string) => void;
}

interface SidebarEntry {
  key: string;
  filePath: string;
  changes: FileChange[];
}

/**
 * Group changes by file path
 */
function createSidebarEntries(changes: FileChange[]): SidebarEntry[] {
  const successfulChanges = changes.filter(c => !c.error);

  // Group by file path
  const byPath = new Map<string, FileChange[]>();
  for (const change of successfulChanges) {
    const existing = byPath.get(change.filePath) || [];
    existing.push(change);
    byPath.set(change.filePath, existing);
  }

  return Array.from(byPath.entries()).map(([filePath, fileChanges]) => ({
    key: filePath,
    filePath,
    changes: fileChanges,
  }));
}

/**
 * Get file name from path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Get parent directory for display
 */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 2) return '';
  return parts.slice(-3, -1).join('/');
}

/**
 * Truncate file path for display
 */
function truncateFilePath(filePath: string, maxLength = 50): string {
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
function getDiffStats(changes: FileChange[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    const oldLines = change.original.split('\n').length;
    const newLines = change.modified.split('\n').length;
    additions += Math.max(0, newLines - oldLines);
    deletions += Math.max(0, oldLines - newLines);
  }

  return { additions, deletions };
}

export function MultiDiffPreviewOverlay({
  isOpen,
  onClose,
  changes,
  focusedChangeId,
  onOpenFile,
}: MultiDiffPreviewOverlayProps) {
  // Create sidebar entries
  const sidebarEntries = useMemo(() => createSidebarEntries(changes), [changes]);

  // Selection state
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    if (focusedChangeId) {
      const change = changes.find(c => c.id === focusedChangeId);
      if (change) return change.filePath;
    }
    return sidebarEntries[0]?.key || null;
  });

  // Reset selection when focusedChangeId changes
  useEffect(() => {
    if (focusedChangeId) {
      const change = changes.find(c => c.id === focusedChangeId);
      if (change) {
        setSelectedKey(change.filePath);
      }
    }
  }, [focusedChangeId, changes]);

  // Reset to first entry if current selection becomes invalid
  useEffect(() => {
    if (sidebarEntries.length > 0) {
      setSelectedKey(prevKey => {
        if (prevKey && sidebarEntries.find(e => e.key === prevKey)) {
          return prevKey;
        }
        return sidebarEntries[0]?.key || null;
      });
    }
  }, [sidebarEntries]);

  // Get selected entry
  const selectedEntry = useMemo(() => {
    if (!selectedKey) return null;
    return sidebarEntries.find(e => e.key === selectedKey) || null;
  }, [sidebarEntries, selectedKey]);

  // Compute combined diff for the selected entry
  const combinedDiff = useMemo(() => {
    if (!selectedEntry) return { original: '', modified: '' };

    const entryChanges = selectedEntry.changes;
    if (entryChanges.length === 1) {
      const firstChange = entryChanges[0];
      return {
        original: firstChange?.original ?? '',
        modified: firstChange?.modified ?? '',
      };
    }

    // Multiple changes to same file - combine with separator
    const separator = '\n\n// ───────────────────────────────────────\n\n';
    return {
      original: entryChanges.map(c => c.original).join(separator),
      modified: entryChanges.map(c => c.modified).join(separator),
    };
  }, [selectedEntry]);

  const handleSelectEntry = useCallback((key: string) => {
    setSelectedKey(key);
  }, []);

  // Determine if we should show sidebar
  const showSidebar = sidebarEntries.length > 1;

  // Get stats for header
  const stats = useMemo(() => getDiffStats(changes), [changes]);
  const hasWrite = selectedEntry?.changes.some(c => c.toolType === 'Write') ?? false;

  return (
    <FullscreenOverlay
      isOpen={isOpen}
      onClose={onClose}
      accessibleTitle="Multi-file diff"
      title={selectedEntry ? truncateFilePath(selectedEntry.filePath) : `${sidebarEntries.length} files`}
      subtitle={`+${stats.additions} -${stats.deletions}`}
      badge={{
        icon: hasWrite ? '📝' : '✏️',
        label: selectedEntry?.changes.length && selectedEntry.changes.length > 1
          ? `${selectedEntry.changes.length} ${hasWrite ? 'Writes' : 'Edits'}`
          : hasWrite ? 'Write' : 'Edit',
        variant: hasWrite ? 'green' : 'amber',
      }}
    >
      <div className="flex h-full">
        {/* Sidebar */}
        {showSidebar && (
          <div className="w-64 shrink-0 h-full overflow-y-auto border-r border-[#e5e4df] bg-[#f8f8f6] dark:border-[#3a3938] dark:bg-[#1f1e1b]">
            <div className="px-2 py-2">
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b6a68] dark:text-[#9a9893]">
                Changes ({sidebarEntries.length})
              </div>
              <div className="space-y-0.5">
                {sidebarEntries.map(entry => {
                  const fileName = getFileName(entry.filePath);
                  const parentDir = getParentDir(entry.filePath);
                  const isSelected = selectedKey === entry.key;
                  const changeCount = entry.changes.length;

                  return (
                    <button
                      key={entry.key}
                      onClick={() => handleSelectEntry(entry.key)}
                      title={entry.filePath}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-left rounded-md transition-colors',
                        isSelected
                          ? 'bg-[#e5e5e0] dark:bg-[#3a3938]'
                          : 'hover:bg-[#f0f0eb] dark:hover:bg-[#2a2928]'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{fileName}</div>
                        {parentDir && (
                          <div className="text-[10px] truncate text-[#6b6a68] dark:text-[#9a9893]">
                            {parentDir}
                          </div>
                        )}
                      </div>
                      {changeCount > 1 && (
                        <span className="text-xs shrink-0 text-[#6b6a68] dark:text-[#9a9893]">
                          ({changeCount})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Main diff area */}
        <div className="flex-1 min-w-0 h-full overflow-auto">
          {selectedEntry ? (
            <div className="p-4">
              <DiffView
                oldString={combinedDiff.original}
                newString={combinedDiff.modified}
                fileName={selectedEntry.filePath}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-[#6b6a68] dark:text-[#9a9893]">
              Select a file to view changes
            </div>
          )}
        </div>
      </div>
    </FullscreenOverlay>
  );
}
