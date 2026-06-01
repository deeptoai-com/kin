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
import type { PermissionTier } from '~/lib/permission-tier';

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

  // Structured output from last query (for artifact metadata)
  lastStructuredOutput: unknown | null;

  // UI Settings: Whether to show thinking/reasoning blocks
  showThinking: boolean;

  // Queue count: number of pending runs waiting to be processed
  queueCount: number;

  // Skills auto-enabled for current session (from templates)
  temporarySkills: string[];

  // Selected product permission tier (ephemeral, per-session UI choice).
  // Clamped to the org ceiling server-side; undefined → server uses org default.
  selectedTier?: PermissionTier;

  // Actions
  setSessionId: (sessionId: string | null) => void;
  setMessages: (messages: ThreadMessage[]) => void;
  addMessage: (message: ThreadMessage) => void;
  updateLastMessage: (content: ContentPart[]) => void;
  setIsRunning: (isRunning: boolean) => void;
  setAgentStatus: (status: ChatSessionState['agentStatus']) => void;
  setCurrentToolName: (toolName: string | null) => void;
  setUsageData: (data: UsageData) => void;
  setSessionMetadata: (data: SessionMetadata) => void;
  setLastStructuredOutput: (data: unknown | null) => void;
  setShowThinking: (show: boolean) => void;
  setQueueCount: (count: number) => void;
  clearMessages: () => void;
  addTemporarySkill: (skillSlug: string) => void;
  clearTemporarySkills: () => void;
  setSelectedTier: (tier: PermissionTier | undefined) => void;

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
  const { type, message, uuid } = sdkMessage;

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
      };
    }

    // Handle string content
    if (typeof content === 'string') {
      return {
        id: uuid || generateId(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: content }],
        createdAt: new Date(),
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

export const useChatSessionStore = create<ChatSessionState>((set, get) => ({
  currentSessionId: null,
  messages: [],
  isRunning: false,
  agentStatus: 'idle',
  currentToolName: null,
  usageData: null,
  sessionMetadata: null,
  lastStructuredOutput: null,
  showThinking: true, // Default: show thinking/reasoning blocks
  queueCount: 0, // Number of pending runs waiting to be processed
  temporarySkills: [],
  selectedTier: 'act' as const, // default: 执行(Act) — full capability, sandbox is the guard

  setSelectedTier: (selectedTier) => {
    set({ selectedTier });
  },

  setSessionId: (sessionId) => {
    set({ currentSessionId: sessionId });
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

  setLastStructuredOutput: (data) => {
    set({ lastStructuredOutput: data });
  },

  setShowThinking: (show) => {
    set({ showThinking: show });
  },

  setQueueCount: (count) => {
    set({ queueCount: count });
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

    // Track tool_use positions for cross-message tool_result backfill
    // Map: tool_use_id -> { messageIndex, partIndex, toolName, args }
    const toolUseRegistry = new Map<string, {
      messageIndex: number;
      partIndex: number;
      toolName: string;
      args: Record<string, unknown>;
    }>();

    // First pass: convert messages and register tool_use positions
    for (const sdkMsg of sdkMessages) {
      const msg = convertSDKMessage(sdkMsg);
      if (msg) {
        const messageIndex = converted.length;
        converted.push(msg);

        // Register tool_use positions for assistant messages
        if (msg.role === 'assistant') {
          msg.content.forEach((part, partIndex) => {
            if (part.type === 'tool-call' && part.toolCallId) {
              toolUseRegistry.set(part.toolCallId, {
                messageIndex,
                partIndex,
                toolName: part.toolName,
                args: part.args,
              });
            }
          });
        }
      }

      // Extract usage data from result events
      if (sdkMsg.type === 'result' && (sdkMsg.usage || sdkMsg.total_cost_usd)) {
        lastUsageData = {
          usage: sdkMsg.usage,
          total_cost_usd: sdkMsg.total_cost_usd,
          num_turns: sdkMsg.num_turns,
          duration_ms: sdkMsg.duration_ms,
          modelUsage: sdkMsg.modelUsage,
        };
      }
    }

    // Second pass: backfill tool_result from user messages
    // SDK sends tool_result as user messages with tool_result content blocks
    for (const sdkMsg of sdkMessages) {
      if (sdkMsg.type !== 'user' || !sdkMsg.message?.content) continue;

      const content = sdkMsg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue;

        const registration = toolUseRegistry.get(block.tool_use_id);
        if (!registration) continue;

        const { messageIndex, partIndex, toolName, args } = registration;
        const targetMessage = converted[messageIndex];
        if (!targetMessage || targetMessage.role !== 'assistant') continue;

        const targetPart = targetMessage.content[partIndex];
        if (!targetPart || targetPart.type !== 'tool-call') continue;

        // Determine result content and error status
        const resultContent = normalizeToolResultContent(block.content);
        const isError = Boolean(block.is_error ?? (block as { isError?: boolean }).isError);

        // Detect backgrounded status (same logic as ws-adapter.ts)
        let toolStatus: ToolStatus = isError ? 'error' : 'completed';
        let backgroundTaskId: string | undefined;
        let backgroundShellId: string | undefined;
        let intent: string | undefined;
        let command: string | undefined;

        if (!isError && resultContent) {
          // Task tool: detect agentId in result
          if (toolName.toLowerCase() === 'task') {
            const agentIdMatch = resultContent.match(/agentId:\s*([a-zA-Z0-9_-]+)/);
            if (agentIdMatch?.[1]) {
              toolStatus = 'backgrounded';
              backgroundTaskId = agentIdMatch[1];
              // Extract intent from args
              if (typeof args.description === 'string') {
                intent = args.description;
              } else if (typeof args._intent === 'string') {
                intent = args._intent;
              }
            }
          }

          // Bash tool: detect shell_id or backgroundTaskId in result
          if (toolName.toLowerCase() === 'bash') {
            const shellIdMatch = resultContent.match(/shell_id:\s*([a-zA-Z0-9_-]+)/)
              || resultContent.match(/"backgroundTaskId":\s*"([a-zA-Z0-9_-]+)"/);
            if (shellIdMatch?.[1]) {
              toolStatus = 'backgrounded';
              backgroundShellId = shellIdMatch[1];
              // Extract command and intent from args
              if (typeof args.command === 'string') {
                command = args.command;
              }
              if (typeof args.description === 'string') {
                intent = args.description;
              }
            }
          }
        }

        // Update the tool-call part with result and status
        const updatedPart: ToolCallContentPart = {
          ...targetPart,
          result: resultContent,
          isError,
          toolStatus,
          ...(backgroundTaskId && { backgroundTaskId }),
          ...(backgroundShellId && { backgroundShellId }),
          ...(intent && { intent }),
          ...(command && { command }),
        };

        // Replace the part in the message (need to create new array for immutability)
        const updatedContent = [...targetMessage.content];
        updatedContent[partIndex] = updatedPart;
        converted[messageIndex] = {
          ...targetMessage,
          content: updatedContent,
        };
      }
    }

    console.log('[ChatSessionStore] Loaded', converted.length, 'historical messages from', sdkMessages.length, 'SDK messages, with', toolUseRegistry.size, 'tool calls registered');
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
