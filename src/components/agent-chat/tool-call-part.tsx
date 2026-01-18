/**
 * Tool Call Part Component
 *
 * Displays tool invocations with their arguments and results.
 * Provides expandable details and status indicators.
 * Includes Diff view for Edit/Write tools.
 */

import { CheckCircledIcon, ChevronDownIcon, ChevronRightIcon, CrossCircledIcon, GearIcon } from '@radix-ui/react-icons';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { DiffView } from './diff-view';

interface ToolCallPartProps {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result?: unknown;
  isError?: boolean;
  status?: { type: string };
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
  status,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const autoExpandedRef = useRef(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // A tool is running if message is running AND this tool has no result yet
  const isRunning = status?.type === 'running' && result === undefined;
  const hasResult = result !== undefined;
  const style = getToolStyle(toolName);
  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);

  // Track elapsed time when running
  useEffect(() => {
    if (isRunning) {
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
  }, [isRunning]);
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
    <div className={`my-2 overflow-hidden rounded-lg border ${isRunning ? 'border-[#ae5630] ring-1 ring-[#ae5630]/30' : 'border-[#e5e4df] dark:border-[#3a3938]'} ${style.bg}`}>
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
          {isRunning && (
            <>
              <span className="text-[10px] text-[#ae5630]">{elapsedTime}s</span>
              <GearIcon className="h-4 w-4 animate-spin text-[#ae5630]" />
            </>
          )}
          {hasResult && !isError && (
            <CheckCircledIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
          )}
          {hasResult && isError && (
            <CrossCircledIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
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
                {args.file_path ? (
                  <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">
                    {String(args.file_path)}
                  </span>
                ) : null}
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
                {args.file_path ? (
                  <span className="font-mono text-[10px] text-green-600 dark:text-green-400">
                    {String(args.file_path)}
                  </span>
                ) : null}
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

          {/* Result */}
          {hasResult && (
            <div>
              <div className="mb-1 text-xs font-medium text-[#6b6a68] dark:text-[#9a9893]">
                {isError ? 'Error' : 'Result'}
              </div>
              <pre
                className={`max-h-64 overflow-auto rounded p-2 font-mono text-xs ${
                  isError
                    ? 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200'
                    : 'bg-[#1a1a18] text-[#eee] dark:bg-[#1f1e1b]'
                }`}
              >
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
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
    </div>
  );
};

export default ToolCallPart;
