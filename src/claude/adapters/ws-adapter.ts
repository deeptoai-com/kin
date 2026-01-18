/**
 * Claude Agent WebSocket Adapter
 *
 * Implements ChatModelAdapter for Assistant UI, using WebSocket instead of SSE
 * for more reliable real-time communication with Claude Agent SDK.
 *
 * Architecture:
 * - Persistent WebSocket connection to /ws/agent
 * - Automatic reconnection on disconnect
 * - Same event transformation as SSE adapter (SDK events -> Assistant UI format)
 */

import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult } from '@assistant-ui/react';
import { notifyMessagesLoaded, useChatSessionStore, type SDKMessage as StorageSDKMessage } from '~/lib/chat-session-store';
import type { SessionMetadata } from '~/components/claude-chat/session-info-panel';

// SDK Message Types (matching what WebSocket server sends)
type SDKContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown };

// MCP Server status from SDK system.init event
type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'pending';
  error?: string;
  tool_count?: number;
};

// Local SDKMessage type for this adapter (content is always an array from streaming)
type SDKMessage = {
  type: 'system' | 'assistant' | 'user' | 'result' | 'error' | 'stream_event';
  subtype?: string;
  uuid?: string;
  session_id?: string;
  message?: {
    content: SDKContentBlock[];
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
  // System.init event fields for session metadata
  model?: string;
  skills?: string[];
  mcp_servers?: string[] | McpServerStatus[];
  agents?: string[];
  tools?: string[];
  slash_commands?: string[];
  cwd?: string;
  // Structured Outputs field (from outputFormat)
  structured_output?: unknown;
  // Stream event fields (from includePartialMessages)
  event?: StreamEvent;
};

// Stream event types (from Anthropic SDK RawMessageStreamEvent)
type StreamEvent = {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_start' | 'message_delta' | 'message_stop';
  index?: number;
  content_block?: {
    type: string;
    name?: string;
    id?: string;
  };
  delta?: {
    type: string;
    text?: string;
    thinking?: string;
  };
};

// WebSocket message types (matching ws-server.ts)
type InboundMessage =
  | { type: 'chat'; content: string; sessionId?: string }
  | { type: 'resume'; sessionId: string }
  | { type: 'abort' }
  | { type: 'ping' };

type OutboundMessage =
  | { type: 'session_init'; sessionId: string; userId?: string }
  | { type: 'message'; event: SDKMessage }
  | { type: 'messages_loaded'; messages: StorageSDKMessage[] }
  | { type: 'error'; code: string; message: string; retriable: boolean }
  | { type: 'done' }
  | { type: 'aborted' }
  | { type: 'pong' };

// Assistant UI Part Types
type TextPart = {
  readonly type: 'text';
  readonly text: string;
};

type ReasoningPart = {
  readonly type: 'reasoning';
  readonly text: string;
};

type ToolCallPart = {
  readonly type: 'tool-call';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly argsText: string;
  readonly result?: unknown;
  readonly isError?: boolean;
};

type ContentPart = TextPart | ReasoningPart | ToolCallPart;

// WebSocket connection state
let ws: WebSocket | null = null;
let currentSessionId: string | undefined;
let currentUserId: string | undefined;  // Current user ID for Skills isolation
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1000;

// Track if a query is currently running (set when chat message sent, cleared on done/error)
let isQueryRunning = false;

// Track pending chat request at WebSocket level (more reliable than generator state)
let hasPendingChat = false;

// Message queue for handling responses
type MessageHandler = (msg: OutboundMessage) => void;
let messageHandler: MessageHandler | null = null;

// Session init callback for notifying route when session changes
let sessionInitCallback: ((sessionId: string) => void) | null = null;

export function onSessionInit(callback: (sessionId: string) => void): () => void {
  sessionInitCallback = callback;
  return () => {
    sessionInitCallback = null;
  };
}

function notifySessionInit(sessionId: string): void {
  if (sessionInitCallback) {
    sessionInitCallback(sessionId);
  }
}

export function getSessionId(): string | undefined {
  return currentSessionId;
}

export function setSessionId(id: string | undefined): void {
  currentSessionId = id;
}

export function clearSession(): void {
  currentSessionId = undefined;
}

/**
 * Check if a query is currently running
 * Uses multiple indicators for reliability:
 * - hasPendingChat flag (set when chat message sent via WebSocket)
 * - isQueryRunning flag (set at start of run())
 * - messageHandler existence (set during active message processing)
 */
export function checkIsQueryRunning(): boolean {
  const running = hasPendingChat || isQueryRunning || messageHandler !== null;
  console.log('[WS Adapter] checkIsQueryRunning:', running, { hasPendingChat, isQueryRunning, hasMessageHandler: messageHandler !== null });
  return running;
}

/**
 * Get WebSocket URL
 * In development, connects to the same host on /ws/agent
 * In production, can be configured via VITE_WS_URL environment variable
 */
function getWebSocketUrl(): string {
  // Check for explicit WebSocket URL (e.g., for sidecar deployment)
  const configuredUrl = (import.meta.env?.VITE_WS_URL as string | undefined);
  if (configuredUrl) {
    return configuredUrl;
  }

  // Default: same host, /ws/agent path
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/agent`;
}

/**
 * Get or create WebSocket connection
 */
function getWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve(ws);
      return;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener('open', () => resolve(ws!), { once: true });
      ws.addEventListener('error', reject, { once: true });
      return;
    }

    // Create new connection
    const url = getWebSocketUrl();

    console.log('[WS Adapter] Connecting to', url);
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[WS Adapter] Connected');
      reconnectAttempts = 0;
      resolve(ws!);
    };

    ws.onerror = (event) => {
      console.error('[WS Adapter] Connection error:', event);
      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = (event) => {
      console.log('[WS Adapter] Disconnected:', event.code, event.reason);
      ws = null;

      // Dispatch disconnection event for session protection
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ws-disconnected'));
      }

      // Auto-reconnect if not intentionally closed
      if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`[WS Adapter] Reconnecting (attempt ${reconnectAttempts})...`);
        setTimeout(() => {
          getWebSocket()
            .then(() => {
              // Dispatch reconnection event for session protection
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('ws-reconnected'));
              }
            })
            .catch(() => {});
        }, RECONNECT_DELAY_MS * reconnectAttempts);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as OutboundMessage;

        // Handle session init
        if (msg.type === 'session_init') {
          currentSessionId = msg.sessionId;
          if (msg.userId) {
            currentUserId = msg.userId;
            console.log('[WS Adapter] Session initialized:', msg.sessionId, 'User:', msg.userId);
          } else {
            console.log('[WS Adapter] Session initialized:', msg.sessionId);
          }
          // Notify route about session change so it can update its state
          notifySessionInit(msg.sessionId);
        }

        // Handle messages loaded (historical messages for resume)
        if (msg.type === 'messages_loaded') {
          console.log('[WS Adapter] Received', msg.messages.length, 'historical messages');
          notifyMessagesLoaded(msg.messages);
        }

        // Forward to current handler
        if (messageHandler) {
          messageHandler(msg);
        }
      } catch (error) {
        console.error('[WS Adapter] Message parse error:', error);
      }
    };
  });
}

/**
 * Send message via WebSocket
 */
async function send(message: InboundMessage): Promise<void> {
  const socket = await getWebSocket();
  socket.send(JSON.stringify(message));
}

/**
 * Abort current operation
 */
export async function abort(): Promise<void> {
  console.log('[WS Adapter] ⚠️ ABORT CALLED - Stack trace:', new Error().stack);
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[WS Adapter] Sending abort message to server');
    ws.send(JSON.stringify({ type: 'abort' }));
  } else {
    console.log('[WS Adapter] WebSocket not open, cannot send abort');
  }
}

/**
 * Resume a previous session
 * Sends resume message to server and updates current session ID
 */
export async function resumeSession(sessionId: string): Promise<void> {
  console.log('[WS Adapter] Resuming session:', sessionId);
  currentSessionId = sessionId;
  await send({ type: 'resume', sessionId });
}

/**
 * Start a new session
 * Clears the current session ID so next message creates a new session
 */
export function newSession(): void {
  console.log('[WS Adapter] Starting new session');
  currentSessionId = undefined;
}

/**
 * Close WebSocket connection
 */
export function disconnect(): void {
  if (ws) {
    ws.close(1000, 'User disconnect');
    ws = null;
  }
}

/**
 * Claude Agent WebSocket Adapter for Assistant UI
 */
export const ClaudeAgentWSAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, runConfig }: ChatModelRunOptions) {
    console.log('[WS Adapter] run() called with', messages.length, 'messages');

    // Mark query as running and sync to store (sets agentStatus to 'thinking')
    isQueryRunning = true;
    useChatSessionStore.getState().setIsRunning(true);

    // 1. Extract the latest user message
    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('No user message to process');
    }

    const textParts = lastMessage.content.filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text'
    );
    const prompt = textParts.map((p) => p.text).join('\n');

    if (!prompt.trim()) {
      throw new Error('Empty prompt');
    }

    // 2. Create message queue for async iteration
    const messageQueue: OutboundMessage[] = [];
    let resolveNext: (() => void) | null = null;
    let isComplete = false;
    let error: Error | null = null;
    let isAborted = false;

    // 3. Set up abort handler
    const abortHandler = () => {
      isAborted = true;
      abort();
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };
    abortSignal?.addEventListener('abort', abortHandler);

    messageHandler = (msg: OutboundMessage) => {
      messageQueue.push(msg);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    // Note: thinkingMode is no longer sent to server - SDK's claude_code preset handles this automatically
    // The showThinking toggle in UI only controls whether to display received reasoning content

    // 4. Send chat message
    try {
      console.log('[WS Adapter] Sending chat message:', { type: 'chat', content: prompt.substring(0, 50), sessionId: currentSessionId });
      console.log('[WS Adapter] Full prompt length:', prompt.length);
      // Set pending flag BEFORE sending so switch detection works immediately
      hasPendingChat = true;
      await send({
        type: 'chat',
        content: prompt,
        sessionId: currentSessionId,
      });
      console.log('[WS Adapter] ✅ Message sent successfully');
    } catch (connectError) {
      hasPendingChat = false;
      console.error('[WS Adapter] ❌ Failed to send message:', connectError);
      throw new Error('Failed to connect to WebSocket server');
    }

    // 5. Process messages
    const content: ContentPart[] = [];
    const toolCalls = new Map<string, ToolCallPart>();

    // Track accumulated text length for proper streaming
    let accumulatedTextLength = 0;

    // Streaming throttle: buffer text updates to reduce render frequency
    const STREAMING_THROTTLE_MS = 100;
    let lastTextYieldTime = 0;
    let pendingTextYield = false;

    try {
      while (!isComplete && !error) {
        if (isAborted) {
          break;
        }
        // Wait for next message
        if (messageQueue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }

        if (isAborted) {
          break;
        }
        const msg = messageQueue.shift();
        if (!msg) continue;

        console.log('[WS Adapter] Processing message type:', msg.type);

        switch (msg.type) {
          case 'session_init':
            currentSessionId = msg.sessionId;
            break;

          case 'message':
            const event = msg.event;

            switch (event.type) {
              case 'system':
                // Save session metadata from system.init event
                if (event.subtype === 'init') {
                  const metadata: SessionMetadata = {
                    session_id: event.session_id || currentSessionId || '',
                    user_id: currentUserId || '',  // Use current user ID for Skills isolation
                    model: event.model || 'unknown',
                    skills: event.skills || [],
                    mcp_servers: event.mcp_servers || [],
                    agents: event.agents || [],
                    tools: event.tools || [],
                    slash_commands: event.slash_commands || [],
                    cwd: event.cwd || '',
                  };
                  useChatSessionStore.getState().setSessionMetadata(metadata);
                  console.log('[WS Adapter] Saved session metadata:', metadata);
                }
                // Note: We don't update currentSessionId here because we use
                // our workspaceSessionId (from session_init), not the SDK's session_id
                break;

              case 'assistant':
                if (event.message?.content) {
                  // Track what types of content changed
                  let hasTextChange = false;
                  let hasNonTextChange = false;

                  for (const block of event.message.content) {
                    switch (block.type) {
                      case 'text':
                        if (block.text) {
                          // Check if this is new text content
                          const newTextLength = block.text.length;
                          if (newTextLength > accumulatedTextLength) {
                            // We have new text to add
                            accumulatedTextLength = newTextLength;
                            hasTextChange = true;
                          }

                          // Update agent status to streaming when text is coming in
                          useChatSessionStore.getState().setAgentStatus('streaming');

                          // Always update the text part with the full accumulated text
                          let existingText = content.find(
                            (p): p is TextPart => p.type === 'text'
                          );
                          if (existingText) {
                            const index = content.indexOf(existingText);
                            content[index] = { type: 'text', text: block.text };
                          } else {
                            content.push({ type: 'text', text: block.text });
                          }
                        }
                        break;

                      case 'thinking':
                        if (block.thinking) {
                          content.push({
                            type: 'reasoning',
                            text: block.thinking,
                          });
                          hasNonTextChange = true;
                          // Update agent status to reasoning
                          useChatSessionStore.getState().setAgentStatus('reasoning');
                        }
                        break;

                      case 'tool_use':
                        if (block.id && block.name) {
                          // Update agent status to toolUse and set current tool name
                          useChatSessionStore.getState().setAgentStatus('toolUse');
                          useChatSessionStore.getState().setCurrentToolName(block.name);
                          // Ensure args is always a plain object (never array or primitive)
                          let safeArgs: Record<string, unknown>;
                          const inputType = block.input == null ? 'null' : Array.isArray(block.input) ? 'array' : typeof block.input;
                          console.log(`[WS Adapter] tool_use: ${block.name}, input type: ${inputType}`, block.input);

                          if (block.input == null) {
                            safeArgs = {};
                          } else if (Array.isArray(block.input)) {
                            // If input is an array, wrap it in an object
                            safeArgs = { items: block.input };
                            console.warn('[WS Adapter] Wrapped array input for tool:', block.name);
                          } else if (typeof block.input === 'object') {
                            safeArgs = block.input as Record<string, unknown>;
                          } else {
                            // If input is a primitive, wrap it
                            safeArgs = { value: block.input };
                            console.warn('[WS Adapter] Wrapped primitive input for tool:', block.name);
                          }

                          const toolPart: ToolCallPart = {
                            type: 'tool-call',
                            toolCallId: block.id,
                            toolName: block.name,
                            args: safeArgs,
                            argsText: JSON.stringify(block.input ?? {}),
                          };

                          console.log('[WS Adapter] Created toolPart:', { type: toolPart.type, toolName: toolPart.toolName, argsType: typeof toolPart.args, argsIsArray: Array.isArray(toolPart.args) });

                          toolCalls.set(block.id, toolPart);
                          content.push(toolPart);
                          hasNonTextChange = true;
                        }
                        break;
                    }
                  }

                  // Throttled yield logic:
                  // - Non-text changes (tool calls, thinking) always yield immediately
                  // - Text-only changes are throttled to reduce render frequency
                  const now = Date.now();

                  if (hasNonTextChange) {
                    // Important event: yield immediately and flush any pending text
                    pendingTextYield = false;
                    lastTextYieldTime = now;
                    yield {
                      content: [...content] as ChatModelRunResult['content'],
                      status: { type: 'running' },
                    } satisfies ChatModelRunResult;
                  } else if (hasTextChange) {
                    // Text-only change: check throttle
                    const timeSinceLastYield = now - lastTextYieldTime;

                    if (timeSinceLastYield >= STREAMING_THROTTLE_MS) {
                      // Enough time has passed, yield now
                      pendingTextYield = false;
                      lastTextYieldTime = now;
                      yield {
                        content: [...content] as ChatModelRunResult['content'],
                        status: { type: 'running' },
                      } satisfies ChatModelRunResult;
                    } else {
                      // Mark as pending, will be flushed later
                      pendingTextYield = true;
                    }
                  }
                }
                break;

              case 'user':
                if (event.message?.content) {
                  for (const block of event.message.content) {
                    if (block.type === 'tool_result' && block.tool_use_id) {
                      const toolPart = toolCalls.get(block.tool_use_id);
                      if (toolPart) {
                        // Clear current tool name after result is received
                        useChatSessionStore.getState().setCurrentToolName(null);
                        useChatSessionStore.getState().setAgentStatus('thinking');

                        // Normalize block.content to a safe string format
                        // block.content can be: string | array | object
                        let resultContent: string;
                        if (typeof block.content === 'string') {
                          resultContent = block.content;
                        } else if (Array.isArray(block.content)) {
                          // Extract text from content blocks
                          resultContent = block.content
                            .map((item: any) => {
                              if (typeof item === 'string') return item;
                              if (item?.type === 'text') return item.text || '';
                              return JSON.stringify(item);
                            })
                            .join('\n');
                        } else {
                          // Object or other type - stringify it
                          resultContent = JSON.stringify(block.content, null, 2);
                        }

                        const updatedPart: ToolCallPart = {
                          ...toolPart,
                          result: resultContent,
                          isError: false,
                        };
                        toolCalls.set(block.tool_use_id, updatedPart);

                        const index = content.findIndex(
                          (p) =>
                            p.type === 'tool-call' &&
                            p.toolCallId === block.tool_use_id
                        );
                        if (index !== -1) {
                          content[index] = updatedPart;
                        }
                      }
                    }
                  }

                  yield {
                    content: [...content] as ChatModelRunResult['content'],
                    status: { type: 'running' },
                  } satisfies ChatModelRunResult;
                }
                break;

              case 'result':
                // Extract and save usage data if available
                if (event.usage || event.total_cost_usd) {
                  const usageData = {
                    usage: event.usage,
                    total_cost_usd: event.total_cost_usd,
                    num_turns: event.num_turns,
                    duration_ms: event.duration_ms,
                    modelUsage: event.modelUsage,
                  };
                  useChatSessionStore.getState().setUsageData(usageData);
                  console.log('[WS Adapter] Saved usage data:', usageData);
                }

                // Extract and save structured output if available
                if (event.structured_output) {
                  useChatSessionStore.getState().setLastStructuredOutput(event.structured_output);
                  console.log('[WS Adapter] Saved structured output:', event.structured_output);
                }

                if (event.is_error || event.subtype?.startsWith('error')) {
                  error = new Error(event.result || 'Agent execution failed');
                }
                // Treat the result event as the end of the run in case "done" is missing.
                isComplete = true;
                break;

              case 'error':
                error = new Error(event.error || 'Unknown error');
                break;

              case 'stream_event':
                // Handle streaming partial messages (enabled via includePartialMessages: true)
                // event.event contains the raw Anthropic stream event
                if (event.event) {
                  const streamEvent = event.event;

                  switch (streamEvent.type) {
                    case 'content_block_start':
                      // A new content block is starting
                      if (streamEvent.content_block?.type === 'thinking') {
                        useChatSessionStore.getState().setAgentStatus('reasoning');
                      } else if (streamEvent.content_block?.type === 'tool_use') {
                        useChatSessionStore.getState().setAgentStatus('toolUse');
                        useChatSessionStore.getState().setCurrentToolName(streamEvent.content_block.name || 'tool');
                      } else if (streamEvent.content_block?.type === 'text') {
                        useChatSessionStore.getState().setAgentStatus('streaming');
                      }
                      break;

                    case 'content_block_delta':
                      // Incremental content update
                      if (streamEvent.delta?.type === 'text_delta' && streamEvent.delta.text) {
                        // Accumulate text delta
                        let existingText = content.find(
                          (p): p is TextPart => p.type === 'text'
                        );
                        if (existingText) {
                          const index = content.indexOf(existingText);
                          content[index] = { type: 'text', text: existingText.text + streamEvent.delta.text };
                        } else {
                          content.push({ type: 'text', text: streamEvent.delta.text });
                        }

                        // Throttled yield for text streaming
                        const now = Date.now();
                        if (now - lastTextYieldTime >= STREAMING_THROTTLE_MS) {
                          lastTextYieldTime = now;
                          yield {
                            content: [...content] as ChatModelRunResult['content'],
                            status: { type: 'running' },
                          } satisfies ChatModelRunResult;
                        } else {
                          pendingTextYield = true;
                        }
                      } else if (streamEvent.delta?.type === 'thinking_delta' && streamEvent.delta.thinking) {
                        // Accumulate thinking delta
                        let existingReasoning = content.find(
                          (p): p is ReasoningPart => p.type === 'reasoning'
                        );
                        if (existingReasoning) {
                          const index = content.indexOf(existingReasoning);
                          content[index] = { type: 'reasoning', text: existingReasoning.text + streamEvent.delta.thinking };
                        } else {
                          content.push({ type: 'reasoning', text: streamEvent.delta.thinking });
                        }

                        // Yield immediately for reasoning updates
                        yield {
                          content: [...content] as ChatModelRunResult['content'],
                          status: { type: 'running' },
                        } satisfies ChatModelRunResult;
                      }
                      break;

                    case 'content_block_stop':
                      // Content block finished - flush any pending content
                      if (pendingTextYield) {
                        pendingTextYield = false;
                        yield {
                          content: [...content] as ChatModelRunResult['content'],
                          status: { type: 'running' },
                        } satisfies ChatModelRunResult;
                      }
                      break;

                    case 'message_start':
                      // Message starting
                      useChatSessionStore.getState().setAgentStatus('thinking');
                      break;

                    case 'message_delta':
                      // Message state change (e.g., stop_reason)
                      break;

                    case 'message_stop':
                      // Message complete
                      break;
                  }
                }
                break;
            }
            break;

          case 'error':
            console.error('[WS Adapter] ❌ Received error message:', msg.message);
            error = new Error(msg.message || 'Unknown error');
            break;

          case 'done':
            console.log('[WS Adapter] ✅ Received done message');
            isComplete = true;
            break;

          case 'aborted':
            console.log('[WS Adapter] ⛔ Received aborted message');
            isAborted = true;
            isComplete = true;
            break;
        }
      }

      // Flush any pending text content before completion
      if (pendingTextYield && content.length > 0) {
        yield {
          content: [...content] as ChatModelRunResult['content'],
          status: { type: 'running' },
        } satisfies ChatModelRunResult;
      }

      if (error) {
        throw error;
      }
    } finally {
      abortSignal?.removeEventListener('abort', abortHandler);
      messageHandler = null;
      isQueryRunning = false;
      hasPendingChat = false;
      // Sync to store - this also resets agentStatus to 'idle' and currentToolName to null
      useChatSessionStore.getState().setIsRunning(false);
    }

    if (isAborted) {
      // Include any content that was already generated before the abort
      yield {
        content: (content.length > 0 ? content : [{ type: 'text', text: '' }]) as ChatModelRunResult['content'],
        status: { type: 'incomplete', reason: 'cancelled' },
      } satisfies ChatModelRunResult;
      return;
    }

    // 6. Yield final result
    yield {
      content: (content.length > 0 ? content : [{ type: 'text', text: '' }]) as ChatModelRunResult['content'],
      status: { type: 'complete', reason: 'stop' },
    } satisfies ChatModelRunResult;
  },
};

export default ClaudeAgentWSAdapter;
