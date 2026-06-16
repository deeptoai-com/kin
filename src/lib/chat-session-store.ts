/**
 * Chat Session Store
 *
 * Manages message state for chat sessions, supporting:
 * - Loading historical messages from server
 * - Real-time streaming of new messages
 * - Session switching
 * - Usage/cost tracking
 * - Session metadata (tools, agents, configuration)
 */

import { create } from 'zustand';
import type { UsageData } from '~/components/claude-chat/usage-card';
import type { SessionMetadata } from '~/components/claude-chat/session-info-panel';
import type { InteractionMode } from '~/lib/permission-tier';

// Define our own message types that are compatible with @assistant-ui/react
export type TextContentPart = {
  readonly type: 'text';
  readonly text: string;
  readonly isIntermediate?: boolean;
  readonly isPending?: boolean;
  readonly turnId?: string;
  readonly parentToolUseId?: string | null;
};

export type ReasoningContentPart = {
  readonly type: 'reasoning';
  readonly text: string;
};

// Tool execution status (Craft-aligned)
// - executing: tool is currently running
// - completed: tool finished successfully
// - error: tool failed
// - backgrounded: tool is running in background (Bash with shell_id or Task with agentId)
export type ToolStatus = 'executing' | 'completed' | 'error' | 'backgrounded';

export type ToolCallContentPart = {
  readonly type: 'tool-call';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly argsText: string;
  readonly toolStatus?: ToolStatus;
  readonly result?: unknown;
  readonly isError?: boolean;
  // Backgrounded task fields (Craft-aligned)
  readonly backgroundTaskId?: string;  // For Task tool with agentId
  readonly backgroundShellId?: string; // For Bash tool with shell_id
  readonly intent?: string;            // Description/intent of the background task
  readonly command?: string;           // Command for Bash background task
  readonly elapsedSeconds?: number;    // From tool_progress events
};

export type ContentPart = TextContentPart | ReasoningContentPart | ToolCallContentPart;

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ThreadMessage {
  id: string;
  role: MessageRole;
  content: ContentPart[];
  createdAt?: Date;
  status?: {
    type: 'complete' | 'running' | 'requires-action' | 'incomplete';
    reason?: string;
  };
  // Monotonic sequence number of the last event that mutated this message
  // (from the worker, forwarded by the server). Used for deterministic ordering
  // robustness; the store otherwise trusts append/arrival order. See cowork spec §3.
  seq?: number;
  // Projects/branch: this message was inherited from a branch's SOURCE session (the
  // JSONL entry carries `forkedFrom`). It therefore belongs to the source owner, not
  // the current session owner — lets the thread show per-message author avatars
  // (distinguishing A's turns from B's in a 续聊即分支 thread). Undefined = own turn.
  isInherited?: boolean;
}

// SDK message type (from server)
type SDKContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean; isError?: boolean };

export type SDKMessage = {
  type: 'system' | 'assistant' | 'user' | 'result' | 'error';
  subtype?: string;
  uuid?: string;
  session_id?: string;
  // Present on JSONL entries copied from a branch's source session (SDK forkSession).
  // Its presence marks the message as belonging to the source owner. See ThreadMessage.isInherited.
  forkedFrom?: unknown;
  message?: {
    role?: string;
    content: SDKContentBlock[] | string;
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  // Result event fields for usage/cost tracking
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  modelUsage?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    costUSD: number;
  }>;
};

// Phase C preview runtime state — pushed by the preview backend over WS
// (`preview_state` event). Session-scoped; the selector filters by currentSessionId.
export type PreviewState = {
  sessionId: string;
  previewId: string;
  mode: 'static' | 'live';
  status: 'detecting' | 'installing' | 'building' | 'ready' | 'error' | 'stopped';
  url?: string;
  error?: string;
  // Set once the user shares the preview (Option A public-link toggle): the
  // preview bypasses the forward-auth gate and is pinned alive. `shareUrl` is
  // the bare, token-free link anyone can open.
  public?: boolean;
  shareUrl?: string;
};

