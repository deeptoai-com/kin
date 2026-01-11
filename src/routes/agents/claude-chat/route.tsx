/**
 * Claude-Style Agent Chat Page
 *
 * A Claude.ai-inspired UI for the Claude Agent SDK.
 * Based on https://www.assistant-ui.com/examples/claude
 */

import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  useMessage,
} from '@assistant-ui/react';
import * as Avatar from '@radix-ui/react-avatar';
import {
  ArrowUpIcon,
  BarChartIcon,
  ChevronDownIcon,
  ClipboardIcon,
  Cross2Icon,
  InfoCircledIcon,
  MixerHorizontalIcon,
  Pencil1Icon,
  PlusIcon,
  ReloadIcon,
} from '@radix-ui/react-icons';
import { AuthLoading, RedirectToSignIn, SignedIn } from '@daveyplate/better-auth-ui';
import { createFileRoute } from '@tanstack/react-router';
import { ThumbsDown, ThumbsUp, FolderOpen, Plus } from 'lucide-react';
import { useEffect, useState, useCallback, type FC } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownText } from '~/components/assistant-ui/markdown-text';
import { SessionList } from '~/components/claude-chat/session-list';
import { UsageCard } from '~/components/claude-chat/usage-card';
import { SessionInfoPanel } from '~/components/claude-chat/session-info-panel';
import { ArtifactsPanel } from '~/components/claude-chat/artifacts-panel';
import { ArtifactButton } from '~/components/claude-chat/artifact-button';
import { ReasoningPart } from '~/components/agent-chat/reasoning-part';
import { ToolCallPart } from '~/components/agent-chat/tool-call-part';
import { KnowledgeBasePanel } from '~/components/claude-chat/knowledge-base-panel';
import { useArtifactDetection } from '~/lib/hooks/use-artifact-detection';
import { useArtifactsStore } from '~/lib/stores/artifacts-store';
// Use WebSocket adapter for more reliable real-time communication
import {
  ClaudeAgentWSAdapter,
  getSessionId,
  resumeSession,
  newSession,
  onSessionInit,
  checkIsQueryRunning,
} from '~/claude/adapters';
import {
  useChatSessionStore,
  onMessagesLoaded,
  type SDKMessage,
  type ThreadMessage,
  type TextContentPart,
  type ContentPart,
} from '~/lib/chat-session-store';

export const Route = createFileRoute('/agents/claude-chat')({
  component: RouteComponent,
});

