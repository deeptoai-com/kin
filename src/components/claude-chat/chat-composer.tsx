/**
 * ChatComposer Component
 *
 * Extracted from route.tsx for better modularity and future A2Composer integration.
 * Uses Assistant-UI's ComposerPrimitive + useComposer for state management.
 *
 * ## v0.1 Scope
 * - Component extraction only (no composer-form yet)
 * - Template insertion via exposed ref methods
 * - All existing logic preserved
 *
 * ## External Control Interface
 * ```tsx
 * const composerRef = useRef<ChatComposerRef>(null);
 *
 * // Insert text at cursor or append
 * composerRef.current?.setText("Hello world");
 *
 * // Programmatically send
 * composerRef.current?.send();
 * ```
 *
 * @see src/components/claude-chat/claude-chat-controller.tsx for controller integration
 */

import {
  AttachmentPrimitive,
  ComposerPrimitive,
  useAssistantApi,
  useAssistantState,
  useThread,
} from '@assistant-ui/react';
import {
  Cross2Icon,
  InfoCircledIcon,
  ReloadIcon,
} from '@radix-ui/react-icons';
import { FolderOpen, FolderTree, Plus, ArrowUpIcon } from 'lucide-react';
import { useCallback, useEffect, useState, useRef, useImperativeHandle } from 'react';
import type { ChangeEvent, FormEvent, MutableRefObject } from 'react';
import { ContextBadges } from './context-badges';
import { SkillChip } from './skill-chip';
import { KnowledgeBasePanel } from './knowledge-base-panel';
import { useWorkbenchUI } from '~/lib/stores/workbench-ui-store';
import { type SessionMetadata } from './session-info-panel';
import { type PermissionInfo } from './permission-badge';
import { PermissionTierSelector } from './permission-tier-selector';
import { ModelPicker } from './model-picker';
import { ToolbarStatus, type AgentStatusType } from './claude-status';
import { McpStatusIndicator } from './mcp-status-indicator';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { useMessageAttachments, type PendingAttachment } from '~/lib/utils/message-attachments';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { useDraftAutoSave } from '~/lib/hooks/use-session-protection';
import { buildSkillMarker, injectSkillMarker } from '~/lib/skills/skill-marker';
import { trackClaudeAgentQuerySent } from '~/lib/observability/posthog-events';

/**
 * Uploaded workspace file status
 */
type UploadedWorkspaceFile = {
  name: string;
  path: string;
  /** Workspace-relative path the Agent should Read (parsed .md for rich docs, else == path). */
  agentPath?: string;
  mimeType?: string;
  fileSize?: number;
  status: 'uploaded' | 'error';
  error?: string;
  /** Non-fatal notice shown on the chip (e.g. a scanned PDF with no text layer). */
  notice?: string;
};

/**
 * Props for ChatComposer component
 */
export interface ChatComposerProps {
  /** Session permission info */
  permissionInfo: PermissionInfo;
  /** Current session ID (null = no active session) */
  currentSessionId: string | null;
  /** Lazily create the session (new-chat landing creates nothing until needed). Lets the
   *  upload/KB/files buttons work BEFORE the first message: click → create → proceed. */
  ensureSession?: () => Promise<void>;
  /** Session metadata (for context badges display) */
  sessionMetadata: SessionMetadata | null;
  /** Hide Skills trigger (when A2Composer is expanded) */
  hideSkillsTrigger?: boolean;
  /** Notify parent when Skills panel open state changes */
  onSkillsOpenChange?: (open: boolean) => void;
  /** Workspace panel visibility state */
  showWorkspace: boolean;
  /** Workspace panel visibility setter */
  setShowWorkspace: (value: boolean) => void;
  /** Session files panel visibility state */
  showSessionFiles: boolean;
  /** Session files panel visibility setter */
  setShowSessionFiles: (value: boolean) => void;
  /** Session info panel visibility state */
  showSessionInfo: boolean;
  /** Session info panel visibility setter */
  setShowSessionInfo: (value: boolean) => void;
  /** Handler for session file clicks (opens preview overlay) */
  onSessionFileClick?: (path: string) => void;
  /** Handler for aborting the current query */
  onAbort?: () => void;
  /** Notify parent of composer text changes */
  onTextChange?: (text: string) => void;
  /** Called when user sends a message */
  onSend?: () => void;
  /** Selected skill for explicit use (hint → composer placeholder when armed) */
  selectedSkill?: { slug: string; name?: string; hint?: string } | null;
  /** Clear selected skill */
  onClearSelectedSkill?: () => void;
  /** Select a skill from composer UI */
  onSkillSelect?: (skill: { slug: string; name: string }) => void;
  /** Called after a sent message's attachments are persisted (so the thread can
   *  refresh and show the file chip live, not only after a session switch). */
  onAttachmentsPersisted?: () => void;
}