// Ask-mode HITL: a pending tool-approval request, pushed by the worker over WS
// (`approval_request`). The user approves/rejects; the decision goes back to the
// worker's canUseTool. See docs/project/research/2026-06-ask-act-hitl-design.md.
export type ApprovalRequest = {
  toolUseID: string;
  toolName: string;
  title?: string | null;
  displayName?: string | null;
  description?: string | null;
  input?: Record<string, unknown>;
};

interface ChatSessionState {
  // Current session ID
  currentSessionId: string | null;

  // Messages for current session
  messages: ThreadMessage[];

  // Whether a query is in progress
  isRunning: boolean;

  // Fine-grained agent status for UI indicators
  agentStatus: 'idle' | 'thinking' | 'reasoning' | 'toolUse' | 'streaming';

  // Current tool being executed (if any)
  currentToolName: string | null;

  // Usage/cost data for current session
  usageData: UsageData | null;

  // Session metadata (tools, agents, configuration)
  sessionMetadata: SessionMetadata | null;

  // Phase C preview runtime state (session-scoped; null when no preview running)
  previewState: PreviewState | null;

  // Ask-mode HITL: tool-approval requests awaiting the user's decision.
  pendingApprovals: ApprovalRequest[];

  // Structured output from last query (for artifact metadata)
  lastStructuredOutput: unknown | null;

  // UI Settings: Whether to show thinking/reasoning blocks
  showThinking: boolean;

  // Queue count: number of pending runs waiting to be processed
  queueCount: number;

  // Concurrent sessions (FR4): server-authoritative set of THIS user's sessions
  // that currently have a running worker. Drives the sidebar "running" indicator.
  // Sourced from `list_running` (cross-tab/cross-refresh accurate) + kept fresh by
  // live lifecycle frames. Keyed by workspace sessionId (= a session's sdkSessionId
  // column / the id in the rail).
  runningSessionIds: string[];

  // Skills auto-enabled for current session (from templates)
  temporarySkills: string[];

  // Selected product permission tier (ephemeral, per-session UI choice).
  // Clamped to the org ceiling server-side; undefined → server uses org default.
  // Holds the interaction mode ('ask' | 'act'); field name kept for wire compat.
  selectedTier?: InteractionMode;

  // Selected model id for this conversation (multi-model). undefined → server uses
  // the configured default. Per-conversation UI choice, persisted per-session in
  // localStorage (PR8) and restored on session switch/resume.
  selectedModelId?: string;

  // Session KB scope (KB 面板勾选, prd 阶段3): kb_search restricts retrieval to these
  // knowledge bases for this conversation. Empty = all visible documents (default).
  selectedKbIds: string[];

  // Skill to arm once the NEXT (newly-created) session is ready. Used by the
  // A2Composer "open new chat & load" flow: the skill was just enabled (effective
  // next conversation per SDK constraint), so we arm it in the fresh session.
  pendingArmedSkill?: { slug: string; name?: string; hint?: string };

  // Project to bind the NEXT (newly-created) session to. Set by "new chat in
  // <project>" from the Projects surface; consumed by the chat route after the new
  // session is created (assignSessionToProject), then cleared.
  pendingProjectId?: string;

