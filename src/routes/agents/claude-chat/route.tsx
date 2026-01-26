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
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantApi,
  useLocalRuntime,
  useMessage,
  useThread,
} from '@assistant-ui/react';
import * as Avatar from '@radix-ui/react-avatar';
import {
  BarChartIcon,
  ClipboardIcon,
  Pencil1Icon,
  ReloadIcon,
} from '@radix-ui/react-icons';
import { AuthLoading, RedirectToSignIn, SignedIn } from '@daveyplate/better-auth-ui';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp, Layers, Paperclip, FolderOpen, Plus, MessageSquare, Loader2 } from 'lucide-react';
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type FC, type MutableRefObject } from 'react';
import { MarkdownText } from '~/components/assistant-ui/markdown-text';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { SessionList, useInvalidateSessions } from '~/components/claude-chat/session-list';
import { UsageCard } from '~/components/claude-chat/usage-card';
import { type SessionMetadata } from '~/components/claude-chat/session-info-panel';
import { ArtifactsPanel } from '~/components/claude-chat/artifacts-panel';
import { ArtifactButton } from '~/components/claude-chat/artifact-button';
import { ReasoningPart } from '~/components/agent-chat/reasoning-part';
import { ToolCallPart } from '~/components/agent-chat/tool-call-part';
import { InlineStatus, type AgentStatusType } from '~/components/claude-chat/claude-status';
import { MultiDiffPreviewOverlay, CodePreviewOverlay, type FileChange } from '~/components/claude-chat/overlay';
import { type PermissionInfo } from '~/components/claude-chat/permission-badge';
import { ChatComposerWithRef, type ChatComposerRef } from '~/components/claude-chat/chat-composer';
import { A2ComposerPanel } from '~/components/claude-chat/a2composer-panel';
import { useArtifactDetection } from '~/lib/hooks/use-artifact-detection';
import { useBeforeUnloadProtection, useReconnectionRecovery } from '~/lib/hooks/use-session-protection';
import { useArtifactsStore } from '~/lib/stores/artifacts-store';
import { fetchArtifactRegistry, readWorkspaceFile, readWorkspaceBinaryFile, getMimeType } from '~/lib/artifacts/artifact-registry';
import { useMessageAttachments, type PendingAttachment } from '~/lib/utils/message-attachments';
import type { MessageAttachment } from '~/db/schema/message-attachment.schema';
import { getPermissionInfo } from '~/server/permissions.server';
// Use WebSocket adapter for more reliable real-time communication
import {
  ClaudeAgentWSAdapter,
  getSessionId,
  resumeSession,
  newSession,
  createSession,
  initSession,
  onSessionInit,
  checkIsQueryRunning,
  notifyUserAbort,
} from '~/claude/adapters';
import {
  useChatSessionStore,
  onMessagesLoaded,
  type SDKMessage,
  type ThreadMessage,
  type TextContentPart,
  type ContentPart,
} from '~/lib/chat-session-store';
import { disableUserSkillsFn } from '~/server/function/skills.server';

// Context for sharing file/URL click handlers across message components
type FileHandlersContextType = {
  onFileClick: (path: string) => void; // For workspace files (artifact preview)
  onSessionFileClick: (path: string) => void; // P12: For session root files (SessionFilesPanel)
  onUrlClick: (url: string) => void;
};

const FileHandlersContext = createContext<FileHandlersContextType>({
  onFileClick: () => {},
  onSessionFileClick: () => {},
  onUrlClick: () => {},
});

const useFileHandlers = () => useContext(FileHandlersContext);

export const Route = createFileRoute('/agents/claude-chat')({
  component: RouteComponent,
  loader: async () => {
    // Fetch permission info on server side
    const permissionInfo = await getPermissionInfo();
    return { permissionInfo };
  },
});