/**
 * Imperative handle interface for external control
 * Used by parent components (e.g., A2Composer template insertion)
 */
export interface ChatComposerRef {
  /** Set composer text content (replaces existing text) */
  setText: (text: string) => void;
  /** Programmatically trigger message send */
  send: () => void;
  /** Focus the composer input */
  focus: () => void;
}

/**
 * Upload a file to the workspace
 */
async function uploadWorkspaceFile(sessionId: string, file: File, filePath?: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filePath', filePath ?? file.name);

  const response = await fetch(`/api/workspace/${sessionId}/files`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error || `Upload failed (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<{
    filePath: string;
    storedPath: string;
    parsedPath?: string;
    parsedEngine?: string;
    parseStatus?: 'parsed' | 'scanned';
  }>;
}

/**
 * ChatComposer Component
 *
 * Main input interface for Claude Agent Chat.
 * Handles message composition, file uploads, and panel toggles.
 */
export function ChatComposer({
  permissionInfo,
  currentSessionId,
  ensureSession,
  sessionMetadata,
  showWorkspace,
  setShowWorkspace,
  showSessionFiles,
  setShowSessionFiles,
  showSessionInfo,
  setShowSessionInfo,
  onSessionFileClick,
  onAbort,
  onTextChange,
  onSend,
  hideSkillsTrigger,
  onSkillsOpenChange,
  selectedSkill,
  onClearSelectedSkill,
  onSkillSelect,
  onAttachmentsPersisted,
}: ChatComposerProps) {
  const content = useIntlayer('claude-chat');
  const api = useAssistantApi();
  // The composer's file/info icons now open the right-side workbench to a tab
  // (会话文件→Files, info→Context), instead of separate popovers — one place, the
  // workbench owns it. Shared store because the workbench is a far-apart sibling here.
  const openWorkbenchTab = useWorkbenchUI((s) => s.openTab);
  const composerText = useAssistantState(({ composer }) => composer.text);
  const composerRunConfig = useAssistantState(({ composer }) => composer.runConfig);
  const composerIsEditing = useAssistantState(({ composer }) => composer.isEditing);
  const isRunning = useThread((state) => state.isRunning);
  // Persist attachments against the SAME message list the thread renders from
  // (the chat-session store, whose user-message id is minted in route `onNew`).
  // The assistant-ui runtime thread (`useThread`) mints a *different* id, so
  // keying off it would store attachments under an id the renderer never looks
  // up — the file chip would never appear.
  const storeMessages = useChatSessionStore((state) => state.messages);

  const [uploadedFiles, setUploadedFiles] = useState<UploadedWorkspaceFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { persistAttachments } = useMessageAttachments();
  const pendingAttachmentsRef = useRef<PendingAttachment[] | null>(null);
  const lastPersistedMessageIdRef = useRef<string | null>(null);

  // Get agent status from store for ToolbarStatus
  const agentStatus = useChatSessionStore((state) => state.agentStatus);
  const currentToolName = useChatSessionStore((state) => state.currentToolName);
  const queueCount = useChatSessionStore((state) => state.queueCount);
  const selectedTier = useChatSessionStore((state) => state.selectedTier);
  const setSelectedTier = useChatSessionStore((state) => state.setSelectedTier);
  const displayStatus: AgentStatusType = isRunning ? (agentStatus as AgentStatusType) : 'idle';

  // Draft auto-save: persist unsent input to localStorage
  const { saveDraft, clearDraft } = useDraftAutoSave(
    useCallback(() => composerText, [composerText]),
    useCallback((text: string) => api.composer().setText(text), [api])
  );

  // Save draft whenever text changes
  useEffect(() => {
    saveDraft(composerText);
  }, [composerText, saveDraft]);

  useEffect(() => {
    onTextChange?.(composerText);
  }, [composerText, onTextChange]);

  // Clear draft when query starts (message sent successfully)
  const prevIsRunning = useRef(isRunning);
  useEffect(() => {
    if (isRunning && !prevIsRunning.current) {
      clearDraft();
    }
    prevIsRunning.current = isRunning;
  }, [isRunning, clearDraft]);

  useEffect(() => {
    setUploadedFiles([]);
    setUploadError(null);
  }, [currentSessionId]);

  useEffect(() => {
    pendingAttachmentsRef.current = null;
    lastPersistedMessageIdRef.current = null;
  }, [currentSessionId]);

  useEffect(() => {
    if (!currentSessionId) return;
    const pending = pendingAttachmentsRef.current;
    if (!pending || pending.length === 0) return;

    const lastUserMessage = [...storeMessages].reverse().find((msg) => msg.role === 'user');
    if (!lastUserMessage || lastUserMessage.id === lastPersistedMessageIdRef.current) return;

    persistAttachments(currentSessionId, lastUserMessage.id, pending).then(() => {
      lastPersistedMessageIdRef.current = lastUserMessage.id;
      pendingAttachmentsRef.current = null;
      setUploadedFiles([]);
      setUploadError(null);
      onAttachmentsPersisted?.();
    });
  }, [currentSessionId, storeMessages, persistAttachments, onAttachmentsPersisted]);

  const handleClearInput = useCallback(async () => {
    setUploadedFiles([]);
    setUploadError(null);
    await api.composer().reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [api]);

  const handleExampleSelect = useCallback((prompt: string) => {
    if (!prompt) return;
    api.composer().setText(prompt);
    const composerRoot = document.querySelector('[data-composer-root] [contenteditable=\"true\"]') as HTMLElement;
    if (composerRoot) {
      composerRoot.focus();
      return;
    }
    const input = document.querySelector('[contenteditable=\"true\"]') as HTMLElement;
    input?.focus();
  }, [api]);

  // Lazy-create the session on first workspace-needing action (upload/KB/files buttons):
  // new-chat landings create nothing until needed, but a user clicking upload has clear
  // intent — create the session right there instead of disabling the buttons.
  const [ensuringSession, setEnsuringSession] = useState(false);
  const withSession = useCallback(
    async (action: () => void) => {
      if (!currentSessionId && ensureSession) {
        setEnsuringSession(true);
        try {
          await ensureSession();
        } catch (err) {
          console.error('[Composer] lazy session create failed:', err);
          setUploadError('创建会话失败，请重试。');
          return;
        } finally {
          setEnsuringSession(false);
        }
      }
      action();
    },
    [currentSessionId, ensureSession],
  );

  const handleUploadClick = useCallback(() => {
    void withSession(() => {
      setUploadError(null);
      fileInputRef.current?.click();
    });
  }, [withSession]);

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    if (!currentSessionId) {
      setUploadError('请先发送一条消息以创建会话，再上传文件。');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    for (const file of Array.from(files)) {
      try {
        const result = await uploadWorkspaceFile(currentSessionId, file);
        setUploadedFiles((prev) => ([
          ...prev,
          {
            name: file.name,
            path: result.filePath,
            // Rich docs are parsed to `<name>.md` server-side — point the Agent there.
            agentPath: result.parsedPath ?? result.filePath,
            mimeType: file.type,
            fileSize: file.size,
            status: 'uploaded',
            notice: result.parseStatus === 'scanned'
              ? '扫描件 PDF，无文字层，AI 暂时无法按文本读取'
              : undefined,
          },
        ]));
        try {
          await api.composer().addAttachment(file);
        } catch (error) {
          console.warn('[Composer] Attachments not supported by current adapter:', error);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '上传失败';
        setUploadedFiles((prev) => ([
          ...prev,
          {
            name: file.name,
            path: file.name,
            mimeType: file.type,
            fileSize: file.size,
            status: 'error',
            error: message,
          },
        ]));
        setUploadError(message);
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [api, currentSessionId]);

  const composerHasText = composerText.trim().length > 0;
  // F1: gate send on upload completion — otherwise pressing Enter mid-upload sends
  // before `uploadedFiles` is populated and silently drops the attachment.
  const canSend = composerIsEditing && composerHasText && !isRunning && !isUploading;

  const handleSend = useCallback((event?: FormEvent) => {
    if (event) {
      event.preventDefault();
    }
    if (!composerHasText) {
      setUploadError('请先输入内容再发送。');
      return;
    }
    if (!canSend || isRunning) return;
    const pendingAttachments = uploadedFiles
      .filter((file) => file.status === 'uploaded')
      .map((file) => ({
        originalName: file.name,
        // Agent reads the parsed .md for rich docs; falls back to the original path.
        filePath: file.agentPath ?? file.path,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
      }));
    pendingAttachmentsRef.current = pendingAttachments.length > 0 ? pendingAttachments : null;
    const baseRunConfig = composerRunConfig ?? {};
    const baseCustom = (baseRunConfig.custom ?? {}) as Record<string, unknown>;
    const { attachments: _ignoredAttachments, skill: _ignoredSkill, ...restCustom } = baseCustom;
    const skillMarker = selectedSkill?.slug
      ? buildSkillMarker(selectedSkill.slug, selectedSkill.name)
      : null;
    const nextRunConfig = {
      ...baseRunConfig,
      custom: {
        ...restCustom,
        attachments: pendingAttachments,
        ...(selectedSkill?.slug ? { skill: { slug: selectedSkill.slug, name: selectedSkill.name } } : {}),
      },
    };
    api.composer().setRunConfig(nextRunConfig);
    const sendNow = () => {
      trackClaudeAgentQuerySent({
        queryLength: composerText.trim().length,
        hasAttachments: pendingAttachments.length > 0,
        attachmentCount: pendingAttachments.length,
        skillSlug: selectedSkill?.slug ?? undefined,
        skillName: selectedSkill?.name ?? undefined,
        sessionId: currentSessionId ?? undefined,
      });
      // Notify parent before sending (for auto-collapse A2ComposerPanel)
      onSend?.();
      api.composer().send();
      if (Object.prototype.hasOwnProperty.call(baseCustom, 'attachments') || Object.prototype.hasOwnProperty.call(baseCustom, 'skill')) {
        api.composer().setRunConfig({
          ...baseRunConfig,
          custom: restCustom,
        });
      } else {
        api.composer().setRunConfig(baseRunConfig);
      }
    };

    if (skillMarker) {
      const nextText = injectSkillMarker(composerText, skillMarker);
      if (nextText !== composerText) {
        api.composer().setText(nextText);
        queueMicrotask(sendNow);
        return;
      }
    }

    sendNow();
  }, [api, canSend, composerHasText, isRunning, uploadedFiles, onSend, composerRunConfig, composerText, selectedSkill]);

  return (
    <ComposerPrimitive.Root
      data-composer-root="true"
      className="relative z-30 shrink-0 mx-auto flex w-full max-w-3xl flex-col overflow-visible rounded-2xl border border-border/70 bg-card p-0.5 shadow-md transition-shadow duration-200 focus-within:shadow-lg hover:shadow-lg"
      onSubmit={handleSend}
    >
      <div className="m-3.5 flex flex-col gap-3.5">
        {/* Context badges - show active Skills and MCP sources */}
        {!isRunning && sessionMetadata && (
          <ContextBadges
            sessionMetadata={sessionMetadata}
            onExampleSelect={handleExampleSelect}
            onSkillsOpenChange={onSkillsOpenChange}
            hideSkillsTrigger={hideSkillsTrigger}
            onSkillSelect={onSkillSelect}
          />
        )}
        {selectedSkill?.slug && (
          <div className="flex flex-wrap items-center gap-2">
            <SkillChip
              label={selectedSkill.name ?? selectedSkill.slug}
              onRemove={onClearSelectedSkill}
              className="bg-foreground/90 text-background"
            />
          </div>
        )}
        <div className="relative z-10">
          <div className="wrap-break-word max-h-96 w-full overflow-y-auto">
            <ComposerPrimitive.Input
              placeholder={
                selectedSkill?.hint || toLocalizedString(content.chatInput.placeholderGreeting)
              }
              className="block min-h-6 w-full resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="flex w-full items-center gap-2">
          <div className="relative flex min-w-0 flex-1 shrink items-center gap-2">
            <button
              type="button"
              onClick={handleUploadClick}
              className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="上传文件"
              disabled={isUploading || ensuringSession}
              title="上传文件到工作区"
            >
              <Plus width={16} height={16} />
            </button>
            <button
              type="button"
              onClick={handleClearInput}
              className="flex h-8 min-w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98]"
              aria-label="清空输入"
              title="清空输入"
            >
              <ReloadIcon width={16} height={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFilesSelected}
            />
          </div>
          <div className="flex items-center gap-2">
            {/* Model picker (multi-model) - only show when not running */}
            {!isRunning && <ModelPicker />}

            {/* Workspace Toggle Button - only show when not running */}
            {!isRunning && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => void withSession(() => setShowWorkspace(!showWorkspace))}
                  className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="切换工作空间"
                  title="知识库 / 工作区"
                  disabled={ensuringSession}
                >
                  <FolderOpen width={16} height={16} />
                </button>

                {/* Workspace Panel */}
                {showWorkspace && currentSessionId && (
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-80 rounded-lg border border-border bg-popover p-4 shadow-lg dark:border-border dark:bg-popover">
                    {/* Header */}
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-foreground text-sm dark:text-foreground">
                        📚 Knowledge Base
                      </h3>
                      <button
                        onClick={() => setShowWorkspace(false)}
                        className="rounded p-1 text-muted-foreground transition hover:bg-muted dark:text-muted-foreground dark:hover:bg-muted"
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
            )}

            {/* Session Files Button - only show when not running */}
            {!isRunning && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => void withSession(() => openWorkbenchTab('files'))}
                  className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="会话文件（右侧工作台 Files）"
                  title="会话文件 · 开/关右侧工作台（Files）"
                  disabled={ensuringSession}
                >
                  <FolderTree width={16} height={16} />
                </button>
              </div>
            )}

            {/* Session Info → opens the workbench Context tab (model · capabilities ·
                tokens) — same content as the old popover, now unified + always clickable
                (gated only on having a session, not on sessionMetadata being loaded). */}
            {!isRunning && (
              <button
                type="button"
                onClick={() => void withSession(() => openWorkbenchTab('context'))}
                className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="会话信息（右侧工作台 Context）"
                title="会话信息 · 开/关右侧工作台（Context）"
                disabled={ensuringSession}
              >
                <InfoCircledIcon width={16} height={16} />
              </button>
            )}

            {/* Permission Tier Selector - only show when not running */}
            {!isRunning && (
              <PermissionTierSelector
                selectedTier={selectedTier}
                onSelect={setSelectedTier}
              />
            )}

            {/* ToolbarStatus - show when running */}
            {isRunning && (
              <ToolbarStatus
                status={displayStatus}
                toolName={currentToolName}
                queueCount={queueCount}
                onAbort={() => {
                  onAbort?.();
                  api.composer().cancel();
                }}
              />
            )}

            {/* MCP Status Indicator */}
            <McpStatusIndicator className="ml-2" />

            {/* Send button */}
            <button
              type="submit"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary bg-[linear-gradient(180deg,color-mix(in_oklab,var(--primary),white_9%),color-mix(in_oklab,var(--primary),black_10%))] text-primary-foreground shadow-sm transition-all hover:brightness-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              title={isRunning ? '正在生成，先停止或等待' : '发送消息'}
              aria-label="发送消息"
              disabled={!canSend}
            >
              <ArrowUpIcon width={16} height={16} />
            </button>
          </div>
        </div>
      </div>
      <ComposerAttachmentsSection
        uploadedFiles={uploadedFiles}
        uploadError={uploadError}
        isUploading={isUploading}
      />
    </ComposerPrimitive.Root>
  );
}

/**
 * Composer Attachments Section
 * Displays uploaded files and error messages
 */
interface ComposerAttachmentsSectionProps {
  uploadedFiles: UploadedWorkspaceFile[];
  uploadError: string | null;
  isUploading: boolean;
}

function ComposerAttachmentsSection({ uploadedFiles, uploadError, isUploading }: ComposerAttachmentsSectionProps) {
  const hasUploads = uploadedFiles.length > 0;
  const hasContent = hasUploads || uploadError || isUploading;

  if (!hasContent) return null;

  return (
    <div className="relative z-40 overflow-visible rounded-b-2xl">
      <div className="overflow-x-auto overflow-y-visible rounded-b-2xl border border-t bg-muted px-3.5 py-2">
        <div className="relative z-50 flex flex-wrap items-center gap-3" data-attachments="true">
          <ComposerPrimitive.Attachments components={{ Attachment: ClaudeAttachment }} />
          {hasUploads && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {uploadedFiles.map((file) => (
                <span
                  key={`${file.path}-${file.status}`}
                  className={`rounded-md border px-2 py-0.5 ${
                    file.status === 'error'
                      ? 'border-destructive text-destructive'
                      : file.notice
                        ? 'border-amber-500/60 text-amber-600 dark:text-amber-400'
                        : 'border-transparent bg-card text-foreground'
                  }`}
                  title={file.error || file.notice || file.path}
                >
                  {file.notice ? `⚠️ ${file.path}` : file.path}
                </span>
              ))}
            </div>
          )}
        </div>
        {(uploadError || isUploading) && (
          <div className="mt-2 text-xs">
            {isUploading && <span className="text-muted-foreground">正在上传文件...</span>}
            {uploadError && <span className="text-destructive">{uploadError}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Attachment Thumbnail Component
 */
function ClaudeAttachment() {
  const content = useIntlayer('claude-chat');
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
        aria-label={toLocalizedString(content.composer.removeAttachment)}
      >
        <Cross2Icon width={12} height={12} />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

/**
 * Forward ref version with imperative handle for external control
 * Use this when parent component needs to control the composer
 */
interface ChatComposerWithRefProps extends ChatComposerProps {
  composerRef: MutableRefObject<ChatComposerRef | null>;
}

export function ChatComposerWithRef({ composerRef, onSend, ...props }: ChatComposerWithRefProps) {
  const api = useAssistantApi();

  // Expose control methods to parent via ref
  useImperativeHandle(composerRef, () => ({
    setText: (text: string) => {
      api.composer().setText(text);
    },
    send: () => {
      api.composer().send();
    },
    focus: () => {
      // Focus the composer input element
      // Use more specific selector to target the composer's contenteditable
      const composerRoot = document.querySelector('[data-composer-root] [contenteditable="true"]') as HTMLElement;
      if (composerRoot) {
        composerRoot.focus();
        return;
      }
      // Fallback to generic selector
      const input = document.querySelector('[contenteditable="true"]') as HTMLElement;
      input?.focus();
    },
  }), [api]);

  return <ChatComposer {...props} onSend={onSend} />;
}