  // Actions
  setSessionId: (sessionId: string | null) => void;
  setMessages: (messages: ThreadMessage[]) => void;
  addMessage: (message: ThreadMessage) => void;
  updateLastMessage: (content: ContentPart[]) => void;
  // Patch a message in place by id (used by the live WS stream to grow the
  // current assistant message — single ordered source for left thread + workbench).
  updateMessageById: (
    id: string,
    update: { content?: ContentPart[]; status?: ThreadMessage['status']; seq?: number }
  ) => void;
  removeMessageById: (id: string) => void;
  setIsRunning: (isRunning: boolean) => void;
  setAgentStatus: (status: ChatSessionState['agentStatus']) => void;
  setCurrentToolName: (toolName: string | null) => void;
  setUsageData: (data: UsageData) => void;
  setSessionMetadata: (data: SessionMetadata) => void;
  setPreviewState: (state: PreviewState | null) => void;
  addPendingApproval: (req: ApprovalRequest) => void;
  resolvePendingApproval: (toolUseID: string) => void;
  setLastStructuredOutput: (data: unknown | null) => void;
  setShowThinking: (show: boolean) => void;
  setQueueCount: (count: number) => void;
  // Concurrent sessions (FR4): replace the running set (from list_running), or
  // nudge a single session in/out as live lifecycle frames arrive.
  setRunningSessionIds: (sessionIds: string[]) => void;
  addRunningSession: (sessionId: string) => void;
  removeRunningSession: (sessionId: string) => void;
  clearMessages: () => void;
  addTemporarySkill: (skillSlug: string) => void;
  clearTemporarySkills: () => void;
  setSelectedTier: (mode: InteractionMode | undefined) => void;
  setSelectedModelId: (id: string | undefined) => void;
  setSelectedKbIds: (ids: string[]) => void;
  setPendingArmedSkill: (skill: { slug: string; name?: string; hint?: string } | undefined) => void;
  setPendingProjectId: (projectId: string | undefined) => void;

  // Load historical messages from SDK format
  loadHistoricalMessages: (sdkMessages: SDKMessage[]) => void;
}

/**
 * Generate a unique message ID
 */
function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
          return (item as { text?: string }).text || '';
        }
        return JSON.stringify(item);
      })
      .join('\n');
  }
  return JSON.stringify(content, null, 2);
}

/**
 * Convert SDK message to ThreadMessage format
 */
function convertSDKMessage(sdkMessage: SDKMessage): ThreadMessage | null {
  const { type, message, uuid, forkedFrom } = sdkMessage;
  // forkedFrom present → this entry was copied from the branch's source session, so it
  // belongs to the source owner (used to pick the per-message author avatar).
  const isInherited = forkedFrom != null ? true : undefined;

  if (!message) return null;

  // Handle user messages
  if (type === 'user') {
    const content = message.content;

    // Handle tool_result - skip these as they're tool responses
    if (Array.isArray(content)) {
      const hasToolResult = content.some((b) => b.type === 'tool_result');
      if (hasToolResult) return null;

      // Handle text content in array
      const textContent = content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      if (!textContent) return null;

      return {
        id: uuid || generateId(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: textContent }],
        createdAt: new Date(),
        isInherited,
      };
    }

    // Handle string content
    if (typeof content === 'string') {
      return {
        id: uuid || generateId(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: content }],
        createdAt: new Date(),
        isInherited,
      };
    }
  }

  // Handle assistant messages
  if (type === 'assistant' && message.content) {
    const content = message.content;
    if (!Array.isArray(content)) return null;

    const parts: ContentPart[] = [];
    // Track tool calls to merge with results
    const toolCalls = new Map<string, ToolCallContentPart>();
    const hasToolUse = content.some((b) => b.type === 'tool_use');

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push({
          type: 'text',
          text: block.text,
          isIntermediate: hasToolUse ? true : false,
          isPending: false,
        });
      } else if (block.type === 'thinking' && block.thinking) {
        parts.push({ type: 'reasoning', text: block.thinking });
      } else if (block.type === 'tool_use') {
        const toolPart: ToolCallContentPart = {
          type: 'tool-call',
          toolCallId: block.id,
          toolName: block.name,
          args: block.input as Record<string, unknown>,
          argsText: JSON.stringify(block.input, null, 2),
          toolStatus: 'executing',
        };
        toolCalls.set(block.id, toolPart);
        parts.push(toolPart);
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        // Update the corresponding tool call with its result
        const existingTool = toolCalls.get(block.tool_use_id);
        if (existingTool) {
          const isError = Boolean(block.is_error ?? (block as { isError?: boolean }).isError);
          const resultContent = normalizeToolResultContent(block.content);
          const updatedPart: ToolCallContentPart = {
            ...existingTool,
            result: resultContent,
            isError,
          };
          toolCalls.set(block.tool_use_id, updatedPart);
          // Update in parts array
          const idx = parts.findIndex(
            (p) => p.type === 'tool-call' && p.toolCallId === block.tool_use_id
          );
          if (idx !== -1) {
            parts[idx] = updatedPart;
          }
        }
      }
    }

    if (parts.length === 0) return null;

    return {
      id: uuid || generateId(),
      role: 'assistant' as const,
      content: parts,
      createdAt: new Date(),
      status: { type: 'complete' as const, reason: 'stop' },
    };
  }

  return null;
}

