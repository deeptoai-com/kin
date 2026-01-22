/**
 * Tool Call Part Component
 *
 * Displays tool invocations with their arguments and results.
 * Provides expandable details and status indicators.
 * Includes Diff view for Edit/Write tools.
 * Supports fullscreen overlay previews for various tool outputs.
 */

import { CheckCircledIcon, ChevronDownIcon, ChevronRightIcon, CrossCircledIcon, GearIcon } from '@radix-ui/react-icons';
import { Maximize2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useChatSessionStore, type ToolStatus } from '~/lib/chat-session-store';
import { DiffView } from './diff-view';
import {
  CodePreviewOverlay,
  TerminalPreviewOverlay,
  DiffPreviewOverlay,
  JSONPreviewOverlay,
  type ToolType,
} from '~/components/claude-chat/overlay';

interface ToolCallPartProps {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result?: unknown;
  isError?: boolean;
  toolStatus?: ToolStatus;
  status?: { type: string };
  // Backgrounded task fields (Craft-aligned)
  backgroundTaskId?: string;
  backgroundShellId?: string;
  intent?: string;
  command?: string;
  elapsedSeconds?: number;
}

// Tool-specific icons and colors
const getToolStyle = (toolName: string) => {
  const name = toolName.toLowerCase();

  if (name.includes('read') || name.includes('glob') || name.includes('grep')) {
    return { icon: '📄', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' };
  }
  if (name.includes('write') || name.includes('edit')) {
    return { icon: '✏️', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' };
  }
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) {
    return { icon: '💻', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/30' };
  }
  if (name.includes('web') || name.includes('fetch') || name.includes('search')) {
    return { icon: '🌐', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30' };
  }
  if (name.includes('task') || name.includes('agent')) {
    return { icon: '🤖', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/30' };
  }

  return { icon: '🔧', color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/30' };
};

// Format tool arguments for display
const formatArgs = (args: Record<string, unknown>, toolName: string): string => {
  const name = toolName.toLowerCase();

  // Special formatting for common tools
  if ((name.includes('read') || name.includes('write') || name.includes('edit')) && args.file_path) {
    return String(args.file_path);
  }
  if (name.includes('bash') && args.command) {
    const cmd = String(args.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if (name.includes('glob') && args.pattern) {
    return String(args.pattern);
  }
  if (name.includes('grep') && args.pattern) {
    return `"${args.pattern}"`;
  }
  // TodoWrite: show count of todos
  if (name === 'todowrite' && Array.isArray(args.todos)) {
    const todos = args.todos as Array<{ content?: string; status?: string }>;
    const pending = todos.filter(t => t.status === 'pending').length;
    const inProgress = todos.filter(t => t.status === 'in_progress').length;
    const completed = todos.filter(t => t.status === 'completed').length;
    return `${todos.length} tasks (${completed}✓ ${inProgress}⟳ ${pending}○)`;
  }
  // Task/Agent: show description
  if ((name === 'task' || name.includes('agent')) && args.description) {
    const desc = String(args.description);
    return desc.length > 50 ? desc.slice(0, 50) + '...' : desc;
  }

  // Default: show first key-value or truncated JSON
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  if (keys.length === 1) {
    const val = args[keys[0]];
    // Handle arrays and objects properly
    if (Array.isArray(val)) {
      return `${val.length} items`;
    }
    if (typeof val === 'object' && val !== null) {
      return `{${Object.keys(val).length} fields}`;
    }
    const strVal = String(val);
    return strVal.length > 50 ? strVal.slice(0, 50) + '...' : strVal;
  }
  return `${keys.length} params`;
};

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

const normalizeFilePath = (filePath: string) => filePath.replace(/^\/+/, '');

const encodeFilePath = (filePath: string) =>
  normalizeFilePath(filePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const buildWorkspaceFileUrl = (
  sessionId: string,
  filePath: string,
  options: { raw?: boolean; download?: boolean } = {}
) => {
  const params = new URLSearchParams();
  if (options.raw) params.set('raw', '1');
  if (options.download) params.set('download', '1');
  const query = params.toString();
  return `/api/workspace/${sessionId}/file/${encodeFilePath(filePath)}${query ? `?${query}` : ''}`;
};

export const ToolCallPart: FC<ToolCallPartProps> = ({
  toolName,
  args,
  argsText,
  result,
  isError,
  toolStatus,
  status,
  // Backgrounded task fields
  backgroundTaskId,
  backgroundShellId,
  intent,
  command,
  elapsedSeconds: propsElapsedSeconds,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const autoExpandedRef = useRef(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // Error details collapse state (default: collapsed)
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Overlay state
  const [overlayType, setOverlayType] = useState<'code' | 'terminal' | 'diff' | 'json' | null>(null);

  // Use toolStatus if available, otherwise fall back to legacy detection
  const isExecuting = toolStatus === 'executing' || (status?.type === 'running' && result === undefined);
  const isCompleted = toolStatus === 'completed' || (result !== undefined && !isError && toolStatus !== 'backgrounded');
  const isErrorState = toolStatus === 'error' || isError;
  const isBackgrounded = toolStatus === 'backgrounded';
  const hasResult = result !== undefined;
  const style = getToolStyle(toolName);
  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);

  // Use propsElapsedSeconds if available (from tool_progress), otherwise track locally
  const displayElapsedTime = propsElapsedSeconds ?? elapsedTime;

  // Track elapsed time when executing
  useEffect(() => {
    if (isExecuting) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      const timer = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(timer);
    } else {
      startTimeRef.current = null;
      setElapsedTime(0);
    }
  }, [isExecuting]);
  const parsedResult = useMemo(() => {
    if (!result) return null;
    if (typeof result === 'string') {
      const trimmed = result.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
      }
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    if (typeof result === 'object') {
      return result;
    }
    return null;
  }, [result]);

  const filesCreated = Array.isArray(parsedResult?.filesCreated) ? parsedResult.filesCreated : [];
  const filesUpdated = Array.isArray(parsedResult?.filesUpdated) ? parsedResult.filesUpdated : [];
  const fileOutputs = filesCreated.length > 0 ? filesCreated : filesUpdated;
  const hasFileOutputs = fileOutputs.length > 0;

  useEffect(() => {
    if (!autoExpandedRef.current && hasFileOutputs) {
      setIsExpanded(true);
      autoExpandedRef.current = true;
    }
  }, [hasFileOutputs]);

  return (
    <div className={`my-2 overflow-hidden rounded-lg border ${isExecuting ? 'border-[#ae5630] ring-1 ring-[#ae5630]/30' : isErrorState ? 'border-red-400 dark:border-red-600' : 'border-[#e5e4df] dark:border-[#3a3938]'} ${style.bg}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
      >
        {isExpanded ? (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-[#6b6a68] dark:text-[#9a9893]" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-[#6b6a68] dark:text-[#9a9893]" />
        )}

        <span className="text-base">{style.icon}</span>

        <span className={`font-medium ${style.color}`}>{toolName}</span>

        <span className="truncate text-xs text-[#6b6a68] dark:text-[#9a9893]">
          {formatArgs(args, toolName)}
        </span>

        {hasFileOutputs && (
          <span className="ml-2 rounded-full border border-[#e5e4df] px-2 py-0.5 text-[10px] text-[#6b6a68] dark:border-[#3a3938] dark:text-[#9a9893]">
            Outputs: {fileOutputs.length}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          {/* Status badge based on toolStatus */}
          {isExecuting && (
            <>
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                executing
              </span>
              <span className="text-[10px] text-[#ae5630]">{displayElapsedTime}s</span>
              <GearIcon className="h-4 w-4 animate-spin text-[#ae5630]" />
            </>
          )}
          {isBackgrounded && (
            <>
              <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                backgrounded
              </span>
              {(backgroundTaskId || backgroundShellId) && (
                <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400">
                  {backgroundTaskId ? `task:${backgroundTaskId.slice(0, 8)}` : `shell:${backgroundShellId?.slice(0, 8)}`}
                </span>
              )}
              {displayElapsedTime > 0 && (
                <span className="text-[10px] text-[#6b6a68] dark:text-[#9a9893]">{displayElapsedTime}s</span>
              )}
            </>
          )}
          {isCompleted && !isErrorState && !isBackgrounded && (
            <>
              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                completed
              </span>
              <CheckCircledIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
            </>
          )}
          {isErrorState && (
            <>
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                error
              </span>
              <CrossCircledIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
            </>
          )}
        </span>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="space-y-2 border-t border-[#e5e4df] px-3 py-2 dark:border-[#3a3938]">
          {/* Diff View for Edit tool */}
          {toolName.toLowerCase() === 'edit' && args.old_string !== undefined && args.new_string !== undefined && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[#6b6a68] dark:text-[#9a9893]">
                  Changes
                </span>
                <div className="flex items-center gap-2">
                  {args.file_path ? (
                    <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">
                      {String(args.file_path)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setOverlayType('diff')}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#6b6a68] hover:bg-black/5 dark:text-[#9a9893] dark:hover:bg-white/5"
                    title="View fullscreen"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span>Full</span>
                  </button>
                </div>
              </div>
              <DiffView
                oldString={String(args.old_string)}
                newString={String(args.new_string)}
                fileName={args.file_path ? String(args.file_path) : undefined}
              />
            </div>
          )}

          {/* Diff View for Write tool (new file) */}
          {toolName.toLowerCase() === 'write' && args.content !== undefined && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[#6b6a68] dark:text-[#9a9893]">
                  New File Content
                </span>
                <div className="flex items-center gap-2">
                  {args.file_path ? (
                    <span className="font-mono text-[10px] text-green-600 dark:text-green-400">
                      {String(args.file_path)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setOverlayType('code')}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#6b6a68] hover:bg-black/5 dark:text-[#9a9893] dark:hover:bg-white/5"
                    title="View fullscreen"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span>Full</span>
                  </button>
                </div>
              </div>
              <DiffView
                oldString=""
                newString={String(args.content)}
                fileName={args.file_path ? String(args.file_path) : undefined}
              />
            </div>
          )}

          {/* Arguments (hide raw JSON for Edit/Write tools that have diff view) */}
          {!(
            (toolName.toLowerCase() === 'edit' && args.old_string !== undefined && args.new_string !== undefined) ||
            (toolName.toLowerCase() === 'write' && args.content !== undefined)
          ) && (
            <div>
              <div className="mb-1 text-xs font-medium text-[#6b6a68] dark:text-[#9a9893]">
                Arguments
              </div>
              <pre className="overflow-x-auto rounded bg-[#1a1a18] p-2 font-mono text-xs text-[#eee] dark:bg-[#1f1e1b]">
                {argsText || JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result - for non-error state, show normally */}
          {hasResult && !isErrorState && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[#6b6a68] dark:text-[#9a9893]">
                  Result
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Determine overlay type based on tool and result
                    const name = toolName.toLowerCase();
                    // Force CodePreviewOverlay for Read tool or when args.file_path exists
                    if (name.includes('read') || args.file_path) {
                      setOverlayType('code');
                    } else if (name.includes('bash') || name.includes('grep') || name.includes('glob')) {
                      setOverlayType('terminal');
                    } else if (parsedResult && typeof parsedResult === 'object') {
                      setOverlayType('json');
                    } else {
                      setOverlayType('terminal');
                    }
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#6b6a68] hover:bg-black/5 dark:text-[#9a9893] dark:hover:bg-white/5"
                  title="View fullscreen"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>Full</span>
                </button>
              </div>
              <pre
                className="max-h-64 overflow-auto rounded p-2 font-mono text-xs bg-[#1a1a18] text-[#eee] dark:bg-[#1f1e1b]"
              >
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          {/* Error Result - collapsible technical details */}
          {hasResult && isErrorState && (
            <div>
              <button
                type="button"
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                {showErrorDetails ? (
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                )}
                <span>{showErrorDetails ? '隐藏技术细节' : '显示技术细节'}</span>
              </button>
              {showErrorDetails && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-red-600 dark:text-red-400">
                      Error Details
                    </span>
                    <button
                      type="button"
                      onClick={() => setOverlayType('terminal')}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#6b6a68] hover:bg-black/5 dark:text-[#9a9893] dark:hover:bg-white/5"
                      title="View fullscreen"
                    >
                      <Maximize2 className="h-3 w-3" />
                      <span>Full</span>
                    </button>
                  </div>
                  <pre
                    className="max-h-64 overflow-auto rounded p-2 font-mono text-xs bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200"
                  >
                    {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {hasFileOutputs && (
            <div>
              <div className="mb-1 text-xs font-medium text-[#6b6a68] dark:text-[#9a9893]">
                Generated Files
              </div>
              <div className="space-y-2">
                {fileOutputs.map((filePath: string) => {
                  const isImage = IMAGE_EXTENSIONS.test(filePath);
                  const sessionId = currentSessionId;
                  const rawUrl = sessionId
                    ? buildWorkspaceFileUrl(sessionId, filePath, { raw: true })
                    : null;
                  const downloadUrl = sessionId
                    ? buildWorkspaceFileUrl(sessionId, filePath, { raw: true, download: true })
                    : null;

                  return (
                    <div
                      key={filePath}
                      className="rounded border border-[#e5e4df] bg-white/70 p-2 text-xs dark:border-[#3a3938] dark:bg-[#1f1e1b]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-[#333] dark:text-[#e5e4df]">
                          {filePath}
                        </span>
                        {sessionId && (
                          <div className="flex items-center gap-2 text-[11px]">
                            {rawUrl && (
                              <a
                                href={rawUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline underline-offset-2"
                              >
                                Open
                              </a>
                            )}
                            {downloadUrl && (
                              <a
                                href={downloadUrl}
                                className="text-primary underline underline-offset-2"
                              >
                                Download
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      {sessionId && rawUrl && isImage && (
                        <div className="mt-2 overflow-hidden rounded border border-[#e5e4df] dark:border-[#3a3938]">
                          <img
                            src={rawUrl}
                            alt={filePath}
                            className="max-h-64 w-full object-contain bg-white dark:bg-[#111]"
                          />
                        </div>
                      )}
                      {!sessionId && (
                        <div className="mt-2 text-[11px] text-[#6b6a68] dark:text-[#9a9893]">
                          Workspace not available for download.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overlay Components */}
      {/* Diff Preview Overlay - for Edit tool */}
      <DiffPreviewOverlay
        isOpen={overlayType === 'diff'}
        onClose={() => setOverlayType(null)}
        oldContent={String(args.old_string ?? '')}
        newContent={String(args.new_string ?? '')}
        filePath={String(args.file_path ?? 'unknown')}
        error={isErrorState ? String(result) : undefined}
      />

      {/* Code Preview Overlay - for Write/Read tool */}
      <CodePreviewOverlay
        isOpen={overlayType === 'code'}
        onClose={() => setOverlayType(null)}
        content={typeof result === 'string' ? result : String(args.content ?? result ?? '')}
        filePath={String(args.file_path ?? 'file')}
        language={getLanguageFromPath(String(args.file_path ?? ''))}
        error={isErrorState ? String(result) : undefined}
      />

      {/* Terminal Preview Overlay - for Bash/Grep/Glob tool */}
      <TerminalPreviewOverlay
        isOpen={overlayType === 'terminal'}
        onClose={() => setOverlayType(null)}
        command={String(args.command ?? args.pattern ?? '')}
        output={typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        exitCode={isErrorState ? 1 : 0}
        toolType={getTerminalToolType(toolName)}
        error={isErrorState ? String(result) : undefined}
      />

      {/* JSON Preview Overlay - for structured results */}
      <JSONPreviewOverlay
        isOpen={overlayType === 'json'}
        onClose={() => setOverlayType(null)}
        data={parsedResult ?? result}
        title={`${toolName} Result`}
        error={isErrorState ? 'Tool execution failed' : undefined}
      />
    </div>
  );
};

/**
 * Get language from file path extension
 */
function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
  };
  return ext ? extMap[ext] : undefined;
}

/**
 * Get terminal tool type for overlay badge
 */
function getTerminalToolType(toolName: string): ToolType {
  const name = toolName.toLowerCase();
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) return 'bash';
  if (name.includes('grep')) return 'grep';
  if (name.includes('glob')) return 'glob';
  return 'bash';
}

export default ToolCallPart;
