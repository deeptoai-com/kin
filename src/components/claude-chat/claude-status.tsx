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
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';

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
  // Unified palette (DESIGN-SYSTEM §1.2): active states = primary tint, idle = muted.
  // The emoji icon + label differentiate the state, so colour stays on-brand (no rainbow).
  idle: {
    icon: '✓',
    baseText: '就绪',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
  thinking: {
    icon: '💭',
    baseText: '正在思考',
    color: 'text-primary',
    bgColor: 'bg-accent',
  },
  reasoning: {
    icon: '🧠',
    baseText: '正在推理',
    color: 'text-primary',
    bgColor: 'bg-accent',
  },
  toolUse: {
    icon: '🔧',
    baseText: '工具执行中',
    color: 'text-primary',
    bgColor: 'bg-accent',
  },
  streaming: {
    icon: '✨',
    baseText: '正在生成',
    color: 'text-primary',
    bgColor: 'bg-accent',
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

type ToolNameVariant = 'full' | 'compact';

const formatToolName = (toolName: string, variant: ToolNameVariant = 'full') => {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const server = parts[1] || 'mcp';
    const tool = parts.length > 2 ? parts.slice(2).join('__') : '';
    if (variant === 'full' && tool) {
      return `MCP · ${server} · ${tool}`;
    }
    return `MCP · ${server}`;
  }
  return toolName;
};

const truncateLabel = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return value.slice(0, maxLength - 3) + '...';
};

export const ClaudeStatus: FC<ClaudeStatusProps> = ({
  status,
  toolName,
  onAbort,
  compact = false,
}) => {
  const content = useIntlayer('claude-chat');
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
      return formatToolName(toolName, 'full');
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
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
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
        className={`flex items-center justify-between rounded-lg border px-3 py-2 ${config.bgColor} border-border`}
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
            <span className="text-xs text-muted-foreground">
              ({elapsedTime}s)
            </span>
          </div>

          {/* Tool name badge */}
          {status === 'toolUse' && toolName && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground dark:bg-accent dark:text-accent-foreground">
              {formatToolName(toolName, 'compact')}
            </span>
          )}
        </div>

        {/* Abort button */}
        {onAbort && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 dark:bg-destructive/15 dark:text-destructive dark:hover:bg-destructive/25"
            title={toLocalizedString(content.status.stopEsc)}
          >
          <Cross2Icon className="h-3 w-3" />
          <span className="hidden sm:inline">{content.status.stop}</span>
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
    ? `工具执行中：${formatToolName(toolName, 'compact')}`
    : `${config.baseText}...`;

  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
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
  const content = useIntlayer('claude-chat');
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
      const name = formatToolName(toolName, 'compact');
      return truncateLabel(name, 16);
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
        className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 ${config.bgColor} border-border`}
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
        <span className="text-[10px] text-muted-foreground">
          {elapsedTime}s
        </span>

        {/* Stoppable hint */}
        <span className="hidden sm:inline text-[10px] text-muted-foreground">
          · 可停止 (Esc)
        </span>

        {/* Queue count badge */}
        {queueCount > 0 && (
          <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground dark:bg-accent dark:text-accent-foreground">
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
          aria-label={toLocalizedString(content.status.stop)}
          title={toLocalizedString(content.status.stopEsc)}
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default ClaudeStatus;