/**
 * Resolve a tool-call part against its tool_result block: attach result text,
 * error flag, and backgrounded status (Task agentId / Bash shell_id). Shared by
 * the historical loader so resolved steps render identically to the live path.
 */
function resolveToolResult(
  targetPart: ToolCallContentPart,
  block: { content?: unknown; is_error?: boolean; isError?: boolean },
): ToolCallContentPart {
  const resultContent = normalizeToolResultContent(block.content);
  const isError = Boolean(block.is_error ?? (block as { isError?: boolean }).isError);
  const toolName = (targetPart.toolName || '').toLowerCase();
  const args = (targetPart.args || {}) as Record<string, unknown>;

  let toolStatus: ToolStatus = isError ? 'error' : 'completed';
  let backgroundTaskId: string | undefined;
  let backgroundShellId: string | undefined;
  let intent: string | undefined;
  let command: string | undefined;

  if (!isError && resultContent) {
    if (toolName === 'task') {
      const m = resultContent.match(/agentId:\s*([a-zA-Z0-9_-]+)/);
      if (m?.[1]) {
        toolStatus = 'backgrounded';
        backgroundTaskId = m[1];
        if (typeof args.description === 'string') intent = args.description;
        else if (typeof args._intent === 'string') intent = args._intent;
      }
    }
    if (toolName === 'bash') {
      const m = resultContent.match(/shell_id:\s*([a-zA-Z0-9_-]+)/)
        || resultContent.match(/"backgroundTaskId":\s*"([a-zA-Z0-9_-]+)"/);
      if (m?.[1]) {
        toolStatus = 'backgrounded';
        backgroundShellId = m[1];
        if (typeof args.command === 'string') command = args.command;
        if (typeof args.description === 'string') intent = args.description;
      }
    }
  }

  return {
    ...targetPart,
    result: resultContent,
    isError,
    toolStatus,
    ...(backgroundTaskId && { backgroundTaskId }),
    ...(backgroundShellId && { backgroundShellId }),
    ...(intent && { intent }),
    ...(command && { command }),
  };
}

// ── Per-conversation model preference (PR8) ───────────────────────────────────
// The selected model is a UI preference (the server re-validates + rejects on every
// send), so per CLAUDE.md's data-layering it lives in localStorage, keyed by
// sessionId — so switching/resuming a conversation restores its model, surviving
// reload. (Per-browser; a DB column would add cross-device sync — future upgrade.)
const MODEL_PREF_KEY = 'oxy:session-model';

function readModelPrefMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(MODEL_PREF_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function readModelPref(sessionId: string | null): string | undefined {
  if (!sessionId) return undefined;
  return readModelPrefMap()[sessionId];
}

function writeModelPref(sessionId: string | null, modelId: string | undefined): void {
  if (typeof window === 'undefined' || !sessionId) return;
  try {
    const map = readModelPrefMap();
    if (modelId) map[sessionId] = modelId;
    else delete map[sessionId];
    window.localStorage.setItem(MODEL_PREF_KEY, JSON.stringify(map));
  } catch {
    /* localStorage unavailable (private mode / quota) — preference is best-effort */
  }
}

export const useChatSessionStore = create<ChatSessionState>((set, get) => ({
  currentSessionId: null,
  messages: [],
  isRunning: false,
  agentStatus: 'idle',
  currentToolName: null,
  usageData: null,
  sessionMetadata: null,
  previewState: null,
  pendingApprovals: [],
  lastStructuredOutput: null,
  showThinking: true, // Default: show thinking/reasoning blocks
  queueCount: 0, // Number of pending runs waiting to be processed
  runningSessionIds: [], // Concurrent sessions (FR4): sessions with a live worker
  temporarySkills: [],
  selectedTier: 'act' as const, // default: 执行(Act) — full capability, sandbox is the guard
  selectedModelId: undefined,
  selectedKbIds: [],
  pendingArmedSkill: undefined,
  pendingProjectId: undefined,

  setSelectedTier: (selectedTier) => {
    set({ selectedTier });
  },

  setSelectedKbIds: (selectedKbIds: string[]) => {
    set({ selectedKbIds });
  },

  setPendingArmedSkill: (pendingArmedSkill) => {
    set({ pendingArmedSkill });
  },

  setPendingProjectId: (pendingProjectId) => {
    set({ pendingProjectId });
  },

  setSelectedModelId: (selectedModelId) => {
    set({ selectedModelId });
    writeModelPref(get().currentSessionId, selectedModelId);
  },

  setSessionId: (sessionId) => {
    // Restore this conversation's remembered model (undefined → server default).
    set({ currentSessionId: sessionId, selectedModelId: readModelPref(sessionId) });
  },

  setMessages: (messages) => {
    set({ messages });
  },

  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }));
  },

  updateLastMessage: (content) => {
    set((state) => {
      const messages = [...state.messages];
      if (messages.length > 0) {
        const lastIdx = messages.length - 1;
        messages[lastIdx] = {
          ...messages[lastIdx],
          content,
        };
      }
      return { messages };
    });
  },

  updateMessageById: (id, update) => {
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === id);
      if (idx === -1) return state;
      const messages = [...state.messages];
      messages[idx] = {
        ...messages[idx],
        ...(update.content !== undefined && { content: update.content }),
        ...(update.status !== undefined && { status: update.status }),
        ...(update.seq !== undefined && { seq: update.seq }),
      };
      return { messages };
    });
  },

  removeMessageById: (id) => {
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === id);
      if (idx === -1) return state;
      return { messages: state.messages.filter((m) => m.id !== id) };
    });
  },

  setIsRunning: (isRunning) => {
    // When stopping, also reset agent status
    if (!isRunning) {
      set({ isRunning, agentStatus: 'idle', currentToolName: null });
    } else {
      set({ isRunning, agentStatus: 'thinking' });
    }
  },

  setAgentStatus: (agentStatus) => {
    set({ agentStatus });
  },

  setCurrentToolName: (currentToolName) => {
    set({ currentToolName });
  },

  setUsageData: (data) => {
    set({ usageData: data });
  },

  setSessionMetadata: (data) => {
    set({ sessionMetadata: data });
  },

  setPreviewState: (data) => {
    set({ previewState: data });
  },

  addPendingApproval: (req) => {
    set((state) => {
      if (state.pendingApprovals.some((a) => a.toolUseID === req.toolUseID)) return state;
      return { pendingApprovals: [...state.pendingApprovals, req] };
    });
  },

  resolvePendingApproval: (toolUseID) => {
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.toolUseID !== toolUseID),
    }));
  },

  setLastStructuredOutput: (data) => {
    set({ lastStructuredOutput: data });
  },

  setShowThinking: (show) => {
    set({ showThinking: show });
  },

  setQueueCount: (count) => {
    set({ queueCount: count });
  },

  setRunningSessionIds: (sessionIds) => {
    set({ runningSessionIds: sessionIds });
  },

  addRunningSession: (sessionId) => {
    if (!sessionId) return;
    set((state) =>
      state.runningSessionIds.includes(sessionId)
        ? state
        : { runningSessionIds: [...state.runningSessionIds, sessionId] }
    );
  },

  removeRunningSession: (sessionId) => {
    if (!sessionId) return;
    set((state) =>
      state.runningSessionIds.includes(sessionId)
        ? { runningSessionIds: state.runningSessionIds.filter((id) => id !== sessionId) }
        : state
    );
  },

  clearMessages: () => {
    set({ messages: [], usageData: null, sessionMetadata: null, lastStructuredOutput: null });
  },

  addTemporarySkill: (skillSlug) => {
    set((state) => {
      if (state.temporarySkills.includes(skillSlug)) return state;
      return { temporarySkills: [...state.temporarySkills, skillSlug] };
    });
  },

  clearTemporarySkills: () => {
    set({ temporarySkills: [] });
  },

  loadHistoricalMessages: (sdkMessages) => {
    const converted: ThreadMessage[] = [];
    let lastUsageData: UsageData | null = null;

    // Coalesce a turn's many SDK messages into ONE store assistant message.
    // The SDK emits a separate `assistant` message per text/tool block and
    // delivers tool_results as interleaved `user` messages. Live runChat()
    // accumulates them into a single message; mirror that here so historical
    // and live render identically — one turn card + one deliverable per turn
    // instead of a fragmented stack of "步骤已完成" cards with duplicate artifacts.
    let cur: {
      id: string;
      createdAt: Date | undefined;
      status: ThreadMessage['status'];
      parts: ContentPart[];
    } | null = null;
    // toolCallId -> index of its tool-call part within cur.parts (for backfill)
    const toolIndex = new Map<string, number>();

    const flushAssistant = () => {
      if (cur && cur.parts.length > 0) {
        converted.push({
          id: cur.id,
          role: 'assistant',
          content: cur.parts,
          createdAt: cur.createdAt,
          status: cur.status,
        });
      }
      cur = null;
      toolIndex.clear();
    };

    for (const sdkMsg of sdkMessages) {
      // Usage from result events (does not contribute content).
      if (sdkMsg.type === 'result' && (sdkMsg.usage || sdkMsg.total_cost_usd)) {
        lastUsageData = {
          usage: sdkMsg.usage,
          total_cost_usd: sdkMsg.total_cost_usd,
          num_turns: sdkMsg.num_turns,
          duration_ms: sdkMsg.duration_ms,
          modelUsage: sdkMsg.modelUsage,
        };
        continue;
      }

      if (sdkMsg.type === 'user') {
        const content = sdkMsg.message?.content;
        const isToolResultOnly =
          Array.isArray(content) && content.some((b) => b.type === 'tool_result');

        if (isToolResultOnly) {
          // Backfill tool results into the in-progress assistant turn.
          if (cur && Array.isArray(content)) {
            for (const block of content) {
              if (block.type !== 'tool_result' || !block.tool_use_id) continue;
              const idx = toolIndex.get(block.tool_use_id);
              if (idx === undefined) continue;
              const part = cur.parts[idx];
              if (!part || part.type !== 'tool-call') continue;
              cur.parts[idx] = resolveToolResult(part, block);
            }
          }
          continue;
        }

        // A real user text message ends the previous turn and starts a new one.
        const userMsg = convertSDKMessage(sdkMsg);
        if (userMsg) {
          flushAssistant();
          converted.push(userMsg);
        }
        continue;
      }

      if (sdkMsg.type === 'assistant') {
        const msg = convertSDKMessage(sdkMsg);
        if (!msg || msg.role !== 'assistant') continue;
        if (!cur) {
          cur = {
            id: msg.id,
            createdAt: msg.createdAt,
            status: msg.status,
            parts: [],
          };
        }
        const base = cur.parts.length;
        cur.parts.push(...msg.content);
        msg.content.forEach((p, i) => {
          if (p.type === 'tool-call' && p.toolCallId) {
            toolIndex.set(p.toolCallId, base + i);
          }
        });
        continue;
      }
    }

    flushAssistant();

    console.log('[ChatSessionStore] Loaded', converted.length, 'coalesced turn message(s) from', sdkMessages.length, 'SDK messages');
    set({ messages: converted, usageData: lastUsageData });
  },
}));

// Export a singleton accessor for the WebSocket adapter
let messagesLoadedCallback: ((messages: SDKMessage[]) => void) | null = null;

export function onMessagesLoaded(callback: (messages: SDKMessage[]) => void): () => void {
  messagesLoadedCallback = callback;
  return () => {
    messagesLoadedCallback = null;
  };
}

export function notifyMessagesLoaded(messages: SDKMessage[]): void {
  if (messagesLoadedCallback) {
    messagesLoadedCallback(messages);
  }
}
