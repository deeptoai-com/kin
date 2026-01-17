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

// Define our own message types that are compatible with @assistant-ui/react
export type TextContentPart = {
  readonly type: 'text';
  readonly text: string;
};

export type ReasoningContentPart = {
  readonly type: 'reasoning';
  readonly text: string;
};

export type ToolCallContentPart = {
  readonly type: 'tool-call';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly argsText: string;
  readonly result?: unknown;
  readonly isError?: boolean;
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
  | { type: 'tool_result'; tool_use_id: string; content: unknown };

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
  clearMessages: () => void;

  // Load historical messages from SDK format
  loadHistoricalMessages: (sdkMessages: SDKMessage[]) => void;
}

/**
 * Generate a unique message ID
 */
function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'thinking' && block.thinking) {
        parts.push({ type: 'reasoning', text: block.thinking });
      } else if (block.type === 'tool_use') {
        const toolPart: ToolCallContentPart = {
          type: 'tool-call',
          toolCallId: block.id,
          toolName: block.name,
          args: block.input as Record<string, unknown>,
          argsText: JSON.stringify(block.input, null, 2),
        };
        toolCalls.set(block.id, toolPart);
        parts.push(toolPart);
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        // Update the corresponding tool call with its result
        const existingTool = toolCalls.get(block.tool_use_id);
        if (existingTool) {
          const updatedPart: ToolCallContentPart = {
            ...existingTool,
            result: block.content,
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

  clearMessages: () => {
    set({ messages: [], usageData: null, sessionMetadata: null, lastStructuredOutput: null });
  },

  loadHistoricalMessages: (sdkMessages) => {
    const converted: ThreadMessage[] = [];
    let lastUsageData: UsageData | null = null;

    for (const sdkMsg of sdkMessages) {
      const msg = convertSDKMessage(sdkMsg);
      if (msg) {
        converted.push(msg);
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

    console.log('[ChatSessionStore] Loaded', converted.length, 'historical messages from', sdkMessages.length, 'SDK messages');
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
