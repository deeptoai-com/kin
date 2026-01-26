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
 * @see src/routes/agents/claude-chat/route.tsx for original implementation
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
import { KnowledgeBasePanel } from './knowledge-base-panel';
import { SessionFilesPanel } from './session-files-panel';
import { SessionInfoPanel, type SessionMetadata } from './session-info-panel';
import { PermissionBadge, type PermissionInfo } from './permission-badge';
import { ToolbarStatus, type AgentStatusType } from './claude-status';
import { McpStatusIndicator } from './mcp-status-indicator';
import { useMessageAttachments, type PendingAttachment } from '~/lib/utils/message-attachments';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { useDraftAutoSave } from '~/lib/hooks/use-session-protection';

/**
 * Uploaded workspace file status
 */
type UploadedWorkspaceFile = {
  name: string;
  path: string;
  mimeType?: string;
  fileSize?: number;
  status: 'uploaded' | 'error';
  error?: string;
};

/**
 * Props for ChatComposer component
 */
export interface ChatComposerProps {
  /** Session permission info */
  permissionInfo: PermissionInfo;
  /** Current session ID (null = no active session) */
  currentSessionId: string | null;
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
}: ChatComposerProps) {
  const api = useAssistantApi();
  const composerText = useAssistantState(({ composer }) => composer.text);
  const composerIsEditing = useAssistantState(({ composer }) => composer.isEditing);
  const composerIsEmpty = useAssistantState(({ composer }) => composer.isEmpty);
  const isRunning = useThread((state) => state.isRunning);
  const threadMessages = useThread((state) => state.messages);

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

    const lastUserMessage = [...threadMessages].reverse().find((msg) => msg.role === 'user');
    if (!lastUserMessage || lastUserMessage.id === lastPersistedMessageIdRef.current) return;

    persistAttachments(currentSessionId, lastUserMessage.id, pending).then(() => {
      lastPersistedMessageIdRef.current = lastUserMessage.id;
      pendingAttachmentsRef.current = null;
      setUploadedFiles([]);
      setUploadError(null);
    });
  }, [currentSessionId, threadMessages, persistAttachments]);

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

  const handleUploadClick = useCallback(() => {
    if (!currentSessionId) {
      setUploadError('请先发送一条消息以创建会话，再上传文件。');
      return;
    }
    setUploadError(null);
    fileInputRef.current?.click();
  }, [currentSessionId]);

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
            mimeType: file.type,
            fileSize: file.size,
            status: 'uploaded',
          },
        ]));
        await api.composer().addAttachment(file);
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

  const canSend = composerIsEditing && !composerIsEmpty && !isRunning;

  const handleSend = useCallback((event?: FormEvent) => {
    if (event) {
      event.preventDefault();
    }
    if (!canSend || isRunning) return;
    const pendingAttachments = uploadedFiles
      .filter((file) => file.status === 'uploaded')
      .map((file) => ({
        originalName: file.name,
        filePath: file.path,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
      }));
    pendingAttachmentsRef.current = pendingAttachments.length > 0 ? pendingAttachments : null;
    // Notify parent before sending (for auto-collapse A2ComposerPanel)
    onSend?.();
    api.composer().send();
  }, [api, canSend, isRunning, uploadedFiles, onSend]);

  return (
    <ComposerPrimitive.Root
      data-composer-root="true"
      className="relative z-30 shrink-0 mx-auto flex w-full max-w-3xl flex-col overflow-visible rounded-2xl border border-transparent bg-card p-0.5 shadow-sm transition-shadow duration-200 focus-within:shadow-md hover:shadow"
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
          />
        )}
        <div className="relative z-10">
          <div className="wrap-break-word max-h-96 w-full overflow-y-auto">
            <ComposerPrimitive.Input
              placeholder="How can I help you today?"
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
              disabled={!currentSessionId || isUploading}
              title={!currentSessionId ? '请先创建会话再上传文件' : '上传文件到工作区'}
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
            {/* Model indicator - only show when not running */}
            {!isRunning && (
              <div
                className="flex h-8 min-w-16 items-center justify-center rounded-md px-2 text-xs text-muted-foreground"
                title="当前模型"
              >
                <span className="font-serif text-[14px] text-foreground">GLM 4.7</span>
              </div>
            )}

            {/* Workspace Toggle Button - only show when not running */}
            {!isRunning && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowWorkspace(!showWorkspace)}
                  className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="切换工作空间"
                  title="知识库 / 工作区"
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
            )}

            {/* Session Files Button - only show when not running */}
            {!isRunning && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSessionFiles(!showSessionFiles)}
                  className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="会话文件"
                  title="会话文件"
                  disabled={!currentSessionId}
                >
                  <FolderTree width={16} height={16} />
                </button>

                {/* Session Files Panel */}
                {showSessionFiles && currentSessionId && (
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-64 h-80 overflow-hidden rounded-lg border border-[#e5e4df] bg-white shadow-lg dark:border-[#3a3938] dark:bg-[#1f1e1b]">
                    <SessionFilesPanel
                      sessionId={currentSessionId}
                      onClose={() => setShowSessionFiles(false)}
                      onFileSelect={(path) => {
                        onSessionFileClick?.(path);
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Session Info Button - only show when not running */}
            {!isRunning && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSessionInfo(!showSessionInfo)}
                  className="flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg border bg-transparent px-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="查看会话信息"
                  title="会话信息"
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
            )}

            {/* Permission Badge - only show when not running */}
            {!isRunning && (
              <PermissionBadge permissionInfo={permissionInfo} />
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
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
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
                  className={`rounded-md border px-2 py-0.5 ${file.status === 'error' ? 'border-destructive text-destructive' : 'border-transparent bg-card text-foreground'}`}
                  title={file.error || file.path}
                >
                  {file.path}
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
