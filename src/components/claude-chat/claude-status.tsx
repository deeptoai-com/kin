/**
 * Claude Status Component
 *
 * Displays the current status of Claude's processing with:
 * - Animated status text that cycles through different words
 * - Elapsed time counter
 * - Animated spinner
 * - Tool name display when running a tool
 *
 * Inspired by claudecodeui's ClaudeStatus component.
 */

import { Cross2Icon } from '@radix-ui/react-icons';
import { useEffect, useState, type FC } from 'react';

export type AgentStatusType = 'idle' | 'thinking' | 'reasoning' | 'toolUse' | 'streaming';

interface ClaudeStatusProps {
  status: AgentStatusType;
  toolName?: string | null;
  onAbort?: () => void;
  compact?: boolean;
}

// Status-specific configurations
const STATUS_CONFIG: Record<AgentStatusType, {
  icon: string;
  baseText: string;
  color: string;
  bgColor: string;
}> = {
  idle: {
    icon: '✓',
    baseText: '就绪',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
  },
  thinking: {
    icon: '💭',
    baseText: '正在思考',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
  },
  reasoning: {
    icon: '🧠',
    baseText: '正在推理',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
  },
  toolUse: {
    icon: '🔧',
    baseText: '工具执行中',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
  },
  streaming: {
    icon: '✨',
    baseText: '正在生成',
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-950/30',
  },
};

// Action words that cycle during thinking
const ACTION_WORDS = [
  '正在思考',
  '正在处理',
  '正在分析',
  '正在处理',
  '正在计算',
  '正在推理',
];

// Spinner animation characters
const SPINNERS = ['✻', '✹', '✸', '✶'];

export const ClaudeStatus: FC<ClaudeStatusProps> = ({
  status,
  toolName,
  onAbort,
  compact = false,
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);

  const isActive = status !== 'idle';
  const config = STATUS_CONFIG[status];

  // Elapsed time counter
  useEffect(() => {
    if (!isActive) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isActive, status]);

  // Animation phase for spinner
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % SPINNERS.length);
    }, 500);

    return () => clearInterval(timer);
  }, [isActive]);

  // Don't render if idle
  if (!isActive) return null;

  // Compute display text
  const getStatusText = () => {
    if (status === 'toolUse' && toolName) {
      return `${toolName}`;
    }
    if (status === 'thinking') {
      // Cycle through action words every 3 seconds
      const actionIndex = Math.floor(elapsedTime / 3) % ACTION_WORDS.length;
      return ACTION_WORDS[actionIndex];
    }
    return config.baseText;
  };

  const statusText = getStatusText();
  const currentSpinner = SPINNERS[animationPhase];

  // Compact mode - inline indicator
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ae5630]" />
        <span className={`${config.color} opacity-80`}>
          {statusText}...
        </span>
      </div>
    );
  }

  // Full mode - status bar
  return (
    <div className="mb-3 animate-in slide-in-from-bottom duration-300">
      <div
        className={`flex items-center justify-between rounded-lg border px-3 py-2 ${config.bgColor} border-[#e5e4df] dark:border-[#3a3938]`}
      >
        <div className="flex items-center gap-3">
          {/* Animated spinner */}
          <span
            className={`text-lg transition-all duration-500 ${
              animationPhase % 2 === 0 ? 'scale-110' : 'scale-100'
            } ${config.color}`}
          >
            {currentSpinner}
          </span>

          {/* Status text */}
          <div className="flex items-center gap-2">
            <span className={`font-medium text-sm ${config.color}`}>
              {statusText}...
            </span>
            <span className="text-xs text-[#6b6a68] dark:text-[#9a9893]">
              ({elapsedTime}s)
            </span>
          </div>

          {/* Tool name badge */}
          {status === 'toolUse' && toolName && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {toolName}
            </span>
          )}
        </div>

        {/* Abort button */}
        {onAbort && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
            title="Stop (Esc)"
          >
          <Cross2Icon className="h-3 w-3" />
          <span className="hidden sm:inline">停止</span>
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Inline status indicator for use within message content
 * Shows a minimal status while content is being generated
 */
export const InlineStatus: FC<{
  status: AgentStatusType;
  toolName?: string | null;
}> = ({ status, toolName }) => {
  const config = STATUS_CONFIG[status];

  if (status === 'idle') return null;

  const text = status === 'toolUse' && toolName
    ? `工具执行中：${toolName}`
    : `${config.baseText}...`;

  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[#ae5630]" />
      <span className={`${config.color} opacity-80`}>{text}</span>
    </div>
  );
};

/**
 * Toolbar Status Component
 * Displays status in the composer toolbar with h-8 (32px) height
 * Shows elapsed time, animated spinner, queue count, and stop button
 */
export const ToolbarStatus: FC<{
  status: AgentStatusType;
  toolName?: string | null;
  queueCount?: number;
  onAbort?: () => void;
}> = ({ status, toolName, queueCount = 0, onAbort }) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);

  const isActive = status !== 'idle';
  const config = STATUS_CONFIG[status];

  // Elapsed time counter
  useEffect(() => {
    if (!isActive) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isActive, status]);

  // Animation phase for spinner
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % SPINNERS.length);
    }, 500);

    return () => clearInterval(timer);
  }, [isActive]);

  // Don't render if idle
  if (!isActive) return null;

  // Compute display text
  const getStatusText = () => {
    if (status === 'toolUse' && toolName) {
      // Truncate long tool names
      const name = toolName.length > 12 ? toolName.slice(0, 12) + '...' : toolName;
      return name;
    }
    if (status === 'thinking') {
      const actionIndex = Math.floor(elapsedTime / 3) % ACTION_WORDS.length;
      return ACTION_WORDS[actionIndex];
    }
    return config.baseText;
  };

  const statusText = getStatusText();
  const currentSpinner = SPINNERS[animationPhase];

  return (
    <div className="flex h-8 items-center gap-2 animate-in fade-in duration-200">
      {/* Status indicator */}
      <div
        className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 ${config.bgColor} border-[#e5e4df] dark:border-[#3a3938]`}
      >
        {/* Animated spinner */}
        <span
          className={`text-sm transition-transform duration-300 ${
            animationPhase % 2 === 0 ? 'scale-110' : 'scale-100'
          } ${config.color}`}
        >
          {currentSpinner}
        </span>

        {/* Status text */}
        <span className={`text-xs font-medium ${config.color}`}>
          {statusText}
        </span>

        {/* Elapsed time */}
        <span className="text-[10px] text-[#6b6a68] dark:text-[#9a9893]">
          {elapsedTime}s
        </span>

        {/* Stoppable hint */}
        <span className="hidden sm:inline text-[10px] text-[#9a9893] dark:text-[#6b6a68]">
          · 可停止 (Esc)
        </span>

        {/* Queue count badge */}
        {queueCount > 0 && (
          <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            +{queueCount} 等待
          </span>
        )}
      </div>

      {/* Abort button */}
      {onAbort && (
        <button
          type="button"
          onClick={onAbort}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90 active:scale-95"
          aria-label="停止生成"
          title="停止生成 (Esc)"
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default ClaudeStatus;
