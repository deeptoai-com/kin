/**
 * WorkbenchPanel — Phase 3 Wave 0 skeleton (right-side resident workbench).
 *
 * The "agent workbench" rail that turns the chat from a chat-box into a
 * workbench: switchable sections (Progress / Sub-agents / Files / Context).
 *
 * Wave 0 scope: STRUCTURE ONLY. Every section renders an empty state with a
 * placeholder 3D-icon slot. No data wiring yet — each section is filled in a
 * later wave:
 *   · Progress    → ① TodoWrite live checklist          (Wave 1)
 *   · Sub-agents  → ② nested tree via parent_tool_use_id (Wave 1)
 *   · Files       → existing session-files / artifacts    (Wave 1)
 *   · Context     → ⑤ memory + Phase 2 usage_record       (Wave 2/3)
 *
 * Multi-tenant boundary: takes `currentSessionId` so future data reads are
 * scoped per session (and, server-side, per user). Holds no cross-session state.
 *
 * i18n: labels are intentionally hardcoded (English) for the skeleton; they get
 * moved into intlayer content when the sections are actually wired up.
 */

import { useState, type FC, type ReactNode } from 'react';
import { ListChecks, GitBranch, FolderOpen, Gauge, Check, Loader2, FileCode } from 'lucide-react';
import { cn } from '~/lib/utils';
import {
  useSessionTodos,
  useSessionSubAgents,
  useSessionFiles,
  useSessionContext,
  type TodoItem,
  type SubAgentItem,
  type SessionFile,
  type SessionContextInfo,
} from '~/lib/hooks/use-session-workbench';

type WorkbenchTab = 'progress' | 'subagents' | 'files' | 'context';

interface TabDef {
  id: WorkbenchTab;
  label: string;
  icon: typeof ListChecks;
}

const TABS: TabDef[] = [
  { id: 'progress', label: 'Progress', icon: ListChecks },
  { id: 'subagents', label: 'Sub-agents', icon: GitBranch },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'context', label: 'Context', icon: Gauge },
];

/** Placeholder slot for the owner-supplied 3D skeuomorphic icons (Wave 0). */
const IconSlot: FC<{ className?: string }> = ({ className }) => (
  <div
    className={cn(
      'flex items-center justify-center rounded-xl border border-dashed border-border',
      'bg-gradient-to-b from-accent/60 to-transparent text-[9px] font-medium text-muted-foreground',
      className,
    )}
    aria-hidden
  >
    3D
  </div>
);

const EmptyState: FC<{ title: string; hint: string; children?: ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <IconSlot className="h-12 w-12" />
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
    {children}
  </div>
);

/** ① Progress — live TodoWrite checklist (Cowork-style). */
const TodoRow: FC<{ item: TodoItem }> = ({ item }) => {
  const done = item.status === 'completed';
  const running = item.status === 'in_progress';
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
          done && 'border-success bg-success text-success-foreground',
          running && 'border-primary text-primary',
          !done && !running && 'border-border',
        )}
        aria-hidden
      >
        {done && <Check className="h-3 w-3" strokeWidth={3} />}
        {running && <Loader2 className="h-3 w-3 animate-spin" />}
      </span>
      <span
        className={cn(
          'leading-snug',
          done && 'text-muted-foreground line-through',
          running && 'font-medium text-foreground',
          !done && !running && 'text-foreground',
        )}
      >
        {running && item.activeForm ? item.activeForm : item.content}
      </span>
    </li>
  );
};

const TodoList: FC<{
  todos: TodoItem[];
  total: number;
  completed: number;
}> = ({ todos, total, completed }) => {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex h-full flex-col">
      <p className="px-4 pt-4 pb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Current plan · Todo
      </p>
      <ul className="flex flex-col gap-2.5 px-4">
        {todos.map((item, i) => (
          <TodoRow key={`${i}-${item.content}`} item={item} />
        ))}
      </ul>
      <div className="mt-auto px-4 pb-4 pt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {completed} / {total} completed
        </p>
      </div>
    </div>
  );
};

/** ② Sub-agents — flat list of Task delegations with live status. */
const SubAgentRow: FC<{ item: SubAgentItem }> = ({ item }) => {
  const statusColor =
    item.status === 'completed'
      ? 'text-success'
      : item.status === 'error'
        ? 'text-destructive'
        : 'text-muted-foreground';
  const statusLabel =
    item.status === 'completed' ? 'Done' : item.status === 'error' ? 'Failed' : 'Running';
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
      <IconSlot className="mt-0.5 h-7 w-7 shrink-0 rounded-lg text-[8px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-foreground">
            {item.subagentType ?? 'agent'}
          </span>
          <span className={cn('ml-auto flex items-center gap-1 text-[10px]', statusColor)}>
            {item.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            {item.status === 'completed' && <Check className="h-3 w-3" strokeWidth={3} />}
            {statusLabel}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {item.description}
        </p>
      </div>
    </li>
  );
};

