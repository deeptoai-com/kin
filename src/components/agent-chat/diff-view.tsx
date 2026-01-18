/**
 * Diff View Component
 *
 * Displays code differences in a unified diff format.
 * Used by tool-call-part to show Edit/Write tool changes.
 *
 * Features:
 * - Color-coded additions (green) and deletions (red)
 * - Line numbers with +/- indicators
 * - Compact view (only shows changed lines)
 * - Dark mode support
 */

import { type FC, useMemo } from 'react';
import { calculateDiff, getDiffSummary, type DiffLine } from '~/lib/diff-utils';

interface DiffViewProps {
  oldString: string;
  newString: string;
  fileName?: string;
  maxHeight?: string;
}

export const DiffView: FC<DiffViewProps> = ({
  oldString,
  newString,
  fileName,
  maxHeight = '300px',
}) => {
  const diffLines = useMemo(
    () => calculateDiff(oldString, newString),
    [oldString, newString]
  );

  const summary = useMemo(() => getDiffSummary(diffLines), [diffLines]);

  // If no changes, show a message
  if (diffLines.length === 0) {
    return (
      <div className="rounded border border-[#e5e4df] bg-[#faf9f7] p-3 text-center text-xs text-[#6b6a68] dark:border-[#3a3938] dark:bg-[#2b2a27] dark:text-[#9a9893]">
        No changes detected
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-[#e5e4df] dark:border-[#3a3938]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e4df] bg-[#faf9f7] px-3 py-1.5 dark:border-[#3a3938] dark:bg-[#2b2a27]">
        <span className="font-mono text-xs text-[#6b6a68] dark:text-[#9a9893]">
          {fileName || 'Diff'}
        </span>
        <span className="text-xs">
          <span className="text-green-600 dark:text-green-400">
            +{diffLines.filter(l => l.type === 'added').length}
          </span>
          {' '}
          <span className="text-red-600 dark:text-red-400">
            -{diffLines.filter(l => l.type === 'removed').length}
          </span>
        </span>
      </div>

      {/* Diff Content */}
      <div
        className="overflow-auto bg-white font-mono text-xs dark:bg-[#1f1e1b]"
        style={{ maxHeight }}
      >
        {diffLines.map((line, index) => (
          <DiffLineRow key={index} line={line} />
        ))}
      </div>
    </div>
  );
};

interface DiffLineRowProps {
  line: DiffLine;
}

const DiffLineRow: FC<DiffLineRowProps> = ({ line }) => {
  const { type, content } = line;

  const styles = {
    added: {
      indicator: '+',
      indicatorBg: 'bg-green-100 dark:bg-green-900/30',
      indicatorText: 'text-green-600 dark:text-green-400',
      indicatorBorder: 'border-green-200 dark:border-green-800',
      contentBg: 'bg-green-50 dark:bg-green-900/20',
      contentText: 'text-green-800 dark:text-green-200',
    },
    removed: {
      indicator: '-',
      indicatorBg: 'bg-red-100 dark:bg-red-900/30',
      indicatorText: 'text-red-600 dark:text-red-400',
      indicatorBorder: 'border-red-200 dark:border-red-800',
      contentBg: 'bg-red-50 dark:bg-red-900/20',
      contentText: 'text-red-800 dark:text-red-200',
    },
    unchanged: {
      indicator: ' ',
      indicatorBg: 'bg-gray-50 dark:bg-gray-900/30',
      indicatorText: 'text-gray-400 dark:text-gray-600',
      indicatorBorder: 'border-gray-200 dark:border-gray-800',
      contentBg: 'bg-white dark:bg-[#1f1e1b]',
      contentText: 'text-gray-600 dark:text-gray-400',
    },
  };

  const style = styles[type];

  return (
    <div className="flex">
      {/* Indicator Column */}
      <span
        className={`w-8 shrink-0 select-none text-center border-r py-0.5 ${style.indicatorBg} ${style.indicatorText} ${style.indicatorBorder}`}
      >
        {style.indicator}
      </span>

      {/* Content Column */}
      <span
        className={`flex-1 whitespace-pre-wrap break-all px-2 py-0.5 ${style.contentBg} ${style.contentText}`}
      >
        {content || '\u00A0'}
      </span>
    </div>
  );
};

export default DiffView;
