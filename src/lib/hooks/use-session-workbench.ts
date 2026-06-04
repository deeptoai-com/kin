/**
 * Workbench selectors — Phase 3 Wave 1.
 *
 * Derives the right-side workbench's live data from the chat session store.
 * The store only ever holds the CURRENT session's messages (it is replaced on
 * session switch), so everything here is inherently scoped to the active
 * session — no cross-session bleed. Server-side user scoping is enforced when
 * messages are loaded; this layer adds no new data access.
 */

import { useMemo } from 'react';
import { useChatSessionStore, type ThreadMessage } from '~/lib/chat-session-store';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  /** Present-tense form Claude Code emits (e.g. "Reading file"); optional. */
  activeForm?: string;
}

export interface TodoSummary {
  todos: TodoItem[];
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

const VALID_STATUS: Record<string, TodoStatus> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'completed',
};

function coerceTodos(raw: unknown): TodoItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: TodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const content = typeof e.content === 'string' ? e.content : '';
    if (!content) continue;
    const status = VALID_STATUS[String(e.status)] ?? 'pending';
    const activeForm = typeof e.activeForm === 'string' ? e.activeForm : undefined;
    items.push({ content, status, activeForm });
  }
  return items.length > 0 ? items : null;
}

/**
 * The most recent TodoWrite call's list in the current session. TodoWrite is
 * called repeatedly with the full updated list, so the latest call IS the
 * current plan. Returns null when the agent hasn't produced a plan yet.
 */
export function selectLatestTodos(messages: ThreadMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].content;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (part.type === 'tool-call' && part.toolName?.toLowerCase() === 'todowrite') {
        const todos = coerceTodos((part.args as Record<string, unknown> | undefined)?.todos);
        if (todos) return todos;
      }
    }
  }
  return null;
}

export function useSessionTodos(): TodoSummary | null {
  const messages = useChatSessionStore((s) => s.messages);
  return useMemo(() => {
    const todos = selectLatestTodos(messages);
    if (!todos) return null;
    return {
      todos,
      total: todos.length,
      completed: todos.filter((t) => t.status === 'completed').length,
      inProgress: todos.filter((t) => t.status === 'in_progress').length,
      pending: todos.filter((t) => t.status === 'pending').length,
    };
  }, [messages]);
}

// ───────────────────────── ② Sub-agents ─────────────────────────

export type SubAgentStatus = 'running' | 'completed' | 'error';

export interface SubAgentItem {
  id: string;
  /** Claude Code Task tool's subagent_type, when provided. */
  subagentType?: string;
  /** Human description / intent of the delegated work. */
  description: string;
  status: SubAgentStatus;
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Sub-agent invocations in the current session, in call order. Each Claude Code
 * `Task` tool-call is one delegated sub-agent. Flat list (Wave 1); a nested tree
 * of the sub-agent's own child tool calls needs the adapter to persist
 * parent_tool_use_id onto tool-call parts (follow-up).
 */
export function selectSubAgents(messages: ThreadMessage[]): SubAgentItem[] {
  const out: SubAgentItem[] = [];
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.toolName?.toLowerCase() !== 'task') continue;
      const args = (part.args ?? {}) as Record<string, unknown>;
      // Error wins over any other status — never show a failed delegation as "Done".
      const status: SubAgentStatus =
        part.toolStatus === 'error' || part.isError
          ? 'error'
          : part.toolStatus === 'completed'
            ? 'completed'
            : 'running';
      out.push({
        id: part.toolCallId,
        subagentType: readString(args.subagent_type),
        description:
          readString(args.description) ??
          readString(part.intent) ??
          readString((args as { _intent?: unknown })._intent) ??
          'Sub-agent task',
        status,
      });
    }
  }
  return out;
}

export function useSessionSubAgents(): SubAgentItem[] {
  const messages = useChatSessionStore((s) => s.messages);
  return useMemo(() => selectSubAgents(messages), [messages]);
}

// ───────────────────────── ③ Files ─────────────────────────

export interface SessionFile {
  path: string;
  fileName: string;
  /** The tool that last touched it (Write / Edit / …). */
  tool: string;
}

const FILE_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit']);

/**
 * Files the agent produced/edited in this session's workspace, derived from
 * Write/Edit tool-calls (latest touch wins, de-duped by path, in first-seen
 * order). Store-only (no server round-trip) — a v1 approximation of the
 * workspace tree; the sandbox-backed real FS listing is a later (sandbox) item.
 */
export function selectSessionFiles(messages: ThreadMessage[]): SessionFile[] {
  const seen = new Map<string, SessionFile>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      if (!FILE_TOOLS.has(part.toolName?.toLowerCase() ?? '')) continue;
      const args = (part.args ?? {}) as Record<string, unknown>;
      const fp =
        readString(args.file_path) ?? readString(args.path) ?? readString(args.notebook_path);
      if (!fp) continue;
      const fileName = fp.split('/').pop() || fp;
      seen.set(fp, { path: fp, fileName, tool: part.toolName });
    }
  }
  return Array.from(seen.values());
}

export function useSessionFiles(): SessionFile[] {
  const messages = useChatSessionStore((s) => s.messages);
  return useMemo(() => selectSessionFiles(messages), [messages]);
}

// ───────────────────────── ④ Context ─────────────────────────

export interface SessionContextInfo {
  model?: string;
  skills: number;
  mcpServers: number;
  tools: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  numTurns?: number;
}

/** Session context/usage from the store (model · skills · mcp · token usage). */
export function useSessionContext(): SessionContextInfo | null {
  const usage = useChatSessionStore((s) => s.usageData);
  const meta = useChatSessionStore((s) => s.sessionMetadata);
  return useMemo(() => {
    if (!usage && !meta) return null;
    return {
      model: meta?.model,
      skills: meta?.skills?.length ?? 0,
      mcpServers: meta?.mcp_servers?.length ?? 0,
      tools: meta?.tools?.length ?? 0,
      inputTokens: usage?.usage?.input_tokens,
      outputTokens: usage?.usage?.output_tokens,
      totalCostUsd: usage?.total_cost_usd,
      numTurns: usage?.num_turns,
    };
  }, [usage, meta]);
}
