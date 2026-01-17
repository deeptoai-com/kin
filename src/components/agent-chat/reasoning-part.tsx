/**
 * Reasoning Part Component
 *
 * Displays Claude's thinking/reasoning process with a collapsible UI.
 * Respects the global showThinking setting from chat session store.
 */

import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { useState, type FC } from 'react';
import { useChatSessionStore } from '~/lib/chat-session-store';

interface ReasoningPartProps {
  text: string;
  status?: { type: string };
}

export const ReasoningPart: FC<ReasoningPartProps> = ({ text, status }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const showThinking = useChatSessionStore((state) => state.showThinking);
  const isRunning = status?.type === 'running';

  // If showThinking is disabled, don't render anything
  if (!showThinking) {
    return null;
  }

  // Truncate for preview
  const previewLength = 100;
  const preview = text.length > previewLength ? text.slice(0, previewLength) + '...' : text;

  return (
    <div className="my-2 rounded-lg border border-[#e5e4df] bg-[#faf9f7] dark:border-[#3a3938] dark:bg-[#2b2a27]">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#6b6a68] hover:text-[#1a1a18] dark:text-[#9a9893] dark:hover:text-[#eee]"
      >
        {isExpanded ? (
          <ChevronDownIcon className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 shrink-0" />
        )}
        <span className="font-medium">
          {isRunning ? 'Thinking...' : 'Reasoning'}
        </span>
        {!isExpanded && (
          <span className="truncate text-xs opacity-60">{preview}</span>
        )}
        {isRunning && (
          <span className="ml-auto flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#ae5630]" />
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-[#e5e4df] px-3 py-2 dark:border-[#3a3938]">
          <pre className="whitespace-pre-wrap font-mono text-xs text-[#6b6a68] dark:text-[#9a9893]">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ReasoningPart;
