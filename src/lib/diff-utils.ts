/**
 * Diff Utilities
 *
 * Provides functions for calculating and displaying text differences.
 * Used by tool-call-part to show Edit/Write tool changes.
 */

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNum: number;
}

/**
 * Calculate diff between two strings
 * Simple line-by-line comparison algorithm
 *
 * @param oldStr - Original string content
 * @param newStr - New string content
 * @returns Array of diff lines with type indicators
 */
export function calculateDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldIndex >= oldLines.length) {
      // Only new lines remaining - all additions
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      newIndex++;
    } else if (newIndex >= newLines.length) {
      // Only old lines remaining - all deletions
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex++;
    } else if (oldLine === newLine) {
      // Lines are the same - skip (don't show unchanged lines to keep diff compact)
      oldIndex++;
      newIndex++;
    } else {
      // Lines are different - show removal then addition
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      oldIndex++;
      newIndex++;
    }
  }

  return diffLines;
}

/**
 * Create a memoized diff calculator with cache
 * Prevents recalculating diffs on every render
 */
export function createDiffCalculator() {
  const cache = new Map<string, DiffLine[]>();
  const MAX_CACHE_SIZE = 100;

  return (oldStr: string, newStr: string): DiffLine[] => {
    // Create cache key from content characteristics
    const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = calculateDiff(oldStr, newStr);
    cache.set(key, result);

    // Limit cache size
    if (cache.size > MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }

    return result;
  };
}

/**
 * Format diff for display summary
 * @returns Summary like "+5 -3" for additions/deletions
 */
export function getDiffSummary(diffLines: DiffLine[]): string {
  const added = diffLines.filter(l => l.type === 'added').length;
  const removed = diffLines.filter(l => l.type === 'removed').length;

  if (added === 0 && removed === 0) {
    return 'No changes';
  }

  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);

  return parts.join(' ');
}
