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
import { useIntlayer } from 'react-intlayer';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp, Layers, Paperclip, PanelLeftClose, PanelLeftOpen, Plus, MessageSquare, Loader2 } from 'lucide-react';
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type FC, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { MarkdownText } from '~/components/assistant-ui/markdown-text';
import { StreamingMarkdown } from '~/components/claude-chat/streaming-markdown';
import { AssistantTurnCard } from '~/components/claude-chat/assistant-turn-card';
import { SessionList, useInvalidateSessions } from '~/components/claude-chat/session-list';
import { UsageCard } from '~/components/claude-chat/usage-card';
import { type SessionMetadata } from '~/components/claude-chat/session-info-panel';
import { ArtifactsPanel } from '~/components/claude-chat/artifacts-panel';
import { ArtifactButton } from '~/components/claude-chat/artifact-button';
import { InlineImagePreview } from '~/components/claude-chat/inline-image-preview';
import { InlineStatus, type AgentStatusType } from '~/components/claude-chat/claude-status';
import { MultiDiffPreviewOverlay, CodePreviewOverlay, type FileChange } from '~/components/claude-chat/overlay';
import { ImagePreviewOverlay } from '~/components/claude-chat/overlay/image-preview-overlay';
import { type PermissionInfo } from '~/components/claude-chat/permission-badge';
import { ChatComposerWithRef, type ChatComposerRef } from '~/components/claude-chat/chat-composer';
import { A2ComposerPanel } from '~/components/claude-chat/a2composer-panel';
import { WorkbenchPanel } from '~/components/claude-chat/workbench-panel';
import { SkillChip } from '~/components/claude-chat/skill-chip';
import { cn, toLocalizedString } from '~/lib/utils';
import { parseSkillMarker } from '~/lib/skills/skill-marker';
import { useArtifactDetection } from '~/lib/hooks/use-artifact-detection';
import { useBeforeUnloadProtection, useReconnectionRecovery, useSessionSummaryOnLeave, fireSessionSummaryIfNeeded } from '~/lib/hooks/use-session-protection';
import { useArtifactsStore, type Artifact, type ArtifactImageFile } from '~/lib/stores/artifacts-store';
import { fetchArtifactRegistry, readWorkspaceFile, readWorkspaceBinaryFile, getMimeType } from '~/lib/artifacts/artifact-registry';
import { isImageFilePath } from '~/lib/artifacts/image-utils';
import { useMessageAttachments, type PendingAttachment } from '~/lib/utils/message-attachments';
import type { MessageAttachment } from '~/db/schema/message-attachment.schema';
import { getPermissionInfo } from '~/server/permissions.server';
// Use WebSocket adapter for more reliable real-time communication
import {
  ClaudeAgentWSAdapter,
  abort,
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
import {
  trackClaudeAgentSessionCreated,
  trackClaudeAgentSessionSwitched,
  trackClaudeChatViewChanged,
} from '~/lib/observability/posthog-events';

const MIN_ARTIFACT_SPLIT = 1 / 3;
const MAX_ARTIFACT_SPLIT = 2 / 3;

const clampSplitRatio = (value: number) =>
  Math.min(MAX_ARTIFACT_SPLIT, Math.max(MIN_ARTIFACT_SPLIT, value));

const useArtifactSplitRatio = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => {
    if (!isResizing || typeof window === 'undefined') return;

    const handleMove = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const nextRatio = (event.clientX - rect.left) / rect.width;
      setRatio(clampSplitRatio(nextRatio));
    };

    const handleUp = () => {
      setIsResizing(false);
    };

    const body = document.body;
    const prevUserSelect = body.style.userSelect;
    const prevCursor = body.style.cursor;
    body.style.userSelect = 'none';
    body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      body.style.userSelect = prevUserSelect;
      body.style.cursor = prevCursor;
    };
  }, [isResizing]);

  return {
    containerRef,
    ratio,
    isResizing,
    startResize,
  };
};

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

  // Get i18n content - must be at top level before any returns
  const content = useIntlayer('claude-chat');

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
  const {
    containerRef: artifactSplitRef,
    ratio: artifactSplitRatio,
    isResizing: isArtifactSplitResizing,
    startResize: handleArtifactSplitResize,
  } = useArtifactSplitRatio();

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

  // Sync with adapter's session ID on mount, and re-hydrate history.
  // The adapter keeps the session id across SPA navigation (module-level), but the
  // assistant-ui thread is ephemeral and resets when this route remounts (e.g. after
  // navigating to the Capability Center and back). So on mount, if a session was
  // already active, resume it to reload the conversation — otherwise the user returns
  // to an empty page even though the session is still "selected".
  useEffect(() => {
    const sessionId = getSessionId();
    if (sessionId) {
      setCurrentSessionId(sessionId);
      setSessionId(sessionId);
      if (!checkIsQueryRunning()) {
        clearMessages();
        resumeSession(sessionId).catch((error) => {
          console.error('[Route] Failed to resume restored session on mount:', error);
        });
      }
    }
    // Run once on mount; setSessionId/clearMessages are stable store actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSessionId, clearMessages]);

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
    fireSessionSummaryIfNeeded();
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
        trackClaudeAgentSessionCreated({ sessionId: newSessionId });
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
      trackClaudeAgentSessionSwitched({ sessionId: sdkSessionId, isResume: true });
    }
  }, [setSessionId, clearMessages, temporarySkills, clearTemporarySkills, disableUserSkills]);

  const handleSelectSession = useCallback(async (sdkSessionId: string) => {
    // Check both route state and adapter state for current session
    // This prevents abort during active query when user clicks on current session
    const adapterSessionId = getSessionId();
    const isSameSession = sdkSessionId === currentSessionId || sdkSessionId === adapterSessionId;
    if (isSameSession) {
      const hasMessages = useChatSessionStore.getState().messages.length > 0;
      if (!hasMessages) {
        console.log('[Route] Session active but empty, forcing resume:', sdkSessionId);
        await performSessionSwitch(sdkSessionId, false);
      } else {
        console.log('[Route] Session already active, skipping:', sdkSessionId);
      }
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

  const handleInterruptSwitch = useCallback(async () => {
    if (!pendingSessionSwitch) {
      return;
    }
    const { targetSessionId, isNewSession } = pendingSessionSwitch;
    console.log('[Route] User chose to interrupt and switch', { targetSessionId, isNewSession });
    setPendingSessionSwitch(null);
    notifyUserAbort();
    try {
      await abort();
    } catch (error) {
      console.warn('[Route] Failed to send abort signal:', error);
    }
    await performSessionSwitch(targetSessionId, isNewSession);
  }, [pendingSessionSwitch, performSessionSwitch]);

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
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              {content.emptyState.title}
            </h1>
            <p className="text-muted-foreground max-w-md">
              {content.emptyState.subtitle}
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
                <span>{content.buttons.loading}</span>
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span>{content.emptyState.startChat}</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Dev mode: skip client-side auth check
  if (isDev) {
    const chatPanel = (
      <>
        {/* Floating action buttons - only show when no artifact */}
        {!activeArtifactId && !sessionListExpanded && (
          <div className="absolute top-4 left-4 z-10 flex gap-2">
            <button
              type="button"
              onClick={() => setSessionListExpanded(!sessionListExpanded)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border shadow-sm transition-colors hover:bg-accent"
              aria-label={toLocalizedString(sessionListExpanded ? content.sidebar.collapse : content.sidebar.expand)}
              title={toLocalizedString(sessionListExpanded ? content.sidebar.collapse : content.sidebar.expand)}
            >
              {sessionListExpanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
            {!sessionListExpanded && (
              <button
                type="button"
                onClick={handleNewSession}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                aria-label={toLocalizedString(content.header.newChat)}
                title={toLocalizedString(content.header.newChat)}
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
          hideScrollbars={Boolean(activeArtifactId)}
        />
      </>
    );

    return (
      <div className="h-full">
        <div className={cn('flex h-full', activeArtifactId && 'group')} ref={artifactSplitRef}>
          {/* Session List - only show when no artifact AND user has sessions */}
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
          <div
            className="h-full shrink-0 relative"
            style={{ flexBasis: 0, flexGrow: activeArtifactId ? artifactSplitRatio : 1 }}
          >
            {chatPanel}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={handleArtifactSplitResize}
            className={cn(
              'relative z-10 w-2 shrink-0 cursor-col-resize touch-none transition-opacity',
              activeArtifactId
                ? isArtifactSplitResizing
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                : 'opacity-0 pointer-events-none'
            )}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
          </div>
          <div
            className={cn(
              'h-full shrink-0 overflow-hidden border-l',
              !activeArtifactId && 'hidden lg:block'
            )}
            style={
              activeArtifactId
                ? { flexBasis: 0, flexGrow: 1 - artifactSplitRatio, maxWidth: 'none' }
                : { width: 360 }
            }
          >
            {activeArtifactId ? (
              <ArtifactsPanel
                artifactId={activeArtifactId}
                onClose={() => setActiveArtifact(null)}
              />
            ) : (
              <WorkbenchPanel currentSessionId={currentSessionId} />
            )}
          </div>
        </div>

        {pendingSessionSwitch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 max-w-md rounded-xl bg-card p-6 shadow-xl">
              <h3 className="mb-3 text-lg font-semibold text-foreground">
                {content.sessionSwitch.title}
              </h3>
              <p className="mb-6 text-muted-foreground">
                {content.sessionSwitch.message}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleInterruptSwitch}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {content.sessionSwitch.interrupt}
                </button>
                <button
                  type="button"
                  onClick={handleCancelSwitch}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {content.sessionSwitch.cancel}
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
          {content.auth.checkingSession}
        </div>
      </AuthLoading>

      <RedirectToSignIn />

      <SignedIn>
        {/* Empty state: no sessions at all, show big "Start New Session" button */}
        {isSessionsEmpty && !currentSessionId ? (
          <EmptyStateContent
            isCreatingSession={isCreatingSession}
            onNewSession={handleNewSession}
          />
        ) : (
          <>
            <MainContent
              activeArtifactId={activeArtifactId}
              artifactSplitRef={artifactSplitRef}
              artifactSplitRatio={artifactSplitRatio}
              isArtifactSplitResizing={isArtifactSplitResizing}
              onArtifactSplitResize={handleArtifactSplitResize}
              hasAnySessions={hasAnySessions}
              sessionListExpanded={sessionListExpanded}
              currentSessionId={currentSessionId}
              setActiveArtifact={setActiveArtifact}
              setSessionListExpanded={setSessionListExpanded}
              handleSelectSession={handleSelectSession}
              handleNewSession={handleNewSession}
              chatKey={chatKey}
              permissionInfo={permissionInfo}
              isInitializingSession={isInitializingSession}
              isCreatingSession={isCreatingSession}
              pendingSessionSwitch={pendingSessionSwitch}
              handleCancelSwitch={handleCancelSwitch}
              handleInterruptSwitch={handleInterruptSwitch}
            />
          </>
        )}
      </SignedIn>
    </div>
  );
}

/**
 * Empty State Content Component
 * Reusable empty state for when no sessions exist
 */
const EmptyStateContent: FC<{
  isCreatingSession: boolean;
  onNewSession: () => void;
}> = ({ isCreatingSession, onNewSession }) => {
  const content = useIntlayer('claude-chat');
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            {content.emptyState.title}
          </h1>
          <p className="text-muted-foreground max-w-md">
            {content.emptyState.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onNewSession}
          disabled={isCreatingSession}
          className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground font-medium transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreatingSession ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{content.buttons.loading}</span>
            </>
          ) : (
            <>
              <Plus className="h-5 w-5" />
              <span>{content.emptyState.startChat}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * Main Content Component
 * Reusable main content area with session list, chat surface, and artifacts panel
 */
const MainContent: FC<{
  activeArtifactId: string | null;
  artifactSplitRef: MutableRefObject<HTMLDivElement | null>;
  artifactSplitRatio: number;
  isArtifactSplitResizing: boolean;
  onArtifactSplitResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  hasAnySessions: boolean;
  sessionListExpanded: boolean;
  currentSessionId: string | null;
  setActiveArtifact: (id: string | null) => void;
  setSessionListExpanded: (value: boolean) => void;
  handleSelectSession: (sdkSessionId: string) => void;
  handleNewSession: () => void;
  chatKey: number;
  permissionInfo: PermissionInfo;
  isInitializingSession: boolean;
  isCreatingSession: boolean;
  pendingSessionSwitch: {
    targetSessionId: string | null;
    isNewSession: boolean;
  } | null;
  handleCancelSwitch: () => void;
  handleInterruptSwitch: () => void;
}> = ({
  activeArtifactId,
  artifactSplitRef,
  artifactSplitRatio,
  isArtifactSplitResizing,
  onArtifactSplitResize,
  hasAnySessions,
  sessionListExpanded,
  currentSessionId,
  setActiveArtifact,
  setSessionListExpanded,
  handleSelectSession,
  handleNewSession,
  chatKey,
  permissionInfo,
  isInitializingSession,
  isCreatingSession,
  pendingSessionSwitch,
  handleCancelSwitch,
  handleInterruptSwitch,
}) => {
  const content = useIntlayer('claude-chat');
  const chatPanel = (
    <>
      {/* Floating action buttons - only show when no artifact */}
      {!activeArtifactId && !sessionListExpanded && (
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <button
            type="button"
            onClick={() => setSessionListExpanded(!sessionListExpanded)}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border shadow-sm transition-colors hover:bg-accent"
            aria-label={toLocalizedString(sessionListExpanded ? content.sidebar.collapse : content.sidebar.expand)}
            title={toLocalizedString(sessionListExpanded ? content.sidebar.collapse : content.sidebar.expand)}
          >
            {sessionListExpanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          {!sessionListExpanded && (
            <button
              type="button"
              onClick={handleNewSession}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              aria-label={toLocalizedString(content.header.newChat)}
              title={toLocalizedString(content.header.newChat)}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      <ClaudeChatSurface
        key={chatKey}
        permissionInfo={permissionInfo}
        hasSession={true}
        isInitializingSession={isInitializingSession}
        onStartSession={handleNewSession}
        isCreatingSession={isCreatingSession}
        hideScrollbars={Boolean(activeArtifactId)}
      />
    </>
  );

  return (
    <>
      <div className={cn('flex h-full', activeArtifactId && 'group')} ref={artifactSplitRef}>
        {/* Session List - only show when no artifact AND user has sessions */}
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
        <div
          className="h-full shrink-0 relative"
          style={{ flexBasis: 0, flexGrow: activeArtifactId ? artifactSplitRatio : 1 }}
        >
          {chatPanel}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onArtifactSplitResize}
          className={cn(
            'relative z-10 w-2 shrink-0 cursor-col-resize touch-none transition-opacity',
            activeArtifactId
              ? isArtifactSplitResizing
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          )}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
        </div>
        <div
          className={cn(
            'h-full shrink-0 overflow-hidden border-l',
            !activeArtifactId && 'hidden lg:block'
          )}
          style={
            activeArtifactId
              ? { flexBasis: 0, flexGrow: 1 - artifactSplitRatio, maxWidth: 'none' }
              : { width: 360 }
          }
        >
          {activeArtifactId ? (
            <ArtifactsPanel
              artifactId={activeArtifactId}
              onClose={() => setActiveArtifact(null)}
            />
          ) : (
            <WorkbenchPanel currentSessionId={currentSessionId} />
          )}
        </div>
      </div>

      {pendingSessionSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-xl bg-card p-6 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-foreground">
              {content.sessionSwitch.title}
            </h3>
            <p className="mb-6 text-muted-foreground">
              {content.sessionSwitch.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleInterruptSwitch}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {content.sessionSwitch.interrupt}
              </button>
              <button
                type="button"
                onClick={handleCancelSwitch}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                {content.sessionSwitch.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

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

  const imageEntries = registry.filter((entry) => entry.type === 'image');
  const otherEntries = registry.filter((entry) => entry.type !== 'image');

  if (imageEntries.length > 0) {
    const grouped = new Map<string, typeof imageEntries>();

    for (const entry of imageEntries) {
      const key = entry.toolCallId
        ? `tool:${entry.toolCallId}`
        : entry.messageId
          ? `msg:${entry.messageId}`
          : `file:${entry.filePath}`;
      const existing = grouped.get(key) ?? [];
      existing.push(entry);
      grouped.set(key, existing);
    }

    for (const groupEntries of grouped.values()) {
      const imageFiles = (await Promise.all(
        groupEntries.map(async (entry) => {
          const mimeType = getMimeType(entry.filePath);
          const content = await readWorkspaceBinaryFile(sessionId, entry.filePath, mimeType);
          if (!content) return null;
          return { filePath: entry.filePath, content, mimeType };
        })
      ))
        .filter(Boolean) as Array<{ filePath: string; content: string; mimeType?: string }>;

      if (imageFiles.length === 0) {
        continue;
      }

      const primary = imageFiles[0];
      const existing = getArtifactByFilePath(sessionId, primary.filePath);
      const fileName = groupEntries[0]?.fileName || primary.filePath.split('/').pop() || primary.filePath;
      const lineageData = {
        toolCallId: groupEntries[0]?.toolCallId,
        toolName: groupEntries[0]?.toolName,
      };

      if (existing) {
        updateArtifact(existing.id, {
          content: primary.content,
          type: 'image',
          title: groupEntries[0]?.title,
          description: groupEntries[0]?.description,
          fileName,
          messageId: groupEntries[0]?.messageId,
          sourceFilePath: primary.filePath,
          sessionId,
          isTemporary: false,
          mimeType: primary.mimeType,
          imageFiles,
          ...lineageData,
        });
      } else {
        createArtifact({
          sessionId,
          sourceFilePath: primary.filePath,
          messageId: groupEntries[0]?.messageId,
          type: 'image',
          title: groupEntries[0]?.title,
          description: groupEntries[0]?.description,
          fileName,
          content: primary.content,
          isTemporary: false,
          mimeType: primary.mimeType,
          imageFiles,
          ...lineageData,
        });
      }
    }
  }

  for (const entry of otherEntries) {
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
  hideScrollbars = false,
}: {
  permissionInfo: PermissionInfo;
  hasSession: boolean;
  isInitializingSession: boolean;
  onStartSession?: () => void;
  isCreatingSession?: boolean;
  hideScrollbars?: boolean;
}) {
  const content = useIntlayer('claude-chat');
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
  const [imagePreview, setImagePreview] = useState<{
    isOpen: boolean;
    isLoading: boolean;
    title?: string;
    error?: string;
    images: ArtifactImageFile[];
  }>({ isOpen: false, isLoading: false, images: [] });

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

  const openWorkspaceImagePreview = useCallback(async (paths: string[], title?: string) => {
    if (!currentSessionId) {
      setImagePreview({
        isOpen: true,
        isLoading: false,
        images: [],
        title,
        error: content.errors.noSession,
      });
      return;
    }

    setFilePreview((prev) => ({ ...prev, isOpen: false }));
    setImagePreview({
      isOpen: true,
      isLoading: true,
      images: [],
      title,
    });

    try {
      const images = (await Promise.all(
        paths.map(async (path) => {
          const mimeType = getMimeType(path);
          const content = await readWorkspaceBinaryFile(currentSessionId, path, mimeType);
          if (!content) return null;
          return { filePath: path, content, mimeType };
        })
      ))
        .filter(Boolean) as ArtifactImageFile[];

      setImagePreview({
        isOpen: true,
        isLoading: false,
        images,
        title,
        error: images.length === 0
          ? toLocalizedString(content.errors.fileNotFound).replace('{path}', paths[0] || '')
          : undefined,
      });
    } catch (error) {
      setImagePreview({
        isOpen: true,
        isLoading: false,
        images: [],
        title,
        error: error instanceof Error ? error.message : content.errors.readFailed,
      });
    }
  }, [content, currentSessionId]);

  const openSessionImagePreview = useCallback(async (path: string, title?: string) => {
    if (!currentSessionId) {
      setImagePreview({
        isOpen: true,
        isLoading: false,
        images: [],
        title,
        error: content.errors.noSession,
      });
      return;
    }

    setFilePreview((prev) => ({ ...prev, isOpen: false }));
    setImagePreview({
      isOpen: true,
      isLoading: true,
      images: [],
      title,
    });

    try {
      const encodedPath = path.split('/').map((s) => encodeURIComponent(s)).join('/');
      const response = await fetch(`/api/session/${currentSessionId}/file/${encodedPath}`);
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }
      const data = await response.json();
      const contentValue = typeof data.content === 'string' ? data.content : '';
      const mimeType = typeof data.mimeType === 'string' ? data.mimeType : getMimeType(path);

      if (!contentValue) {
        setImagePreview({
          isOpen: true,
          isLoading: false,
          images: [],
          title,
          error: toLocalizedString(content.errors.fileNotFound).replace('{path}', path),
        });
        return;
      }

      setImagePreview({
        isOpen: true,
        isLoading: false,
        images: [{ filePath: path, content: contentValue, mimeType }],
        title,
      });
    } catch (error) {
      setImagePreview({
        isOpen: true,
        isLoading: false,
        images: [],
        title,
        error: error instanceof Error ? error.message : content.errors.readFailed,
      });
    }
  }, [content, currentSessionId]);

  // Handler for file path clicks - fetches file content and opens overlay
  const handleFileClick = useCallback(async (path: string) => {
    if (!currentSessionId) {
      console.warn('[Route] No session ID, cannot read file:', path);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: content.errors.noSession,
        isLoading: false,
      });
      return;
    }

    if (isImageFilePath(path)) {
      await openWorkspaceImagePreview([path], path.split('/').pop() || path);
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
      const fileContent = await readWorkspaceFile(currentSessionId, path);
      if (fileContent === null) {
        setFilePreview({
          isOpen: true,
          content: '',
          filePath: path,
          error: toLocalizedString(content.errors.fileNotFound).replace('{path}', path),
          isLoading: false,
        });
      } else {
        setFilePreview({
          isOpen: true,
          content: fileContent,
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
        error: error instanceof Error ? error.message : content.errors.readFailed,
        isLoading: false,
      });
    }
  }, [currentSessionId, content, openWorkspaceImagePreview]);

  // Handler for session file clicks - uses session API (for files in session root, not just workspace/)
  // P12 fix: Session files panel uses this for browsing entire session directory
  const handleSessionFileClick = useCallback(async (path: string) => {
    if (!currentSessionId) {
      console.warn('[Route] No session ID, cannot read file:', path);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: content.errors.noSession,
        isLoading: false,
      });
      return;
    }

    if (isImageFilePath(path)) {
      await openSessionImagePreview(path, path.split('/').pop() || path);
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
      const contentValue = typeof data.content === 'string' ? data.content : '';
      setFilePreview({
        isOpen: true,
        content: contentValue,
        filePath: path,
        isLoading: false,
      });
    } catch (error) {
      console.error('[Route] Failed to read session file:', path, error);
      setFilePreview({
        isOpen: true,
        content: '',
        filePath: path,
        error: error instanceof Error ? error.message : content.errors.readFailed,
        isLoading: false,
      });
    }
  }, [currentSessionId, content, openSessionImagePreview]);

  // Handler for URL clicks
  const handleUrlClick = useCallback((url: string) => {
    console.log('[Route] URL clicked:', url);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  // Session protection: warn before closing page during active query
  useBeforeUnloadProtection();
  // PostHog: 离开页面时上报 session 汇总
  useSessionSummaryOnLeave();

  // Esc interrupt state
  const [escPressedOnce, setEscPressedOnce] = useState(false);
  const escTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<ChatComposerRef | null>(null);
  const [composerText, setComposerText] = useState('');
  const [isA2ComposerOpen, setIsA2ComposerOpen] = useState(false);
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<{ slug: string; name?: string } | null>(null);

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

  const handleSelectSkill = useCallback((skill: { slug: string; name?: string }) => {
    setSelectedSkill(skill);
  }, []);

  const handleClearSelectedSkill = useCallback(() => {
    setSelectedSkill(null);
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

  // PostHog: 主视图变化埋点
  const viewRef = useRef<string>('chat');
  useEffect(() => {
    const view = showWorkspace
      ? 'workspace'
      : showSessionFiles
        ? 'documents'
        : showSessionInfo
          ? 'session_info'
          : isSkillsPanelOpen
            ? 'skills'
            : 'chat';
    if (view !== viewRef.current) {
      trackClaudeChatViewChanged({
        view,
        previousView: viewRef.current,
        sessionId: currentSessionId ?? undefined,
      });
      viewRef.current = view;
    }
  }, [showWorkspace, showSessionFiles, showSessionInfo, isSkillsPanelOpen, currentSessionId]);

  useEffect(() => {
    setSelectedSkill(null);
  }, [currentSessionId]);


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
            <ThreadPrimitive.Viewport
              className={cn(
                'flex-1 min-h-0 overflow-y-auto',
                hideScrollbars && 'scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none]'
              )}
            >
              {/* Show empty state only when no historical messages and not initializing */}
              {!hasHistoricalMessages && !isInitializingSession && (
                <ThreadPrimitive.Empty>
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="font-serif text-4xl font-semibold tracking-tight text-foreground">
                      {content.emptyState.title}
                    </div>
                    <p className="max-w-md text-muted-foreground">
                      {content.emptyState.subtitle}
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
                            <span>{content.buttons.loading}</span>
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4" />
                            <span>{content.emptyState.startChat}</span>
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
                    <div className="text-base font-medium text-foreground">{content.status.initializing}</div>
                    <div className="text-xs text-muted-foreground">{content.status.pleaseWait}</div>
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
                    onSkillSelect={handleSelectSkill}
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
                  selectedSkill={selectedSkill}
                  onClearSelectedSkill={handleClearSelectedSkill}
                  onSkillSelect={handleSelectSkill}
                />
              </>
            )}
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>

        {/* Global file preview overlay */}
        <CodePreviewOverlay
          isOpen={filePreview.isOpen}
          onClose={() => setFilePreview(prev => ({ ...prev, isOpen: false }))}
          content={filePreview.isLoading ? content.buttons.loading : filePreview.content}
          filePath={filePreview.filePath}
          error={filePreview.error}
        />
        <ImagePreviewOverlay
          isOpen={imagePreview.isOpen}
          onClose={() => setImagePreview(prev => ({ ...prev, isOpen: false }))}
          images={imagePreview.images}
          isLoading={imagePreview.isLoading}
          error={imagePreview.error}
          title={imagePreview.title}
        />

        {/* Esc interrupt overlay */}
        {escPressedOnce && (
          <div className="fixed inset-x-0 top-4 z-50 flex justify-center pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="rounded-lg bg-card px-4 py-2 text-sm text-white shadow-lg">
              {content.status.escInterrupt}
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

  if (!artifact || artifact.type === 'image') return null;

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

const getInlineImageFiles = (artifact: Artifact | null | undefined): ArtifactImageFile[] => {
  if (!artifact || artifact.type !== 'image') return [];
  if (artifact.imageFiles && artifact.imageFiles.length > 0) return artifact.imageFiles;
  if (!artifact.content) return [];
  const filePath = artifact.sourceFilePath || artifact.fileName || 'image';
  return [{ filePath, content: artifact.content, mimeType: artifact.mimeType }];
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
    .filter((part): part is TextContentPart =>
      part.type === 'text' && Boolean(part.text) && !part.isIntermediate && !part.isPending
    )
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
  // Get i18n content
  const content = useIntlayer('claude-chat');

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
  const hasFinalResponse = Boolean(copyText?.trim());

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
  const artifact = useArtifactDetection(message.id, messageContent);
  const inlineImageFiles = useMemo(() => getInlineImageFiles(artifact), [artifact]);

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
      <div className={cn('relative font-sans', hasFinalResponse ? 'mb-12' : 'mb-4')}>
        <div className="relative leading-[1.65rem]">
          <div className="grid grid-cols-1 gap-2.5">
            <div className="wrap-break-word whitespace-normal pr-8 pl-2 text-foreground">
              {/* Status indicator - only show when no structured content is available yet */}
              {isRunning && !hasContent && (
                <div className="mb-3">
                  <InlineStatus status={displayStatus} toolName={currentToolName} />
                </div>
              )}

              {messageContent && (
                <AssistantTurnCard
                  content={messageContent}
                  status={messageStatus}
                  onUrlClick={onUrlClick}
                  onFileClick={onFileClick}
                />
              )}

              {inlineImageFiles.length > 0 && (
                <InlineImagePreview
                  images={inlineImageFiles}
                  title={artifact?.fileName || artifact?.title}
                />
              )}

              {/* Multi-diff aggregation button */}
              {hasMultipleFileChanges && !isRunning && (
                <button
                  type="button"
                  onClick={() => setShowMultiDiff(true)}
                  className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70 dark:border-border dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted/70"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{toLocalizedString(content.actions.viewFileChanges).replace('{count}', String(successfulChanges.length))}</span>
                </button>
              )}

            </div>
          </div>
        </div>
        {hasFinalResponse && (
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
                  aria-label={toLocalizedString(content.message.copy)}
                >
                  <ClipboardIcon width={20} height={20} />
                </button>
                <ActionBarPrimitive.FeedbackPositive className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95" aria-label={toLocalizedString(content.actions.helpful)}>
                  <ThumbsUp width={16} height={16} />
                </ActionBarPrimitive.FeedbackPositive>
                <ActionBarPrimitive.FeedbackNegative className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95" aria-label={toLocalizedString(content.actions.notHelpful)}>
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
                    aria-label={toLocalizedString(content.actions.viewStats)}
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
                  {content.disclaimer}
                </p>
              )}
            </ActionBarPrimitive.Root>
          </div>
        )}
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
  const userSkillMarker = useMemo(() => {
    if (!isUser) return null;
    const parsed = parseSkillMarker(userTextContent);
    return { marker: parsed.marker, text: parsed.strippedText };
  }, [isUser, userTextContent]);

  if (isUser) {
    return (
      <MessagePrimitive.Root className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
        <div className="group/user wrap-break-word relative inline-flex max-w-[75ch] flex-col gap-2 rounded-xl bg-muted py-2.5 pr-6 pl-2.5 text-foreground transition-all">
          <div className="relative flex flex-row items-center gap-2">
            <div className="shrink-0 transition-all duration-300">
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
                {userSkillMarker?.marker && (
                  <div className="flex flex-wrap items-center gap-2">
                    <SkillChip label={userSkillMarker.marker.name ?? userSkillMarker.marker.slug} />
                  </div>
                )}
                <div className="wrap-break-word whitespace-normal">
                  <StreamingMarkdown
                    content={userSkillMarker?.text ?? userTextContent}
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
  // Get i18n content
  const content = useIntlayer('claude-chat');

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
  const parsedSkill = useMemo(() => parseSkillMarker(textContent), [textContent]);

  // Artifact detection for assistant messages - pass full content array to support both text and tool-call detection
  const artifact = useArtifactDetection(message.id, isAssistant ? message.content : undefined);
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact);
  const inlineImageFiles = useMemo(() => getInlineImageFiles(artifact), [artifact]);

  // Extract file changes for multi-diff overlay (only for assistant messages)
  const fileChanges = useMemo(() => {
    if (!isAssistant) return [];
    return extractFileChanges(message.content, message.id);
  }, [isAssistant, message.content, message.id]);

  // Filter to only successful changes for multi-diff display
  const successfulChanges = useMemo(() => fileChanges.filter(c => !c.error), [fileChanges]);
  const hasMultipleFileChanges = successfulChanges.length > 1;
  const finalText = useMemo(
    () => getMessageTextContent(message.content as ContentPart[]),
    [message.content]
  );
  const hasFinalResponse = Boolean(finalText?.trim());

  if (isUser) {
    // User message - aligned with ChatMessage user structure
    return (
      <div className="group relative mx-auto mt-1 mb-1 block w-full max-w-3xl">
        <div className="group/user wrap-break-word relative inline-flex max-w-[75ch] flex-col gap-2 rounded-xl bg-muted py-2.5 pr-6 pl-2.5 text-foreground transition-all">
          <div className="relative flex flex-row items-center gap-2">
            <div className="shrink-0 transition-all duration-300">
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
                {parsedSkill.marker && (
                  <div className="flex flex-wrap items-center gap-2">
                    <SkillChip label={parsedSkill.marker.name ?? parsedSkill.marker.slug} />
                  </div>
                )}
                <div className="wrap-break-word whitespace-normal">
                  <StreamingMarkdown
                    content={parsedSkill.strippedText}
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
                    onClick={() => navigator.clipboard.writeText(parsedSkill.strippedText)}
                    className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-accent active:scale-95"
                    aria-label={toLocalizedString(content.message.copy)}
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
        <div className={cn('relative font-sans', hasFinalResponse ? 'mb-12' : 'mb-4')}>
          <div className="relative leading-[1.65rem]">
            <div className="grid grid-cols-1 gap-2.5">
              <div className="wrap-break-word whitespace-normal pr-8 pl-2 text-foreground">
                <AssistantTurnCard
                  content={message.content as ContentPart[]}
                  onUrlClick={onUrlClick}
                  onFileClick={onFileClick}
                />

                {inlineImageFiles.length > 0 && (
                  <InlineImagePreview
                    images={inlineImageFiles}
                    title={artifact?.fileName || artifact?.title}
                  />
                )}

                {/* Artifact Button */}
                {artifact && artifact.type !== 'image' && (
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
                    className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70 dark:border-border dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted/70"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>{toLocalizedString(content.actions.viewFileChanges).replace('{count}', String(successfulChanges.length))}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* ActionBar - aligned with AssistantMessage (copy/feedback only, no reload/stats for historical) */}
          {hasFinalResponse && (
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
                    aria-label={toLocalizedString(content.message.copy)}
                  >
                    <ClipboardIcon width={20} height={20} />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                    aria-label={toLocalizedString(content.actions.helpful)}
                  >
                    <ThumbsUp width={16} height={16} />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md transition duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] hover:bg-transparent active:scale-95"
                    aria-label={toLocalizedString(content.actions.notHelpful)}
                  >
                    <ThumbsDown width={16} height={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
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