function RouteComponent() {
  // Get permission info from loader
  const { permissionInfo } = Route.useLoaderData();

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
  // Track if a session is being created (loading state)
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isInitializingSession, setIsInitializingSession] = useState(false);

  // Query to check if user has any historical sessions
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<{
    sessions: Array<{ id: string; sdkSessionId: string }>;
  }>({
    queryKey: ['agent-sessions', 'summary'],
    queryFn: async () => {
      const res = await fetch('/api/agent-sessions?limit=1');
      if (!res.ok) {
        throw new Error('Failed to fetch sessions');
      }
      return res.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const hasAnySessions = (sessionsData?.sessions?.length ?? 0) > 0;
  const isSessionsEmpty = !sessionsLoading && !hasAnySessions;

  // Save session list expanded state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sessionListExpanded', JSON.stringify(sessionListExpanded));
    }
  }, [sessionListExpanded]);

  const { loadHistoricalMessages, clearMessages, setSessionId, temporarySkills, clearTemporarySkills } = useChatSessionStore();
  const disableUserSkills = useServerFn(disableUserSkillsFn);
  const invalidateSessions = useInvalidateSessions();

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
      // Invalidate sessions list to refresh titles (especially for new sessions)
      invalidateSessions();
    });
    return unsubscribe;
  }, [setSessionId, invalidateSessions]);

  // Handle WebSocket reconnection - resume current session if any
  useReconnectionRecovery(useCallback(() => {
    const sessionToResume = currentSessionId;
    if (sessionToResume) {
      console.log('[Route] WebSocket reconnected, resuming session:', sessionToResume);
      // Clear messages and reload from server
      clearMessages();
      resumeSession(sessionToResume).catch((error) => {
        console.error('[Route] Failed to resume session after reconnection:', error);
      });
    } else {
      console.log('[Route] WebSocket reconnected, no active session to resume');
    }
  }, [currentSessionId, clearMessages]));

  // Hydrate artifacts from registry when session changes
  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    useArtifactsStore.getState().clearAll();

    let isCancelled = false;
    const run = async () => {
      try {
        await hydrateArtifactsFromRegistry(currentSessionId);
      } catch (error) {
        if (!isCancelled) {
          console.error('[Route] Failed to hydrate artifacts:', error);
        }
      }
    };

    run();

    return () => {
      isCancelled = true;
    };
  }, [currentSessionId]);

  // Perform the actual session switch (after confirmation or if no query running)
  const performSessionSwitch = useCallback(async (sdkSessionId: string | null, isNewSession: boolean) => {
    if (temporarySkills.length > 0) {
      try {
        await disableUserSkills({ data: { skillNames: temporarySkills } });
      } catch (error) {
        console.warn('[Route] Failed to disable temporary skills:', error);
      }
      clearTemporarySkills();
    }
    if (isNewSession) {
      console.log('[Route] Creating new session explicitly');
      setIsCreatingSession(true);
      setIsInitializingSession(true);
      setCurrentSessionId(null);
      setSessionId(null);
      clearMessages();
      try {
        const newSessionId = await createSession();
        console.log('[Route] New session created:', newSessionId);
        setCurrentSessionId(newSessionId);
        setSessionId(newSessionId);
        setChatKey((k) => k + 1);
        await initSession(newSessionId);
      } catch (error) {
        console.error('[Route] Failed to create session:', error);
      } finally {
        setIsCreatingSession(false);
        setIsInitializingSession(false);
      }
    } else if (sdkSessionId) {
      console.log('[Route] Selecting session:', sdkSessionId);
      setIsInitializingSession(false);
      setCurrentSessionId(sdkSessionId);
      setSessionId(sdkSessionId);
      clearMessages();
      setChatKey((k) => k + 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await resumeSession(sdkSessionId);
    }
  }, [setSessionId, clearMessages, temporarySkills, clearTemporarySkills, disableUserSkills]);

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

  // Empty state: no sessions at all, show big "Start New Session" button
  if (isSessionsEmpty && !currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-foreground">
              Claude Agent
            </h1>
            <p className="text-muted-foreground max-w-md">
              Start a conversation to begin. I can read files, execute code, and help with various tasks.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewSession}
            disabled={isCreatingSession}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground font-medium transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreatingSession ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span>Start New Session</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Dev mode: skip client-side auth check
  if (isDev) {
    return (
      <div className="h-full">
        <div className="flex h-full">
          {/* Session List - only show when no artifact AND user has sessions */}
          {!activeArtifactId && hasAnySessions && (
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
                {hasAnySessions && (
                  <button
                    type="button"
                    onClick={() => setSessionListExpanded(!sessionListExpanded)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border shadow-sm transition-colors hover:bg-accent"
                    aria-label={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                    title={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                )}
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
            <ClaudeChatSurface
              key={chatKey}
              permissionInfo={permissionInfo}
              hasSession={!!currentSessionId}
              isInitializingSession={isInitializingSession}
              onStartSession={handleNewSession}
              isCreatingSession={isCreatingSession}
            />
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
        {/* Empty state: no sessions at all, show big "Start New Session" button */}
        {isSessionsEmpty && !currentSessionId ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-foreground">
                  Claude Agent
                </h1>
                <p className="text-muted-foreground max-w-md">
                  Start a conversation to begin. I can read files, execute code, and help with various tasks.
                </p>
              </div>
              <button
                type="button"
                onClick={handleNewSession}
                disabled={isCreatingSession}
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground font-medium transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingSession ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    <span>Start New Session</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-full">
              {/* Session List - only show when no artifact AND user has sessions */}
              {!activeArtifactId && hasAnySessions && (
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
                {hasAnySessions && (
                  <button
                    type="button"
                    onClick={() => setSessionListExpanded(!sessionListExpanded)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border shadow-sm transition-colors hover:bg-accent"
                    aria-label={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                    title={sessionListExpanded ? '收起侧边栏' : '展开侧边栏'}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                )}
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
            <ClaudeChatSurface
              key={chatKey}
              permissionInfo={permissionInfo}
              hasSession={!!currentSessionId}
              isInitializingSession={isInitializingSession}
              onStartSession={handleNewSession}
              isCreatingSession={isCreatingSession}
            />
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
          </>
        )}
      </SignedIn>
    </div>
  );
}

async function hydrateArtifactsFromRegistry(sessionId: string) {
  const registry = await fetchArtifactRegistry(sessionId);
  if (registry.length === 0) {
    return;
  }

  const {
    createArtifact,
    updateArtifact,
    getArtifactByFilePath,
  } = useArtifactsStore.getState();

  for (const entry of registry) {
    // P15 fix: Use binary reading for images to avoid corruption
    let content: string | null = null;
    let mimeType: string | undefined;

    if (entry.type === 'image') {
      mimeType = getMimeType(entry.filePath);
      content = await readWorkspaceBinaryFile(sessionId, entry.filePath, mimeType);
    } else {
      content = await readWorkspaceFile(sessionId, entry.filePath);
    }

    if (!content) {
      continue;
    }

    const existing = getArtifactByFilePath(sessionId, entry.filePath);
    const fileName = entry.fileName || entry.filePath.split('/').pop() || entry.filePath;

    // P14: Include lineage info from registry
    const lineageData = {
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
    };

    if (existing) {
      updateArtifact(existing.id, {
        content,
        type: entry.type,
        title: entry.title,
        description: entry.description,
        fileName,
        messageId: entry.messageId,
        sourceFilePath: entry.filePath,
        sessionId,
        isTemporary: false,
        mimeType, // P15: Include mimeType for images
        ...lineageData, // P14: Restore lineage
      });
    } else {
      createArtifact({
        sessionId,
        sourceFilePath: entry.filePath,
        messageId: entry.messageId,
        type: entry.type,
        title: entry.title,
        description: entry.description,
        fileName,
        content,
        isTemporary: false,
        mimeType, // P15: Include mimeType for images
        ...lineageData, // P14: Restore lineage
      });
    }
  }
}

function ClaudeChatSurface({
  permissionInfo,
  hasSession,
  isInitializingSession,
  onStartSession,
  isCreatingSession,
}: {
  permissionInfo: PermissionInfo;
  hasSession: boolean;
  isInitializingSession: boolean;
  onStartSession?: () => void;
  isCreatingSession?: boolean;
}) {
  const runtime = useLocalRuntime(ClaudeAgentWSAdapter);
  const historicalMessages = useChatSessionStore((state) => state.messages);
  const hasHistoricalMessages = historicalMessages.length > 0;

  // Session info panel state
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const sessionMetadata = useChatSessionStore((state) => state.sessionMetadata);

  // Workspace panel state (session-level, persists across messages)
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showSessionFiles, setShowSessionFiles] = useState(false);
  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);
  const { loadSessionAttachments } = useMessageAttachments();
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Map<string, MessageAttachment[]>>(
    new Map()
  );

  // Global file preview state
  const [filePreview, setFilePreview] = useState<{
    isOpen: boolean;
    content: string;
    filePath: string;
    error?: string;
    isLoading: boolean;
  }>({ isOpen: false, content: '', filePath: '', isLoading: false });

  useEffect(() => {
    let isCancelled = false;

    if (!currentSessionId) {
      setAttachmentsByMessage(new Map());
      return;
    }

    loadSessionAttachments(currentSessionId).then((result) => {
      if (!isCancelled) {
        setAttachmentsByMessage(result);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [currentSessionId, loadSessionAttachments]);

  // Handler for file path clicks - fetches file content and opens overlay
  const handleFileClick = useCallback(async (path: string) => {
    if (!currentSessionId) {
      console.warn('[Route] No session ID, cannot read file:', path);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: '请先创建会话后再查看文件',
        isLoading: false,
      });
      return;
    }

    // Show loading state
    setFilePreview({
      isOpen: true,
      content: '',
      filePath: path,
      isLoading: true,
    });

    try {
      console.log('[Route] Reading workspace file:', path);
      const content = await readWorkspaceFile(currentSessionId, path);
      if (content === null) {
        setFilePreview({
          isOpen: true,
          content: '',
          filePath: path,
          error: `文件不存在或无法读取: ${path}`,
          isLoading: false,
        });
      } else {
        setFilePreview({
          isOpen: true,
          content,
          filePath: path,
          isLoading: false,
        });
      }
    } catch (error) {
      console.error('[Route] Failed to read file:', path, error);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: error instanceof Error ? error.message : '读取文件失败',
        isLoading: false,
      });
    }
  }, [currentSessionId]);

  // Handler for session file clicks - uses session API (for files in session root, not just workspace/)
  // P12 fix: Session files panel uses this for browsing entire session directory
  const handleSessionFileClick = useCallback(async (path: string) => {
    if (!currentSessionId) {
      console.warn('[Route] No session ID, cannot read file:', path);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: '请先创建会话后再查看文件',
        isLoading: false,
      });
      return;
    }

    // Show loading state
    setFilePreview({
      isOpen: true,
      content: '',
      filePath: path,
      isLoading: true,
    });

    try {
      console.log('[Route] Reading session file:', path);
      // Use session API - handles both text and binary files correctly
      const encodedPath = path.split('/').map(s => encodeURIComponent(s)).join('/');
      const response = await fetch(`/api/session/${currentSessionId}/file/${encodedPath}`);
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }
      const data = await response.json();
      setFilePreview({
        isOpen: true,
        content: data.content || '',
        filePath: path,
        isLoading: false,
      });
    } catch (error) {
      console.error('[Route] Failed to read session file:', path, error);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: error instanceof Error ? error.message : '读取文件失败',
        isLoading: false,
      });
    }
  }, [currentSessionId]);

  // Handler for URL clicks
  const handleUrlClick = useCallback((url: string) => {
    console.log('[Route] URL clicked:', url);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  // Session protection: warn before closing page during active query
  useBeforeUnloadProtection();

  // Esc interrupt state
  const [escPressedOnce, setEscPressedOnce] = useState(false);
  const escTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<ChatComposerRef | null>(null);
  const [composerText, setComposerText] = useState('');
  const [isA2ComposerOpen, setIsA2ComposerOpen] = useState(false);
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false);

  // A2ComposerPanel reset handler
  const [a2ComposerKey, setA2ComposerKey] = useState(0);
  const handleA2ComposerReset = useCallback(() => {
    // Force remount to reset state
    setA2ComposerKey((k) => k + 1);
  }, []);

  const handleSetComposerText = useCallback((text: string) => {
    composerRef.current?.setText(text);
    composerRef.current?.focus();
  }, []);

  // Handle message send - reset A2ComposerPanel
  const handleComposerSend = useCallback(() => {
    // Reset panel to minimized state after send
    handleA2ComposerReset();
  }, [handleA2ComposerReset]);

  const handleA2ComposerOpenChange = useCallback((open: boolean) => {
    setIsA2ComposerOpen(open);
    if (open) {
      setIsSkillsPanelOpen(false);
    }
  }, []);

  const handleSkillsOpenChange = useCallback((open: boolean) => {
    setIsSkillsPanelOpen(open);
  }, []);


  return (
    <FileHandlersContext.Provider value={{ onFileClick: handleFileClick, onSessionFileClick: handleSessionFileClick, onUrlClick: handleUrlClick }}>
      <div className="flex h-full flex-col">
        <AssistantRuntimeProvider runtime={runtime}>
          <EscapeInterruptHandler
            escPressedOnce={escPressedOnce}
            setEscPressedOnce={setEscPressedOnce}
            escTimeoutRef={escTimeoutRef}
          />
          <ThreadPrimitive.Root className="flex h-full flex-col items-stretch bg-background p-4 pt-16 font-sans">
            <ThreadPrimitive.Viewport className="flex-1 min-h-0 overflow-y-auto">
              {/* Show empty state only when no historical messages and not initializing */}
              {!hasHistoricalMessages && !isInitializingSession && (
                <ThreadPrimitive.Empty>
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="text-4xl font-semibold text-foreground">
                      Claude Agent
                    </div>
                    <p className="max-w-md text-muted-foreground">
                      Powered by Claude Agent SDK. I can read files, execute code, and help with various
                      tasks.
                    </p>
                    {!hasSession && onStartSession && (
                      <button
                        type="button"
                        onClick={onStartSession}
                        disabled={isCreatingSession}
                        className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isCreatingSession ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Creating...</span>
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4" />
                            <span>Start New Session</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </ThreadPrimitive.Empty>
              )}

              {isInitializingSession && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-base font-medium text-foreground">正在初始化新会话</div>
                    <div className="text-xs text-muted-foreground">请稍候，完成后即可开始对话</div>
                  </div>
                </div>
              )}

              {/* Render historical messages from store */}
              {historicalMessages.map((msg) => (
                <HistoricalMessage
                  key={msg.id}
                  message={msg}
                  attachments={attachmentsByMessage.get(msg.id)}
                  sessionId={currentSessionId}
                />
              ))}

              {/* Render live messages from runtime */}
              <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
              <ThreadArtifactCallout />
              <div aria-hidden="true" className="h-4" />
            </ThreadPrimitive.Viewport>

            {/* Only show Composer when session exists */}
            {hasSession && !isInitializingSession && (
              <>
                <div className={`mb-3 ${isSkillsPanelOpen ? 'hidden' : ''}`}>
                  <A2ComposerPanel
                    key={a2ComposerKey}
                    composerText={composerText}
                    onSetComposerText={handleSetComposerText}
                    onReset={handleA2ComposerReset}
                    onOpenChange={handleA2ComposerOpenChange}
                  />
                </div>

                <ChatComposerWithRef
                  composerRef={composerRef}
                  permissionInfo={permissionInfo}
                  currentSessionId={currentSessionId}
                  showWorkspace={showWorkspace}
                  setShowWorkspace={setShowWorkspace}
                  showSessionFiles={showSessionFiles}
                  setShowSessionFiles={setShowSessionFiles}
                  showSessionInfo={showSessionInfo}
                  setShowSessionInfo={setShowSessionInfo}
                  sessionMetadata={sessionMetadata}
                  onSessionFileClick={handleSessionFileClick}
                  onAbort={notifyUserAbort}
                  onTextChange={setComposerText}
                  onSend={handleComposerSend}
                  hideSkillsTrigger={isA2ComposerOpen}
                  onSkillsOpenChange={handleSkillsOpenChange}
                />
              </>
            )}
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>

        {/* Global file preview overlay */}
        <CodePreviewOverlay
          isOpen={filePreview.isOpen}
          onClose={() => setFilePreview(prev => ({ ...prev, isOpen: false }))}
          content={filePreview.isLoading ? 'Loading...' : filePreview.content}
          filePath={filePreview.filePath}
          error={filePreview.error}
        />

        {/* Esc interrupt overlay */}
        {escPressedOnce && (
          <div className="fixed inset-x-0 top-4 z-50 flex justify-center pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="rounded-lg bg-[#1a1a18] px-4 py-2 text-sm text-white shadow-lg">
              再按一次 <kbd className="mx-1 rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs">Esc</kbd> 停止
            </div>
          </div>
        )}
      </div>
    </FileHandlersContext.Provider>
  );
}

/**
 * Escape Interrupt Handler
 * Handles Esc key press for two-step interrupt confirmation
 * Must be used inside AssistantRuntimeProvider
 */
const EscapeInterruptHandler: FC<{
  escPressedOnce: boolean;
  setEscPressedOnce: (value: boolean) => void;
  escTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}> = ({ escPressedOnce, setEscPressedOnce, escTimeoutRef }) => {
  const isRunning = useThread((state) => state.isRunning);
  const api = useAssistantApi();

  useEffect(() => {
    if (!isRunning) {
      // Reset state when not running
      setEscPressedOnce(false);
      if (escTimeoutRef.current) {
        clearTimeout(escTimeoutRef.current);
        escTimeoutRef.current = null;
      }
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore repeated key events and already prevented events
      if (event.repeat || event.defaultPrevented) return;

      // Only handle Escape key
      if (event.key !== 'Escape') return;

      // Prevent default behavior
      event.preventDefault();

      if (escPressedOnce) {
        // Second Esc press - actually cancel
        console.log('[EscapeInterrupt] Second Esc pressed, cancelling...');
        setEscPressedOnce(false);
        if (escTimeoutRef.current) {
          clearTimeout(escTimeoutRef.current);
          escTimeoutRef.current = null;
        }
        notifyUserAbort();
        api.composer().cancel();
      } else {
        // First Esc press - show hint
        console.log('[EscapeInterrupt] First Esc pressed, showing hint...');
        setEscPressedOnce(true);

        // Auto-dismiss after 2 seconds
        if (escTimeoutRef.current) {
          clearTimeout(escTimeoutRef.current);
        }
        escTimeoutRef.current = setTimeout(() => {
          setEscPressedOnce(false);
          escTimeoutRef.current = null;
        }, 2000);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRunning, escPressedOnce, setEscPressedOnce, escTimeoutRef, api]);

  return null;
};

const ThreadArtifactCallout: FC = () => {
  const messages = useThread((state) => state.messages) as Array<{
    id: string;
    role?: string;
  }>;
  const artifacts = useArtifactsStore((state) => state.artifacts);
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact);

  const artifact = useMemo(() => {
    if (!messages || messages.length === 0) return null;

    const candidateMessageIds: string[] = [];
    for (let i = messages.length - 1; i >= 0 && candidateMessageIds.length < 3; i -= 1) {
      const msg = messages[i];
      if (msg?.role === 'assistant') {
        candidateMessageIds.push(msg.id);
      }
    }

    if (candidateMessageIds.length === 0) return null;
    const candidateSet = new Set(candidateMessageIds);
    const matches = Array.from(artifacts.values()).filter(
      (entry) => entry.messageId && candidateSet.has(entry.messageId)
    );
    if (matches.length === 0) return null;
    return matches.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }, [messages, artifacts]);

  if (!artifact) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-2 pb-2">
      <ArtifactButton
        type={artifact.type}
        title={artifact.title}
        fileName={artifact.fileName}
        filePath={artifact.sourceFilePath}
        isTemporary={artifact.isTemporary}
        onClick={() => setActiveArtifact(artifact.id)}
      />
    </div>
  );
};


// File handlers are now provided via FileHandlersContext from ClaudeChatSurface

/**
 * Extract file changes from message content for multi-diff overlay
 */
function extractFileChanges(content: ContentPart[], messageId: string): FileChange[] {
  const changes: FileChange[] = [];
  let changeIndex = 0;

  for (const part of content) {
    if (part.type !== 'tool-call') continue;

    const toolName = part.toolName?.toLowerCase() ?? '';
    const args = part.args as Record<string, unknown> | undefined;

    if (toolName === 'edit' && args?.old_string !== undefined && args?.new_string !== undefined) {
      changes.push({
        id: `${messageId}-${changeIndex++}`,
        filePath: String(args.file_path ?? 'unknown'),
        toolType: 'Edit',
        original: String(args.old_string),
        modified: String(args.new_string),
        error: part.isError ? String(part.result ?? 'Error') : undefined,
      });
    } else if (toolName === 'write' && args?.content !== undefined) {
      changes.push({
        id: `${messageId}-${changeIndex++}`,
        filePath: String(args.file_path ?? 'unknown'),
        toolType: 'Write',
        original: '',
        modified: String(args.content),
        error: part.isError ? String(part.result ?? 'Error') : undefined,
      });
    }
  }

  return changes;
}

function getMessageTextContent(parts?: ContentPart[]): string {
  if (!parts || parts.length === 0) return '';
  return parts
    .filter((part): part is TextContentPart => part.type === 'text' && Boolean(part.text))
    .map((part) => part.text)
    .join('\n');
}

const IMAGE_ATTACHMENT_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;

function encodeWorkspacePath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildWorkspaceRawUrl(sessionId: string, filePath: string): string {
  return `/api/workspace/${sessionId}/file/${encodeWorkspacePath(filePath)}?raw=1`;
}

function isImageAttachment(attachment: MessageAttachment): boolean {
  if (attachment.mimeType?.startsWith('image/')) return true;
  return IMAGE_ATTACHMENT_EXTENSIONS.test(attachment.filePath);
}

function isTextAttachment(attachment: MessageAttachment): boolean {
  if (!attachment.mimeType) return false;
  return (
    attachment.mimeType.startsWith('text/') ||
    attachment.mimeType === 'application/json' ||
    attachment.mimeType === 'application/xml'
  );
}

const HistoricalAttachmentStrip: FC<{
  attachments: MessageAttachment[];
  sessionId: string;
  onFileClick: (path: string) => void;
}> = ({ attachments, sessionId, onFileClick }) => {
  if (attachments.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const isImage = isImageAttachment(attachment);
        const rawUrl = buildWorkspaceRawUrl(sessionId, attachment.filePath);
        const displayName = attachment.originalName || attachment.filePath;
        const handleClick = () => {
          if (isImage) {
            window.open(rawUrl, '_blank', 'noopener,noreferrer');
            return;
          }
          if (isTextAttachment(attachment)) {
            onFileClick(attachment.filePath);
            return;
          }
          window.open(rawUrl, '_blank', 'noopener,noreferrer');
        };

        if (isImage) {
          return (
            <button
              key={attachment.id}
              type="button"
              onClick={handleClick}
              className="overflow-hidden rounded-lg border bg-card shadow-sm transition hover:shadow-md"
              title={displayName}
            >
              <img
                src={rawUrl}
                alt={displayName}
                className="h-16 w-16 object-cover"
              />
            </button>
          );
        }

        return (
          <button
            key={attachment.id}
            type="button"
            onClick={handleClick}
            className="flex items-center gap-2 rounded-lg border bg-card/70 px-2.5 py-1 text-xs text-foreground shadow-sm transition hover:bg-card"
            title={displayName}
          >
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="max-w-[16rem] truncate">{displayName}</span>
          </button>
        );
      })}
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

  // Get file handlers from context
  const { onFileClick, onUrlClick } = useFileHandlers();

  // Access content parts - cast to our ContentPart type
  const messageContent = (message as any).content as ContentPart[] | undefined;
  const isRunning = messageStatus?.type === 'running';
  const hasContent = (messageContent?.length ?? 0) > 0;
  const copyText = useMemo(() => getMessageTextContent(messageContent), [messageContent]);

  // State for showing usage card
  const [showUsageCard, setShowUsageCard] = useState(false);

  // State for multi-diff overlay
  const [showMultiDiff, setShowMultiDiff] = useState(false);

  // Get usage data and agent status from store (only show for last message)
  const usageData = useChatSessionStore((state) => state.usageData);
  const agentStatus = useChatSessionStore((state) => state.agentStatus);
  const currentToolName = useChatSessionStore((state) => state.currentToolName);

  // Determine display status for InlineStatus component
  const displayStatus: AgentStatusType = isRunning ? (agentStatus as AgentStatusType) : 'idle';

  // Artifact detection - pass full content array to support both text and tool-call detection
  useArtifactDetection(message.id, messageContent);

  // Extract file changes for multi-diff overlay
  const fileChanges = useMemo(() => {
    if (!messageContent) return [];
    return extractFileChanges(messageContent, message.id);
  }, [messageContent, message.id]);

  // Filter to only successful changes for multi-diff display
  const successfulChanges = useMemo(() => fileChanges.filter(c => !c.error), [fileChanges]);
  const hasMultipleFileChanges = successfulChanges.length > 1;

  return (
    <MessagePrimitive.Root className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
      <div className="relative mb-12 font-sans">
        <div className="relative leading-[1.65rem]">
          <div className="grid grid-cols-1 gap-2.5">
            <div className="wrap-break-word whitespace-normal pr-8 pl-2 text-foreground">
              {/* Status indicator - shows different states based on agentStatus */}
              {isRunning && !hasContent && (
                <div className="mb-3">
                  <InlineStatus status={displayStatus} toolName={currentToolName} />
                </div>
              )}

              {/* Inline status when content exists but still running */}
              {isRunning && hasContent && (
                <InlineStatus status={displayStatus} toolName={currentToolName} />
              )}

              {/* Manual rendering to support custom tool-call type */}
              {messageContent?.map((part, index) => {
                if (part.type === 'text') {
                  // Check if this is the last text part and we're streaming
                  const isLastTextPart = messageContent
                    .slice(index + 1)
                    .every(p => p.type !== 'text');
                  const showCursor = isRunning && agentStatus === 'streaming' && isLastTextPart;

                  return (
                    <div key={index} className="relative">
                      <StreamingMarkdown
                        content={part.text}
                        isStreaming={showCursor}
                        mode="minimal"
                        onUrlClick={onUrlClick}
                        onFileClick={onFileClick}
                      />
                      {showCursor && (
                        <span className="inline-block h-4 w-0.5 animate-pulse bg-[#ae5630] ml-0.5" />
                      )}
                    </div>
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
                      toolStatus={part.toolStatus}
                      status={messageStatus}
                      backgroundTaskId={part.backgroundTaskId}
                      backgroundShellId={part.backgroundShellId}
                      intent={part.intent}
                      command={part.command}
                      elapsedSeconds={part.elapsedSeconds}
                    />
                  );
                }
                console.warn('[AssistantMessage] Unknown part type:', part.type, part);
                return null;
              })}

              {/* Multi-diff aggregation button */}
              {hasMultipleFileChanges && !isRunning && (
                <button
                  type="button"
                  onClick={() => setShowMultiDiff(true)}
                  className="mt-3 flex items-center gap-1.5 rounded-md border border-[#e5e4df] bg-[#f8f8f6] px-2.5 py-1.5 text-xs text-[#6b6a68] transition-colors hover:bg-[#f0f0eb] dark:border-[#3a3938] dark:bg-[#1f1e1b] dark:text-[#9a9893] dark:hover:bg-[#2a2928]"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>View all {successfulChanges.length} file changes</span>
                </button>
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
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(copyText)}
                className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                aria-label="复制"
              >
                <ClipboardIcon width={20} height={20} />
              </button>
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

      {/* Multi-diff overlay */}
      <MultiDiffPreviewOverlay
        isOpen={showMultiDiff}
        onClose={() => setShowMultiDiff(false)}
        changes={successfulChanges}
      />
    </MessagePrimitive.Root>
  );
};

const ChatMessage: FC = () => {
  const message = useMessage();
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isLast = message.isLast;
  const hasUserAttachments = Boolean((message as any).attachments?.length);

  // Get file handlers from context for user messages
  const { onFileClick, onUrlClick } = useFileHandlers();

  // Extract text content for user messages
  const userTextContent = useMemo(() => {
    if (!isUser) return '';
    const content = (message as any).content as Array<{ type: string; text?: string }> | undefined;
    if (!content) return '';
    return content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n');
  }, [isUser, message]);

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
                {hasUserAttachments && (
                  <div className="flex flex-wrap gap-2">
                    <MessagePrimitive.Attachments components={{ Attachment: ClaudeMessageAttachment }} />
                  </div>
                )}
                <div className="wrap-break-word whitespace-normal">
                  <StreamingMarkdown
                    content={userTextContent}
                    isStreaming={false}
                    mode="minimal"
                    onUrlClick={onUrlClick}
                    onFileClick={onFileClick}
                  />
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
 * Structure aligned with AssistantMessage/ChatMessage for consistency
 */
const HistoricalMessage: FC<{
  message: ThreadMessage;
  attachments?: MessageAttachment[];
  sessionId: string | null;
}> = ({ message, attachments, sessionId }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const messageAttachments = attachments ?? [];
  const showAttachments = Boolean(sessionId && messageAttachments.length > 0);

  // Get file handlers from context
  const { onFileClick, onUrlClick } = useFileHandlers();

  // State for multi-diff overlay
  const [showMultiDiff, setShowMultiDiff] = useState(false);

  // Get text content for user messages
  const textContent = message.content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

  // Artifact detection for assistant messages - pass full content array to support both text and tool-call detection
  const artifact = useArtifactDetection(message.id, isAssistant ? message.content : undefined);
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact);

  // Extract file changes for multi-diff overlay (only for assistant messages)
  const fileChanges = useMemo(() => {
    if (!isAssistant) return [];
    return extractFileChanges(message.content, message.id);
  }, [isAssistant, message.content, message.id]);

  // Filter to only successful changes for multi-diff display
  const successfulChanges = useMemo(() => fileChanges.filter(c => !c.error), [fileChanges]);
  const hasMultipleFileChanges = successfulChanges.length > 1;

  if (isUser) {
    // User message - aligned with ChatMessage user structure
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
                {showAttachments && sessionId && (
                  <HistoricalAttachmentStrip
                    attachments={messageAttachments}
                    sessionId={sessionId}
                    onFileClick={onFileClick}
                  />
                )}
                <div className="wrap-break-word whitespace-normal">
                  <StreamingMarkdown
                    content={textContent}
                    isStreaming={false}
                    mode="minimal"
                    onUrlClick={onUrlClick}
                    onFileClick={onFileClick}
                  />
                </div>
              </div>
            </div>
          </div>
          {/* ActionBar for user messages - copy only (no edit/reload for historical) */}
          <div className="pointer-events-none absolute right-2 bottom-0">
            <div className="pointer-events-auto min-w-max translate-x-1 translate-y-4 rounded-lg border bg-card/80 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition group-hover/user:translate-x-0.5 group-hover/user:opacity-100">
              <div className="flex items-center text-muted-foreground">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(textContent)}
                  className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-accent active:scale-95"
                  aria-label="复制"
                >
                  <ClipboardIcon width={20} height={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isAssistant) {
    // Assistant message - use plain div (not MessagePrimitive.Root)
    // because HistoricalMessage renders outside ThreadPrimitive.Messages
    return (
      <div className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
        <div className="relative mb-12 font-sans">
          <div className="relative leading-[1.65rem]">
            <div className="grid grid-cols-1 gap-2.5">
              <div className="wrap-break-word whitespace-normal pr-8 pl-2 text-foreground">
                {message.content.map((part, index) => {
                  if (part.type === 'text') {
                    return (
                      <StreamingMarkdown
                        key={index}
                        content={part.text}
                        isStreaming={false}
                        mode="minimal"
                        onUrlClick={onUrlClick}
                        onFileClick={onFileClick}
                      />
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
                        toolStatus={part.toolStatus}
                        backgroundTaskId={part.backgroundTaskId}
                        backgroundShellId={part.backgroundShellId}
                        intent={part.intent}
                        command={part.command}
                        elapsedSeconds={part.elapsedSeconds}
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

                {/* Multi-diff aggregation button */}
                {hasMultipleFileChanges && (
                  <button
                    type="button"
                    onClick={() => setShowMultiDiff(true)}
                    className="mt-3 flex items-center gap-1.5 rounded-md border border-[#e5e4df] bg-[#f8f8f6] px-2.5 py-1.5 text-xs text-[#6b6a68] transition-colors hover:bg-[#f0f0eb] dark:border-[#3a3938] dark:bg-[#1f1e1b] dark:text-[#9a9893] dark:hover:bg-[#2a2928]"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>View all {successfulChanges.length} file changes</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* ActionBar - aligned with AssistantMessage (copy/feedback only, no reload/stats for historical) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0">
            <div className="pointer-events-auto flex w-full translate-y-full flex-col items-end px-2 pt-2 transition">
              <div className="relative flex items-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => {
                    const allText = message.content
                      .filter((p): p is TextContentPart => p.type === 'text')
                      .map((p) => p.text)
                      .join('\n');
                    navigator.clipboard.writeText(allText);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                  aria-label="复制"
                >
                  <ClipboardIcon width={20} height={20} />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                  aria-label="有帮助"
                >
                  <ThumbsUp width={16} height={16} />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                  aria-label="没帮助"
                >
                  <ThumbsDown width={16} height={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Multi-diff overlay */}
        <MultiDiffPreviewOverlay
          isOpen={showMultiDiff}
          onClose={() => setShowMultiDiff(false)}
          changes={successfulChanges}
        />
      </div>
    );
  }

  return null;
};

const ClaudeMessageAttachment: FC = () => {
  return (
    <AttachmentPrimitive.Root className="flex items-center gap-2 rounded-lg border bg-card/70 px-2.5 py-1 text-xs text-foreground shadow-sm">
      <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="max-w-[16rem] truncate">
        <AttachmentPrimitive.Name />
      </span>
    </AttachmentPrimitive.Root>
  );
};