const SubAgentList: FC<{ subAgents: SubAgentItem[] }> = ({ subAgents }) => (
  <div className="flex h-full flex-col">
    <p className="px-4 pt-4 pb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      Sub-agents · {subAgents.length}
    </p>
    <ul className="flex flex-col gap-2 px-4 pb-4">
      {subAgents.map((item) => (
        <SubAgentRow key={item.id} item={item} />
      ))}
    </ul>
  </div>
);

/** ③ Files — workspace files the agent wrote/edited this session. */
const FilesList: FC<{ files: SessionFile[] }> = ({ files }) => (
  <div className="flex h-full flex-col">
    <p className="px-4 pt-4 pb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      Files · {files.length}
    </p>
    <ul className="flex flex-col gap-1 px-3 pb-4">
      {files.map((f) => (
        <li
          key={f.path}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
          title={f.path}
        >
          <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{f.fileName}</p>
            <p className="truncate text-[10px] text-muted-foreground">{f.path}</p>
          </div>
        </li>
      ))}
    </ul>
  </div>
);

/** ④ Context — model · capabilities · token usage for this session. */
const ContextView: FC<{ ctx: SessionContextInfo }> = ({ ctx }) => {
  const rows: Array<{ label: string; value: string }> = [];
  if (ctx.model) rows.push({ label: 'Model', value: ctx.model });
  rows.push({ label: 'Skills', value: String(ctx.skills) });
  rows.push({ label: 'MCP servers', value: String(ctx.mcpServers) });
  rows.push({ label: 'Tools', value: String(ctx.tools) });
  if (ctx.numTurns != null) rows.push({ label: 'Turns', value: String(ctx.numTurns) });
  if (ctx.inputTokens != null || ctx.outputTokens != null) {
    rows.push({
      label: 'Tokens',
      value: `${(ctx.inputTokens ?? 0).toLocaleString()} in · ${(ctx.outputTokens ?? 0).toLocaleString()} out`,
    });
  }
  if (ctx.totalCostUsd != null) rows.push({ label: 'Cost', value: `$${ctx.totalCostUsd.toFixed(4)}` });
  return (
    <div className="flex h-full flex-col">
      <p className="px-4 pt-4 pb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Context & usage
      </p>
      <dl className="flex flex-col gap-2 px-4 pb-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 text-xs">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="truncate font-medium text-foreground" title={r.value}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export interface WorkbenchPanelProps {
  currentSessionId: string | null;
  className?: string;
}

export const WorkbenchPanel: FC<WorkbenchPanelProps> = ({ currentSessionId, className }) => {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('progress');
  const todoSummary = useSessionTodos();
  const subAgents = useSessionSubAgents();
  const files = useSessionFiles();
  const context = useSessionContext();

  return (
    <aside
      className={cn('flex h-full w-full flex-col bg-card', className)}
      aria-label="Agent workbench"
    >
      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-border px-2 pt-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-1.5 rounded-t-md px-2.5 py-2 text-xs font-medium transition-colors',
                'border-b-2 -mb-px',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Section body — Wave 0 empty states */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'progress' &&
          (todoSummary ? (
            <TodoList
              todos={todoSummary.todos}
              total={todoSummary.total}
              completed={todoSummary.completed}
            />
          ) : (
            <EmptyState
              title="No active plan"
              hint="The agent's TodoWrite plan will appear here, with steps checked off live as the task runs."
            />
          ))}
        {activeTab === 'subagents' &&
          (subAgents.length > 0 ? (
            <SubAgentList subAgents={subAgents} />
          ) : (
            <EmptyState
              title="No sub-agents yet"
              hint="When the agent delegates work via the Task tool, each sub-agent shows here with live status."
            />
          ))}
        {activeTab === 'files' &&
          (files.length > 0 ? (
            <FilesList files={files} />
          ) : (
            <EmptyState
              title="No files yet"
              hint="Files the agent writes or edits in this session's workspace will be listed here."
            />
          ))}
        {activeTab === 'context' &&
          (context ? (
            <ContextView ctx={context} />
          ) : (
            <EmptyState
              title="Context & usage"
              hint="Model, capabilities, and this session's token usage will surface here once a turn runs."
            />
          ))}
      </div>

      {/* Session-scope footer marker (skeleton — confirms per-session boundary) */}
      <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        {currentSessionId ? (
          <span>Session · {currentSessionId.slice(0, 8)}</span>
        ) : (
          <span>No active session</span>
        )}
      </div>
    </aside>
  );
};

export default WorkbenchPanel;
