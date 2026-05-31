import { useMemo, useState, useEffect, useRef, type FC } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileText, Loader2, MessageCircleDashed, Search, X, XCircle } from 'lucide-react';
import { useIsMobile } from '~/hooks/use-mobile';
import { Button } from '~/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '~/components/ui/drawer';
import { Tag } from '~/components/foundation/tag';
import { Kicker } from '~/components/foundation/kicker';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { CodeBlock } from '~/components/claude-chat/code-block';
import { ImageArtifact } from '~/components/claude-chat/artifact-image';
import { DiffView } from '~/components/agent-chat/diff-view';
import { cn } from '~/lib/utils';
import { parseSearchResult, type SearchSource } from '~/lib/search-results';
import { buildAssistantTurn, formatArgsSummary, stripMarkdown, truncate, type RenderItem, type SearchGroup, type StepActivity, type StepActivityStatus } from '~/lib/turn-builder';
import { useChatSessionStore, type ContentPart } from '~/lib/chat-session-store';
import { readWorkspaceBinaryFile, getMimeType } from '~/lib/artifacts/artifact-registry';
import { extractImagePaths } from '~/lib/artifacts/image-utils';

export interface AssistantTurnCardProps {
  content: ContentPart[] | undefined;
  status?: { type: string };
  onFileClick?: (path: string) => void;
  onUrlClick?: (url: string) => void;
}

type DetailTarget = StepActivity | SearchGroup;

const TEXT_FIELDS = ['text', 'content', 'message', 'result', 'output', 'stdout', 'stderr', 'summary', 'description'];

function isSearchGroup(target: DetailTarget): target is SearchGroup {
  return (target as SearchGroup).type === 'search-group';
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isLikelyJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function extractTextFromUnknown(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFromUnknown(item));
  }
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    const candidate = record[key];
    if (typeof candidate === 'string') return [candidate];
    if (Array.isArray(candidate)) return extractTextFromUnknown(candidate);
  }

  return [];
}

function formatToolResultText(result: unknown): string {
  if (typeof result === 'string') {
    if (!result.trim()) return '';
    if (isLikelyJson(result)) {
      const parsed = tryParseJson(result);
      if (parsed !== null) {
        return extractTextFromUnknown(parsed).join('\n').trim();
      }
      return '';
    }
    return result;
  }

  return extractTextFromUnknown(result).join('\n').trim();
}

function ActivityStatusIcon({ status }: { status: StepActivityStatus }) {
  if (status === 'running' || status === 'backgrounded') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--assistant-accent)]" />;
  }
  if (status === 'error') {
    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  }
  return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
}

function TimelineDot({ status }: { status?: StepActivityStatus }) {
  if (status === 'error') {
    return <span className="h-2 w-2 rounded-full bg-destructive" />;
  }
  if (status === 'running' || status === 'backgrounded') {
    return <span className="h-2 w-2 rounded-full bg-[var(--assistant-accent)]" />;
  }
  return <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />;
}