function RouteComponent() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // Key to force re-mount of chat surface when session changes
  const [chatKey, setChatKey] = useState(0);
  // Session list expand/collapse state
  const [sessionListExpanded, setSessionListExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sessionListExpanded');
      return saved ? JSON.parse(saved) : false;
    }
    return false;
  });
  // Pending session switch confirmation
  const [pendingSessionSwitch, setPendingSessionSwitch] = useState<{
    targetSessionId: string | null;
    isNewSession: boolean;
  } | null>(null);

  // Save session list expanded state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sessionListExpanded', JSON.stringify(sessionListExpanded));
    }
  }, [sessionListExpanded]);

  const { loadHistoricalMessages, clearMessages, setSessionId } = useChatSessionStore();

  // Artifacts state - controls layout behavior
  const activeArtifactId = useArtifactsStore((state) => state.activeArtifactId);
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact);

  // Listen for messages loaded events from WebSocket
  // Note: We do NOT increment chatKey here because that would cause
  // the component to remount, which triggers abort on any running query
  useEffect(() => {
    const unsubscribe = onMessagesLoaded((messages: SDKMessage[]) => {
      console.log('[Route] Received messages_loaded callback with', messages.length, 'messages');
      loadHistoricalMessages(messages);
      // Historical messages are stored in zustand and rendered separately,
      // no need to remount the component
    });

    return unsubscribe;
  }, [loadHistoricalMessages]);

  // Sync with adapter's session ID on mount
  useEffect(() => {
    const sessionId = getSessionId();
    if (sessionId) {
      setCurrentSessionId(sessionId);
      setSessionId(sessionId);
    }
  }, [setSessionId]);

  // Listen for session init events to keep route state in sync with adapter
  useEffect(() => {
    const unsubscribe = onSessionInit((sessionId: string) => {
      console.log('[Route] Session initialized, updating state:', sessionId);
      setCurrentSessionId(sessionId);
      setSessionId(sessionId);
    });
    return unsubscribe;
  }, [setSessionId]);

  // Perform the actual session switch (after confirmation or if no query running)
  const performSessionSwitch = useCallback(async (sdkSessionId: string | null, isNewSession: boolean) => {
    if (isNewSession) {
      console.log('[Route] Starting new session');
      setCurrentSessionId(null);
      setSessionId(null);
      clearMessages();
      newSession();
      setChatKey((k) => k + 1);
    } else if (sdkSessionId) {
      console.log('[Route] Selecting session:', sdkSessionId);
      setCurrentSessionId(sdkSessionId);
      setSessionId(sdkSessionId);
      clearMessages();
      setChatKey((k) => k + 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await resumeSession(sdkSessionId);
    }
  }, [setSessionId, clearMessages]);

  const handleSelectSession = useCallback(async (sdkSessionId: string) => {
    // Check both route state and adapter state for current session
    // This prevents abort during active query when user clicks on current session
    const adapterSessionId = getSessionId();
    if (sdkSessionId === currentSessionId || sdkSessionId === adapterSessionId) {
      console.log('[Route] Session already active, skipping:', sdkSessionId);
      return;
    }

    // Check if a query is currently running
    if (checkIsQueryRunning()) {
      console.log('[Route] Query running, showing confirmation dialog');
      setPendingSessionSwitch({ targetSessionId: sdkSessionId, isNewSession: false });
      return;
    }

    await performSessionSwitch(sdkSessionId, false);
  }, [currentSessionId, performSessionSwitch]);

  const handleNewSession = useCallback(() => {
    // Check if a query is currently running
    if (checkIsQueryRunning()) {
      console.log('[Route] Query running, showing confirmation dialog for new session');
      setPendingSessionSwitch({ targetSessionId: null, isNewSession: true });
      return;
    }

    performSessionSwitch(null, true);
  }, [performSessionSwitch]);

  const handleCancelSwitch = useCallback(() => {
    console.log('[Route] User cancelled session switch');
    setPendingSessionSwitch(null);
  }, []);

  const isDev = process.env.NODE_ENV !== 'production';

  // Dev mode: skip client-side auth check
  if (isDev) {
    return (
      <div className="h-full">
        <div className="flex h-full">
          {/* Session List - only show when no artifact */}
          {!activeArtifactId && (
            <SessionList
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              isExpanded={sessionListExpanded}
              onToggleExpanded={() => setSessionListExpanded(!sessionListExpanded)}
            />
          )}

          {/* Chat Surface - always mounted, width changes based on artifact state */}
          <div className={activeArtifactId ? "w-1/3 h-full shrink-0" : "flex-1 h-full relative"}>
            {/* Floating action buttons - only show when no artifact */}
            {!activeArtifactId && (
              <div className="absolute top-4 left-4 z-10 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSessionListExpanded(!sessionListExpanded)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border shadow-sm transition-colors hover:bg-accent"
                  aria-label={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                  title={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
                {!sessionListExpanded && (
                  <button
                    type="button"
                    onClick={handleNewSession}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    aria-label="新建对话"
                    title="新建对话"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <ClaudeChatSurface key={chatKey} />
          </div>

          {/* Artifacts Panel - only show when artifact exists */}
          {activeArtifactId && (
            <div className="w-2/3 h-full shrink-0 border-l">
              <ArtifactsPanel
                artifactId={activeArtifactId}
                onClose={() => setActiveArtifact(null)}
              />
            </div>
          )}
        </div>

        {pendingSessionSwitch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 max-w-md rounded-xl bg-card p-6 shadow-xl">
              <h3 className="mb-3 text-lg font-semibold text-foreground">
                请稍候
              </h3>
              <p className="mb-6 text-muted-foreground">
                当前会话正在接收回复，请等待回复完成后再切换会话。
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelSwitch}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Production: use full auth flow
  return (
    <div className="h-full">
      <AuthLoading>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Checking your session...
        </div>
      </AuthLoading>

      <RedirectToSignIn />

      <SignedIn>
        <div className="flex h-full">
          {/* Session List - only show when no artifact */}
          {!activeArtifactId && (
            <SessionList
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              isExpanded={sessionListExpanded}
              onToggleExpanded={() => setSessionListExpanded(!sessionListExpanded)}
            />
          )}

          {/* Chat Surface - always mounted, width changes based on artifact state */}
          <div className={activeArtifactId ? "w-1/3 h-full shrink-0" : "flex-1 h-full relative"}>
            {/* Floating action buttons - only show when no artifact */}
            {!activeArtifactId && (
              <div className="absolute top-4 left-4 z-10 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSessionListExpanded(!sessionListExpanded)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border shadow-sm transition-colors hover:bg-accent"
                  aria-label={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                  title={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
                {!sessionListExpanded && (
                  <button
                    type="button"
                    onClick={handleNewSession}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    aria-label="新建对话"
                    title="新建对话"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <ClaudeChatSurface key={chatKey} />
          </div>

          {/* Artifacts Panel - only show when artifact exists */}
          {activeArtifactId && (
            <div className="w-2/3 h-full shrink-0 border-l">
              <ArtifactsPanel
                artifactId={activeArtifactId}
                onClose={() => setActiveArtifact(null)}
              />
            </div>
          )}
        </div>

        {pendingSessionSwitch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 max-w-md rounded-xl bg-card p-6 shadow-xl">
              <h3 className="mb-3 text-lg font-semibold text-foreground">
                请稍候
              </h3>
              <p className="mb-6 text-muted-foreground">
                当前会话正在接收回复，请等待回复完成后再切换会话。
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelSwitch}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </SignedIn>
    </div>
  );
}

function ClaudeChatSurface() {
  const runtime = useLocalRuntime(ClaudeAgentWSAdapter);
  const historicalMessages = useChatSessionStore((state) => state.messages);
  const hasHistoricalMessages = historicalMessages.length > 0;

  // Session info panel state
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const sessionMetadata = useChatSessionStore((state) => state.sessionMetadata);

  // Workspace panel state (session-level, persists across messages)
  const [showWorkspace, setShowWorkspace] = useState(false);
  const currentSessionId = getSessionId();

  return (
    <div className="flex h-full flex-col">
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex h-full flex-col items-stretch bg-background p-4 pt-16 font-sans">
          <ThreadPrimitive.Viewport className="flex-1 min-h-0 overflow-y-auto">
            {/* Show empty state only when no historical messages */}
            {!hasHistoricalMessages && (
              <ThreadPrimitive.Empty>
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="text-4xl font-semibold text-foreground">
                    Claude Agent
                  </div>
                  <p className="max-w-md text-muted-foreground">
                    Powered by Claude Agent SDK. I can read files, execute code, and help with various
                    tasks.
                  </p>
                </div>
              </ThreadPrimitive.Empty>
            )}

            {/* Render historical messages from store */}
            {historicalMessages.map((msg) => (
              <HistoricalMessage key={msg.id} message={msg} />
            ))}

            {/* Render live messages from runtime */}
            <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
            <div aria-hidden="true" className="h-4" />
          </ThreadPrimitive.Viewport>

          <ComposerPrimitive.Root className="shrink-0 mx-auto flex w-full max-w-3xl flex-col rounded-2xl border border-transparent bg-card p-0.5 shadow-sm transition-shadow duration-200 focus-within:shadow-md hover:shadow">
            <div className="m-3.5 flex flex-col gap-3.5">
              <div className="relative">
                <div className="wrap-break-word max-h-96 w-full overflow-y-auto">
                  <ComposerPrimitive.Input
                    placeholder="How can I help you today?"
                    className="block min-h-6 w-full resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div className="flex w-full items-center gap-2">
                <div className="relative flex min-w-0 flex-1 shrink items-center gap-2">
                  <ComposerPrimitive.AddAttachment className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98]">
                    <PlusIcon width={16} height={16} />
                  </ComposerPrimitive.AddAttachment>
                  <button
                    type="button"
                    className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98]"
                    aria-label="Open tools menu"
                  >
                    <MixerHorizontalIcon width={16} height={16} />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 min-w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98]"
                    aria-label="Extended thinking"
                  >
                    <ReloadIcon width={16} height={16} />
                  </button>
                </div>
                <button
                  type="button"
                  className="flex h-8 min-w-16 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 pr-2 pl-2.5 text-foreground text-xs transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-accent active:scale-[0.985]"
                >
                  <span className="font-serif text-[14px]">GLM 4.7</span>
                  <ChevronDownIcon width={20} height={20} className="opacity-75" />
                </button>

                {/* Workspace Toggle Button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowWorkspace(!showWorkspace)}
                    className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="切换工作空间"
                    disabled={!currentSessionId}
                  >
                    <FolderOpen width={16} height={16} />
                  </button>

                  {/* Workspace Panel */}
                  {showWorkspace && currentSessionId && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 w-80 rounded-lg border border-[#e5e4df] bg-white p-4 shadow-lg dark:border-[#3a3938] dark:bg-[#1f1e1b]">
                      {/* Header */}
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="font-semibold text-[#1a1a18] text-sm dark:text-[#eee]">
                          📚 Knowledge Base
                        </h3>
                        <button
                          onClick={() => setShowWorkspace(false)}
                          className="rounded p-1 text-[#6b6a68] transition hover:bg-[#e5e4df] dark:text-[#9a9893] dark:hover:bg-[#3a3938]"
                          aria-label="关闭"
                        >
                          <Cross2Icon width={14} height={14} />
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <KnowledgeBasePanel sessionId={currentSessionId} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Session Info Button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSessionInfo(!showSessionInfo)}
                    className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="查看会话信息"
                    disabled={!sessionMetadata}
                  >
                    <InfoCircledIcon width={16} height={16} />
                  </button>

                  {/* Session Info Panel */}
                  {showSessionInfo && sessionMetadata && (
                    <SessionInfoPanel
                      data={sessionMetadata}
                      onClose={() => setShowSessionInfo(false)}
                    />
                  )}
                </div>

                <ComposerPrimitive.Send className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-50">
                  <ArrowUpIcon width={16} height={16} />
                </ComposerPrimitive.Send>
              </div>
            </div>
            <ComposerAttachmentsSection />
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}

const ComposerAttachmentsSection: FC = () => {
  // Note: Attachments display is simplified - the full implementation would require
  // using useComposer() hook to check attachment state
  return (
    <div className="hidden has-[[data-attachments]]:block overflow-hidden rounded-b-2xl">
      <div className="overflow-x-auto rounded-b-2xl border border-t bg-muted p-3.5">
        <div className="flex flex-row gap-3" data-attachments>
          <ComposerPrimitive.Attachments components={{ Attachment: ClaudeAttachment }} />
        </div>
      </div>
    </div>
  );
};

/**
 * Assistant Message Component - with manual part rendering
 * Manually renders all content parts to support custom tool-call type
 */
const AssistantMessage: FC<{ isLast: boolean }> = ({ isLast }) => {
  // Get message using the hook to access runtime context
  const message = useMessage();
  const messageStatus = message.status;

  // Access content parts - cast to our ContentPart type
  const messageContent = (message as any).content as ContentPart[] | undefined;
  const isRunning = messageStatus?.type === 'running';
  const hasContent = (messageContent?.length ?? 0) > 0;

  // State for showing usage card
  const [showUsageCard, setShowUsageCard] = useState(false);

  // Get usage data from store (only show for last message)
  const usageData = useChatSessionStore((state) => state.usageData);

  // Artifact detection - pass full content array to support both text and tool-call detection
  const artifact = useArtifactDetection(message.id, messageContent);
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact);

  return (
    <MessagePrimitive.Root className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
      <div className="relative mb-12 font-sans">
        <div className="relative leading-[1.65rem]">
          <div className="grid grid-cols-1 gap-2.5">
            <div className="wrap-break-word whitespace-normal pr-8 pl-2 text-foreground">
              {isRunning && !hasContent && (
                <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#ae5630]" />
                  <span>Thinking...</span>
                </div>
              )}

              {/* Manual rendering to support custom tool-call type */}
              {messageContent?.map((part, index) => {
                if (part.type === 'text') {
                  return (
                    <ReactMarkdown
                      key={index}
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            {children}
                          </a>
                        ),
                        ul: ({ children }) => <ul className="mb-4 list-disc pl-6 last:mb-0">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-4 list-decimal pl-6 last:mb-0">{children}</ol>,
                        li: ({ children }) => <li className="mb-1">{children}</li>,
                        code: ({ children }) => (
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                            {children}
                          </code>
                        ),
                        pre: ({ children }) => (
                          <pre className="mb-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm last:mb-0">
                            {children}
                          </pre>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="mb-4 border-l-2 border-muted-foreground pl-4 italic last:mb-0">
                            {children}
                          </blockquote>
                        ),
                        h1: ({ children }) => <h1 className="mb-4 text-2xl font-bold">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-3 text-xl font-bold">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-2 text-lg font-semibold">{children}</h3>,
                        h4: ({ children }) => <h4 className="mb-2 font-semibold">{children}</h4>,
                      }}
                    >
                      {part.text}
                    </ReactMarkdown>
                  );
                }
                if (part.type === 'reasoning') {
                  return (
                    <ReasoningPart
                      key={index}
                      text={part.text}
                      status={messageStatus}
                    />
                  );
                }
                if (part.type === 'tool-call') {
                  return (
                    <ToolCallPart
                      key={index}
                      toolCallId={part.toolCallId}
                      toolName={part.toolName}
                      args={part.args}
                      argsText={part.argsText}
                      result={part.result}
                      isError={part.isError}
                      status={messageStatus}
                    />
                  );
                }
                console.warn('[AssistantMessage] Unknown part type:', part.type, part);
                return null;
              })}

              {/* Artifact Button */}
              {artifact && (
                <div className="mt-3">
                  <ArtifactButton
                    type={artifact.type}
                    onClick={() => setActiveArtifact(artifact.id)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            className="pointer-events-auto flex w-full translate-y-full flex-col items-end px-2 pt-2 transition"
          >
            <div className="relative flex items-center text-muted-foreground">
              <ActionBarPrimitive.Copy className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95">
                <ClipboardIcon width={20} height={20} />
              </ActionBarPrimitive.Copy>
              <ActionBarPrimitive.FeedbackPositive className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95">
                <ThumbsUp width={16} height={16} />
              </ActionBarPrimitive.FeedbackPositive>
              <ActionBarPrimitive.FeedbackNegative className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95">
                <ThumbsDown width={16} height={16} />
              </ActionBarPrimitive.FeedbackNegative>
              <ActionBarPrimitive.Reload className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95">
                <ReloadIcon width={20} height={20} />
              </ActionBarPrimitive.Reload>
              {/* Statistics button - only show for last message with usage data */}
              {isLast && usageData && (
                <button
                  type="button"
                  onClick={() => setShowUsageCard(!showUsageCard)}
                  className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                  aria-label="查看统计信息"
                >
                  <BarChartIcon width={20} height={20} />
                </button>
              )}
              {/* Usage Card - shown when statistics button is clicked */}
              {isLast && showUsageCard && usageData && (
                <UsageCard data={usageData} onClose={() => setShowUsageCard(false)} />
              )}
            </div>
            {isLast && (
              <p className="mt-2 w-full text-right text-muted-foreground text-[0.65rem] leading-[0.85rem] opacity-90 sm:text-[0.75rem]">
                Claude can make mistakes. Please double-check responses.
              </p>
            )}
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const ChatMessage: FC = () => {
  const message = useMessage();
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isLast = message.isLast;

  if (isUser) {
    return (
      <MessagePrimitive.Root className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
        <div className="group/user wrap-break-word relative inline-flex max-w-[75ch] flex-col gap-2 rounded-xl bg-muted py-2.5 pr-6 pl-2.5 text-foreground transition-all">
          <div className="relative flex flex-row gap-2">
            <div className="shrink-0 self-start transition-all duration-300">
              <Avatar.Root className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-primary font-bold text-[12px] text-primary-foreground">
                <Avatar.AvatarFallback>U</Avatar.AvatarFallback>
              </Avatar.Root>
            </div>
            <div className="flex-1">
              <div className="relative grid grid-cols-1 gap-2 py-0.5">
                <div className="wrap-break-word whitespace-pre-wrap">
                  <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
                </div>
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute right-2 bottom-0">
            <ActionBarPrimitive.Root
              autohide="not-last"
              className="pointer-events-auto min-w-max translate-x-1 translate-y-4 rounded-lg border bg-card/80 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition group-hover/user:translate-x-0.5 group-hover/user:opacity-100"
            >
              <div className="flex items-center text-muted-foreground">
                <ActionBarPrimitive.Reload className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95">
                  <ReloadIcon width={20} height={20} />
                </ActionBarPrimitive.Reload>
                <ActionBarPrimitive.Edit className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95">
                  <Pencil1Icon width={20} height={20} />
                </ActionBarPrimitive.Edit>
              </div>
            </ActionBarPrimitive.Root>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  if (isAssistant) {
    return <AssistantMessage isLast={isLast} />;
  }

  return null;
};

/**
 * Historical Message Component
 * Renders messages loaded from JSONL history files
 */
const HistoricalMessage: FC<{ message: ThreadMessage }> = ({ message }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  // Get text content for user messages
  const textContent = message.content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

  // Artifact detection for assistant messages - pass full content array to support both text and tool-call detection
  const artifact = useArtifactDetection(message.id, isAssistant ? message.content : undefined);
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact);

  if (isUser) {
    return (
      <div className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
        <div className="group/user wrap-break-word relative inline-flex max-w-[75ch] flex-col gap-2 rounded-xl bg-muted py-2.5 pr-6 pl-2.5 text-foreground transition-all">
          <div className="relative flex flex-row gap-2">
            <div className="shrink-0 self-start transition-all duration-300">
              <Avatar.Root className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-primary font-bold text-[12px] text-primary-foreground">
                <Avatar.AvatarFallback>U</Avatar.AvatarFallback>
              </Avatar.Root>
            </div>
            <div className="flex-1">
              <div className="relative grid grid-cols-1 gap-2 py-0.5">
                <div className="wrap-break-word whitespace-pre-wrap">
                  {textContent}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isAssistant) {
    return (
      <div className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
        <div className="relative mb-12 font-sans">
          <div className="relative leading-[1.65rem]">
            <div className="grid grid-cols-1 gap-2.5">
              <div className="wrap-break-word whitespace-normal pr-8 pl-2 text-foreground">
                {message.content.map((part, index) => {
                  if (part.type === 'text') {
                    return (
                      <ReactMarkdown
                        key={index}
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-2 hover:opacity-80"
                            >
                              {children}
                            </a>
                          ),
                          ul: ({ children }) => <ul className="mb-4 list-disc pl-6 last:mb-0">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-4 list-decimal pl-6 last:mb-0">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          code: ({ children }) => (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                              {children}
                            </code>
                          ),
                          pre: ({ children }) => (
                            <pre className="mb-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm last:mb-0">
                              {children}
                            </pre>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote className="mb-4 border-l-2 border-muted-foreground pl-4 italic last:mb-0">
                              {children}
                            </blockquote>
                          ),
                          h1: ({ children }) => <h1 className="mb-4 text-2xl font-bold">{children}</h1>,
                          h2: ({ children }) => <h2 className="mb-3 text-xl font-bold">{children}</h2>,
                          h3: ({ children }) => <h3 className="mb-2 text-lg font-semibold">{children}</h3>,
                          h4: ({ children }) => <h4 className="mb-2 font-semibold">{children}</h4>,
                        }}
                      >
                        {part.text}
                      </ReactMarkdown>
                    );
                  }
                  if (part.type === 'reasoning') {
                    return (
                      <ReasoningPart
                        key={index}
                        text={part.text}
                      />
                    );
                  }
                  if (part.type === 'tool-call') {
                    return (
                      <ToolCallPart
                        key={index}
                        toolCallId={part.toolCallId}
                        toolName={part.toolName}
                        args={part.args}
                        argsText={part.argsText}
                        result={part.result}
                        isError={part.isError}
                      />
                    );
                  }
                  return null;
                })}

                {/* Artifact Button */}
                {artifact && (
                  <div className="mt-3">
                    <ArtifactButton
                      type={artifact.type}
                      onClick={() => setActiveArtifact(artifact.id)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const ClaudeAttachment: FC = () => {
  return (
    <AttachmentPrimitive.Root className="group/thumbnail relative">
      <div
        className="can-focus-within overflow-hidden rounded-lg border shadow-sm hover:shadow-md"
        style={{
          width: '120px',
          height: '120px',
          minWidth: '120px',
          minHeight: '120px',
        }}
      >
        <button
          type="button"
          className="relative flex h-full w-full items-center justify-center bg-card text-muted-foreground"
        >
          <AttachmentPrimitive.unstable_Thumb className="text-xs" />
        </button>
      </div>
      <AttachmentPrimitive.Remove
        className="-left-2 -top-2 absolute flex h-5 w-5 items-center justify-center rounded-full border bg-card/90 text-muted-foreground opacity-0 backdrop-blur-sm transition-all hover:bg-card hover:text-foreground group-focus-within/thumbnail:opacity-100 group-hover/thumbnail:opacity-100"
        aria-label="Remove attachment"
      >
        <Cross2Icon width={12} height={12} />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
};