function renderSourceList(sources: SearchSource[], onUrlClick?: (url: string) => void) {
  return (
    <div className="space-y-2">
      {sources.map((source, index) => (
        <div
          key={`${source.url || source.title}-${index}`}
          className="rounded-md border border-[var(--assistant-source-border)] bg-[var(--assistant-source-bg)] p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{source.title}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {source.domain && (
                <div className="text-xs text-muted-foreground">{source.domain}</div>
              )}
              {source.url && (
                <Tag
                  asChild
                  tone="ghost"
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (onUrlClick) {
                        onUrlClick(source.url);
                      } else {
                        window.open(source.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    打开
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </Tag>
              )}
            </div>
          </div>
          {source.snippet && (
            <p className="mt-2 text-sm text-muted-foreground">{source.snippet}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityDetailDrawer({
  target,
  open,
  onOpenChange,
  onUrlClick,
}: {
  target: DetailTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUrlClick?: (url: string) => void;
}) {
  const isMobile = useIsMobile();
  const sessionId = useChatSessionStore((state) => state.currentSessionId);
  const [imageFiles, setImageFiles] = useState<Array<{ filePath: string; content: string; mimeType?: string }>>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const detail = useMemo(() => {
    if (!target) return null;
    if (isSearchGroup(target)) {
      return {
        type: 'search',
        title: target.displayName || 'Web Search',
        sources: target.sources,
        rawText: target.rawText,
        queries: target.queries,
        notes: target.notes,
      } as const;
    }

    if (target.kind === 'intermediate' || target.kind === 'reasoning') {
      return {
        type: 'text',
        title: target.kind === 'reasoning' ? '思考过程' : '中间过程',
        content: target.text,
      } as const;
    }

    const toolName = target.toolName.toLowerCase();
    const resultText = formatToolResultText(target.result);
    const imagePaths = extractImagePaths(target.args, target.result);

    if (!toolName.includes('search') && imagePaths.length > 0) {
      return {
        type: 'images',
        title: target.displayName,
        imagePaths,
      } as const;
    }

    if (toolName.includes('search')) {
      const searchResult = parseSearchResult(target.result);
      return {
        type: 'search',
        title: target.displayName,
        sources: searchResult.sources,
        rawText: searchResult.rawText,
        queries: [],
        notes: [],
      } as const;
    }

    if (toolName === 'read') {
      const parsed = parseReadResult(target.result);
      return {
        type: 'code',
        title: target.displayName,
        content: parsed.content,
        language: parsed.language,
      } as const;
    }

    if (toolName === 'edit') {
      const oldString = (target.args as { old_string?: string }).old_string || '';
      const newString = (target.args as { new_string?: string }).new_string || '';
      const filePath = (target.args as { file_path?: string }).file_path || 'Diff';
      return {
        type: 'diff',
        title: target.displayName,
        oldString,
        newString,
        filePath,
      } as const;
    }

    if (toolName === 'write') {
      const content = (target.args as { content?: string }).content || resultText;
      const filePath = (target.args as { file_path?: string }).file_path || 'Output';
      return {
        type: 'code',
        title: target.displayName,
        content,
        language: guessLanguage(filePath),
      } as const;
    }

    if (toolName === 'bash' || toolName === 'grep' || toolName === 'glob') {
      const parsed = parseTerminalResult(target.result);
      const command = (target.args as { command?: string; pattern?: string }).command || (target.args as { pattern?: string }).pattern || '';
      return {
        type: 'terminal',
        title: target.displayName,
        command,
        output: parsed.output,
      } as const;
    }

    return {
      type: 'text',
      title: target.displayName,
      content: resultText || formatArgsSummary(target.args) || '',
    } as const;
  }, [target]);

  useEffect(() => {
    let isCancelled = false;
    if (!open || !detail || detail.type !== 'images') {
      setImageFiles([]);
      setImageError(null);
      setImageLoading(false);
      return undefined;
    }
    if (!sessionId) {
      setImageFiles([]);
      setImageError('会话不可用');
      setImageLoading(false);
      return undefined;
    }

    const run = async () => {
      setImageLoading(true);
      setImageError(null);
      try {
        const files = (await Promise.all(
          detail.imagePaths.map(async (filePath) => {
            const mimeType = getMimeType(filePath);
            const content = await readWorkspaceBinaryFile(sessionId, filePath, mimeType);
            if (!content) return null;
            return { filePath, content, mimeType };
          })
        ))
          .filter(Boolean) as Array<{ filePath: string; content: string; mimeType?: string }>;

        if (!isCancelled) {
          setImageFiles(files);
          if (files.length === 0) {
            setImageError('未找到可预览的图片');
          }
        }
      } catch (error) {
        if (!isCancelled) {
          setImageError(error instanceof Error ? error.message : '图片加载失败');
          setImageFiles([]);
        }
      } finally {
        if (!isCancelled) {
          setImageLoading(false);
        }
      }
    };

    run();

    return () => {
      isCancelled = true;
    };
  }, [detail, open, sessionId]);

  if (!detail) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={isMobile ? 'bottom' : 'right'}>
      <DrawerContent className="h-[100dvh] min-h-[100dvh] max-h-[100dvh] sm:max-w-xl">
        <DrawerHeader className="flex flex-row items-center justify-between gap-3">
          <DrawerTitle className="text-base font-semibold">{detail.title}</DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
          {detail.type === 'search' && (
            <>
              {detail.queries && detail.queries.length > 0 && (
                <div>
                  <Kicker>Searching</Kicker>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detail.queries.map((query) => (
                      <Tag key={query} tone="ghost" className="text-xs">
                        {query}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
              {detail.sources.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Search className="h-4 w-4" />
                    来源
                  </div>
                  {renderSourceList(detail.sources, onUrlClick)}
                </div>
              ) : (
                <div className="rounded-md border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                  暂无结构化来源
                </div>
              )}
              {detail.notes && detail.notes.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <MessageCircleDashed className="h-4 w-4" />
                    过程摘要
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                    {detail.notes.join('\n\n')}
                  </div>
                </div>
              )}
              {detail.rawText && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4" />
                    原始信息
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                    {detail.rawText}
                  </div>
                </div>
              )}
            </>
          )}

          {detail.type === 'diff' && (
            <DiffView
              oldString={detail.oldString}
              newString={detail.newString}
              fileName={detail.filePath}
              maxHeight="360px"
            />
          )}

          {detail.type === 'code' && (
            <CodeBlock code={detail.content} language={detail.language} mode="full" className="w-full" />
          )}

          {detail.type === 'terminal' && (
            <div className="space-y-3">
              {detail.command && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap">
                  {detail.command}
                </div>
              )}
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm font-mono whitespace-pre-wrap">
                {detail.output || '(no output)'}
              </div>
            </div>
          )}

          {detail.type === 'images' && (
            <div className="space-y-3">
              {imageLoading && (
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载图片…
                </div>
              )}
              {!imageLoading && imageError && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  {imageError}
                </div>
              )}
              {!imageLoading && !imageError && imageFiles.length > 0 && (
                <div className="h-[60vh] rounded-md border border-border/60 bg-background/80">
                  <ImageArtifact
                    content={imageFiles[0].content}
                    title={detail.title}
                    mimeType={imageFiles[0].mimeType}
                    images={imageFiles}
                  />
                </div>
              )}
              {!imageLoading && imageFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {imageFiles.map((file) => (
                    <Tag key={file.filePath} tone="ghost" className="text-xs">
                      {file.filePath.split('/').pop() || file.filePath}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          )}

          {detail.type === 'text' && (
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <StreamingMarkdown content={detail.content || '暂无可展示结果'} isStreaming={false} mode="minimal" onUrlClick={onUrlClick} />
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function parseReadResult(rawResult: unknown): { content: string; language?: string } {
  if (rawResult && typeof rawResult === 'object') {
    const parsed = rawResult as { file?: { content?: string; path?: string }; content?: string; path?: string };
    if (parsed.file?.content) {
      return { content: parsed.file.content, language: guessLanguage(parsed.file.path || '') };
    }
    if (typeof parsed.content === 'string') {
      return { content: parsed.content, language: guessLanguage(parsed.path || '') };
    }
  }

  if (typeof rawResult === 'string') {
    try {
      const parsed = JSON.parse(rawResult);
      if (parsed?.file?.content) {
        return { content: parsed.file.content, language: guessLanguage(parsed.file.path || '') };
      }
      if (typeof parsed?.content === 'string') {
        return { content: parsed.content, language: guessLanguage(parsed.path || '') };
      }
    } catch {
      // ignore
    }
    return isLikelyJson(rawResult) ? { content: '' } : { content: rawResult };
  }

  return { content: '' };
}

function parseTerminalResult(rawResult: unknown): { output: string } {
  if (rawResult && typeof rawResult === 'object') {
    const parsed = rawResult as { stdout?: string; stderr?: string; output?: string };
    if (parsed.stdout !== undefined || parsed.stderr !== undefined) {
      const stdout = parsed.stdout || '';
      const stderr = parsed.stderr || '';
      return { output: stdout + (stderr ? `\n${stderr}` : '') };
    }
    if (typeof parsed.output === 'string') {
      return { output: parsed.output };
    }
  }

  if (typeof rawResult === 'string') {
    try {
      const parsed = JSON.parse(rawResult);
      if (parsed?.stdout !== undefined || parsed?.stderr !== undefined) {
        const stdout = parsed.stdout || '';
        const stderr = parsed.stderr || '';
        return { output: stdout + (stderr ? `\n${stderr}` : '') };
      }
      if (typeof parsed?.output === 'string') {
        return { output: parsed.output };
      }
    } catch {
      // ignore
    }
    return { output: isLikelyJson(rawResult) ? '' : rawResult };
  }

  return { output: '' };
}

function guessLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return 'text';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  if (ext === 'py') return 'python';
  if (ext === 'sh') return 'bash';
  if (ext === 'css') return 'css';
  if (ext === 'html') return 'html';
  return ext;
}

export const AssistantTurnCard: FC<AssistantTurnCardProps> = ({
  content,
  status,
  onFileClick,
  onUrlClick,
}) => {
  const isRunning = status?.type === 'running';
  const { activities, responseText, responseIsStreaming, hasPendingText, previewText, renderItems } = useMemo(
    () => buildAssistantTurn(content, isRunning),
    [content, isRunning]
  );

  const hasResponse = Boolean(responseText);
  const hasActivities = activities.length > 0;

  const [isExpanded, setIsExpanded] = useState(hasActivities && isRunning);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<DetailTarget | null>(null);

  // D1.4 注意力策略：running 时展开过程区(实时进度可见)；turn 完成且已有最终答案时
  // 自动折叠成一行摘要，让 final answer 主导视线(用户仍可手动点开看过程)。
  useEffect(() => {
    if (isRunning && hasActivities) {
      setIsExpanded(true);
    } else if (!isRunning && hasResponse) {
      setIsExpanded(false);
    }
  }, [isRunning, hasActivities, hasResponse]);

  const handleOpenDetail = (target: DetailTarget) => {
    setSelectedDetail(target);
    setDetailOpen(true);
  };


  return (
    <div className="space-y-2">
      {hasActivities && (
        <div className="rounded-lg bg-[var(--assistant-step-bg)]">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/30"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Tag tone="ghost" className="tabular-nums">
              {renderItems.length}
            </Tag>
            <span className="truncate flex-1">{previewText}</span>
          </button>

          {isExpanded && (
            <div className="mt-1 space-y-2 border-l border-muted/40 pl-3 [&_ul]:list-none [&_ol]:list-none [&_li]:list-none">
              {renderItems.map((item) => {
                if (item.type === 'activity') {
                  const activity = item.activity;
                  if (activity.kind === 'intermediate' || activity.kind === 'reasoning') {
                    const summary = activity.text ? truncate(stripMarkdown(activity.text), 80) : 'Thinking…';
                    const canOpenDetail = Boolean(activity.text);
                    const rowContent = (
                      <>
                        {activity.status === 'running' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <MessageCircleDashed className="h-3.5 w-3.5" />
                        )}
                        <span className="truncate flex-1">{summary || 'Thinking…'}</span>
                      </>
                    );
                    return (
                      canOpenDetail ? (
                        <button
                          key={activity.id}
                          type="button"
                          onClick={() => handleOpenDetail(activity)}
                          className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground transition hover:text-foreground"
                        >
                          {rowContent}
                        </button>
                      ) : (
                        <div key={activity.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          {rowContent}
                        </div>
                      )
                    );
                  }

                  const argsSummary = formatArgsSummary(activity.args);
                  const summary = argsSummary ? `${activity.displayName} · ${argsSummary}` : activity.displayName;
                  return (
                    <button
                      key={activity.id}
                      type="button"
                      onClick={() => handleOpenDetail(activity)}
                      className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground transition hover:text-foreground"
                    >
                      <ActivityStatusIcon status={activity.status} />
                      <span className="truncate flex-1">{summary}</span>
                    </button>
                  );
                }

                const group = item.group;
                const groupLabel = group.sources.length > 0
                  ? `Reviewed ${group.sources.length} sources`
                  : 'Reviewing sources';
                const heading = group.displayName ? `${group.displayName} · ${groupLabel}` : groupLabel;

                return (
                  <div key={group.id} className="rounded-md bg-muted/10 p-3">
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(group)}
                      className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground transition hover:text-foreground"
                    >
                      {group.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--assistant-accent)]" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      <span className="truncate flex-1">{heading}</span>
                      <Tag tone="ghost">搜索</Tag>
                    </button>

                    {group.notes.length > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {truncate(stripMarkdown(group.notes[group.notes.length - 1]), 120)}
                      </div>
                    )}

                    {group.queries.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <Kicker>Searching</Kicker>
                        <div className="flex flex-wrap gap-2">
                          {group.queries.map((query) => (
                            <Tag key={query} tone="ghost" className="text-xs">
                              {query}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {group.sources.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <Kicker>Reviewing sources</Kicker>
                        <div className="rounded-md bg-background/70 p-2">
                          {group.sources.slice(0, 8).map((source, index) => (
                            <div key={`${source.title}-${index}`} className="flex items-center justify-between gap-2 py-1 text-xs text-muted-foreground">
                              <span className="truncate">{source.title}</span>
                              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                                {source.domain || 'source'}
                              </span>
                            </div>
                          ))}
                        </div>
                        {group.sources.length > 8 && (
                          <div className="text-xs text-muted-foreground">
                            还有 {group.sources.length - 8} 条来源…
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {(hasPendingText || (isRunning && !hasResponse)) && (
                <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在准备答案…</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {hasResponse && (
        <div className={cn('rounded-lg bg-transparent p-4', hasActivities && 'mt-2')}>
          <StreamingMarkdown
            content={responseText}
            isStreaming={responseIsStreaming}
            mode="minimal"
            onUrlClick={onUrlClick}
            onFileClick={onFileClick}
          />
        </div>
      )}

      <ActivityDetailDrawer
        target={selectedDetail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUrlClick={onUrlClick}
      />
    </div>
  );
};

export default AssistantTurnCard;
