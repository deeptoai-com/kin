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

import { useState, useEffect, useRef, type FC, type ReactNode } from 'react';
import { ListChecks, GitBranch, FolderOpen, Gauge, Check, Loader2, FileCode, Telescope, ChevronRight, RefreshCw, Play, ExternalLink, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '~/lib/utils';
import { startPreview } from '~/claude/adapters';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { useWorkbenchUI, type WorkbenchTab } from '~/lib/stores/workbench-ui-store';
import {
  useSessionTodos,
  useSessionSubAgents,
  useWorkspaceFiles,
  useSessionContext,
  useSessionRagTraces,
  type TodoItem,
  type SubAgentItem,
  type SessionFile,
  type SessionContextInfo,
  type SessionRagTracesState,
} from '~/lib/hooks/use-session-workbench';
import type { RagTraceChunk, RagTraceView, SessionRagTraces } from '~/server/function/rag-trace.server';

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
  { id: 'retrieval', label: 'Retrieval', icon: Telescope },
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

/**
 * ③ Files tab — the REAL workspace tree + a session-level「运行预览」trigger.
 *
 * The trigger appears whenever the workspace has something previewable (an
 * index.html to serve, or a package.json to build) — decoupled from the old
 * "only on an Agent-generated artifact" gate, so a bash-cloned repo or any
 * workspace can be run. It drives the same static preview backend (build→dist
 * for bundler apps, no-build serve-as-is for plain frontends).
 */
const FilesTab: FC<{ files: SessionFile[]; sessionId: string | null }> = ({ files, sessionId }) => {
  const preview = useChatSessionStore((s) => s.previewState);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (preview?.status) setStarting(false);
  }, [preview?.status]);

  const status = preview?.status;
  const busy = starting || status === 'detecting' || status === 'installing' || status === 'building';
  const liveUrl = status === 'ready' ? preview?.url : undefined;
  const previewable = files.some((f) => /(^|\/)(index\.html|package\.json)$/i.test(f.path));

  const run = () => {
    setStarting(true);
    void startPreview(sessionId ?? undefined, 'static', { force: Boolean(liveUrl) }).catch(() =>
      setStarting(false),
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      {previewable && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/20 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {busy ? '构建中…' : liveUrl ? '重新构建' : '运行预览'}
          </button>
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              打开 <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {status === 'error' && (
            <span className="truncate text-xs text-red-600" title={preview?.error}>
              预览失败
            </span>
          )}
        </div>
      )}
      {files.length > 0 ? (
        <FilesList files={files} sessionId={sessionId} />
      ) : (
        <EmptyState
          title="No files yet"
          hint="Everything in this session's workspace — agent-written, bash-cloned, or uploaded — lists here. Click a file to open it."
        />
      )}
    </div>
  );
};

/** Files list — workspace files for this session. Click a file to open it (new tab). */
const FilesList: FC<{ files: SessionFile[]; sessionId: string | null }> = ({ files, sessionId }) => {
  const openFile = (path: string) => {
    if (!sessionId) return;
    const encoded = path.split('/').map((s) => encodeURIComponent(s)).join('/');
    window.open(`/api/workspace/${sessionId}/file/${encoded}?raw=1`, '_blank', 'noopener');
  };
  return (
    <div className="flex h-full flex-col">
      <p className="px-4 pt-4 pb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Files · {files.length}
      </p>
      <ul className="flex flex-col gap-1 px-3 pb-4">
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => openFile(f.path)}
              title={`${f.path} · 点击在新标签打开`}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
            >
              <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{f.fileName}</p>
                <p className="truncate text-[10px] text-muted-foreground">{f.path}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

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

/** ⑤ Retrieval — kb_search funnel traces for this session (RAG observability). */
const pageLabel = (c: RagTraceChunk): string =>
  c.pageStart ? ` · p.${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}` : '';

const ChunkRow: FC<{ id: string; chunks: SessionRagTraces['chunks']; tags: string[]; dropped?: boolean }> = ({
  id,
  chunks,
  tags,
  dropped,
}) => {
  const c = chunks[id];
  if (!c) {
    return <li className="px-2 py-1 text-[11px] italic text-muted-foreground/70">（该片段已失效 / 文档已重新入库）</li>;
  }
  return (
    <li className={cn('rounded-md border px-2 py-1.5', dropped ? 'border-dashed border-border bg-transparent opacity-70' : 'border-border bg-background')}>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[11px] font-medium text-foreground">{c.docTitle}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {tags.map((t) => (
            <span key={t} className="rounded bg-primary/10 px-1 text-[9px] font-medium text-primary">{t}</span>
          ))}
        </span>
      </div>
      {c.sectionPath && (
        <p className="truncate text-[10px] text-muted-foreground" title={c.sectionPath}>
          {c.sectionPath}
          {pageLabel(c)}
        </p>
      )}
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{c.snippet}</p>
    </li>
  );
};

const TraceCard: FC<{ trace: RagTraceView; chunks: SessionRagTraces['chunks'] }> = ({ trace, chunks }) => {
  const [open, setOpen] = useState(false);
  const vec = new Set(trace.vectorIds);
  const bm = new Set(trace.bm25Ids);
  const recalled = new Set([...trace.vectorIds, ...trace.bm25Ids]);
  const returnedSet = new Set(trace.returnedIds);
  // "recalled but not returned" = the ranking-loss signal (was a candidate, didn't survive).
  const dropped = trace.fusedIds.filter((id) => !returnedSet.has(id));
  const tagsFor = (id: string): string[] => [vec.has(id) ? '向量' : null, bm.has(id) ? 'BM25' : null].filter((x): x is string => !!x);
  const degraded = trace.degraded && trace.degraded !== 'ok';

  return (
    <li className="rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left">
        <ChevronRight className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground" title={trace.query}>{trace.query}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {trace.visibleDocCount != null && <span className="rounded bg-muted px-1">看 {trace.visibleDocCount} 篇</span>}
            <span className="rounded bg-muted px-1">召回 {recalled.size}</span>
            <span className="rounded bg-emerald-500/10 px-1 text-emerald-600">返回 {trace.returnedIds.length}</span>
            <span className="rounded bg-muted px-1">{trace.reranked ? 'rerank 开' : 'rerank 关'}</span>
            {degraded && <span className="rounded bg-destructive/10 px-1 text-destructive" title={trace.degraded ?? ''}>降级</span>}
            {trace.latencyMs != null && <span className="rounded bg-muted px-1">{trace.latencyMs}ms</span>}
          </div>
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">
            向量 {trace.vectorIds.length} · BM25 {trace.bm25Ids.length} · 融合 {trace.fusedIds.length} · 返回 {trace.returnedIds.length}
          </p>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">返回给 Agent（{trace.returnedIds.length}）</p>
            {trace.returnedIds.length ? (
              <ul className="flex flex-col gap-1">
                {trace.returnedIds.map((id) => <ChunkRow key={id} id={id} chunks={chunks} tags={tagsFor(id)} />)}
              </ul>
            ) : (
              <p className="px-2 text-[11px] italic text-muted-foreground">无返回 —— 范围内没有任何片段被召回（范围漏 / 召回漏）。</p>
            )}
          </div>
          {dropped.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">召回未返回（{dropped.length}）· 排序挤掉</p>
              <ul className="flex flex-col gap-1">
                {dropped.map((id) => <ChunkRow key={id} id={id} chunks={chunks} tags={tagsFor(id)} dropped />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

const RetrievalView: FC<{ state: SessionRagTracesState }> = ({ state }) => {
  const { data, loading, error, refresh } = state;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          kb_search 检索{data?.traces.length ? ` · ${data.traces.length}` : ''}
        </p>
        <button type="button" onClick={refresh} disabled={loading} className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent disabled:opacity-50">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}刷新
        </button>
      </div>
      <p className="px-4 pb-2 text-[10px] leading-relaxed text-muted-foreground">
        Agent 每次搜知识库的<b className="font-medium text-foreground">召回漏斗</b>。命中与否需你对照文档判断——这里只如实展示：哪条腿召回了、被排序挤掉了、最终返回了。
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {error ? (
          <p className="px-1 py-4 text-xs text-destructive">读取失败，点「刷新」重试。</p>
        ) : !data && loading ? (
          <div className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />加载中…</div>
        ) : data && data.traces.length ? (
          <ul className="flex flex-col gap-2">
            {data.traces.map((t) => <TraceCard key={t.id} trace={t} chunks={data.chunks} />)}
          </ul>
        ) : (
          <p className="px-1 py-4 text-xs text-muted-foreground">本次对话还没有 kb_search 检索。当 Agent 搜索知识库后，每次检索的漏斗会出现在这里。</p>
        )}
      </div>
    </div>
  );
};

export interface WorkbenchPanelProps {
  currentSessionId: string | null;
  className?: string;
  /** When provided, a "collapse" button is shown in the tab bar (used by WorkbenchDock). */
  onCollapse?: () => void;
}

export const WorkbenchPanel: FC<WorkbenchPanelProps> = ({ currentSessionId, className, onCollapse }) => {
  // Active tab lives in the shared store so the composer icons (会话文件→Files,
  // info→Context) and the auto-open watcher can land the workbench on a tab.
  const activeTab = useWorkbenchUI((s) => s.activeTab);
  const setActiveTab = useWorkbenchUI((s) => s.setTab);
  const todoSummary = useSessionTodos();
  const subAgents = useSessionSubAgents();
  const files = useWorkspaceFiles(currentSessionId, activeTab === 'files');
  const context = useSessionContext();
  // Retrieval is DB-backed — fetch only when its tab is open (and a session exists).
  const ragTraces = useSessionRagTraces(currentSessionId, activeTab === 'retrieval');

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
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="收起工作台"
            title="收起工作台"
            className="ml-auto mb-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        )}
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
        {activeTab === 'files' && <FilesTab files={files} sessionId={currentSessionId} />}
        {activeTab === 'context' &&
          (context ? (
            <ContextView ctx={context} />
          ) : (
            <EmptyState
              title="Context & usage"
              hint="Model, capabilities, and this session's token usage will surface here once a turn runs."
            />
          ))}
        {activeTab === 'retrieval' && <RetrievalView state={ragTraces} />}
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

// ─────────────────────────── WorkbenchDock (collapsible) ───────────────────────────

/**
 * WorkbenchDock — the right wrapper for the workbench.
 *
 * Open/closed is driven by the SHARED workbench-ui store, so the chat composer's
 * 「会话文件」button (a far-apart sibling in the tree) toggles it and this renders from
 * it — one control, no dumb rail. CLOSED → renders nothing (the composer button
 * reopens it). OPEN → the 360px panel with a collapse button in its tab bar. Hidden
 * below lg (unchanged).
 */
export const WorkbenchDock: FC<{ currentSessionId: string | null }> = ({ currentSessionId }) => {
  const open = useWorkbenchUI((s) => s.open);
  const close = useWorkbenchUI((s) => s.close);
  const hydrate = useWorkbenchUI((s) => s.hydrate);

  // Restore the persisted open/closed choice once on the client.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!open) return null;

  return (
    <div className="hidden h-full shrink-0 overflow-hidden border-l lg:block" style={{ width: 360 }}>
      {/* Collapse suppresses auto-open for the rest of this turn (user said "no"). */}
      <WorkbenchPanel currentSessionId={currentSessionId} onCollapse={close} />
    </div>
  );
};

/**
 * Auto-open watcher — call from an ALWAYS-mounted component (the WorkbenchPanel only
 * mounts when the dock is open, so the trigger can't live there). Opens the workbench
 * to the relevant tab the first time a plan (→Progress) or sub-agent (→Sub-agents)
 * appears, UNLESS the user manually closed it this turn. A new run clears that
 * suppression so the next turn can auto-open again.
 */
export function useWorkbenchAutoOpen(): void {
  const todoSummary = useSessionTodos();
  const subAgents = useSessionSubAgents();
  const isRunning = useChatSessionStore((s) => s.isRunning);
  const autoOpen = useWorkbenchUI((s) => s.autoOpen);
  const resetSuppress = useWorkbenchUI((s) => s.resetSuppress);

  const prevRunning = useRef(false);
  useEffect(() => {
    if (isRunning && !prevRunning.current) resetSuppress();
    prevRunning.current = isRunning;
  }, [isRunning, resetSuppress]);

  const hadTodos = useRef(false);
  useEffect(() => {
    const has = Boolean(todoSummary);
    if (has && !hadTodos.current) autoOpen('progress');
    hadTodos.current = has;
  }, [todoSummary, autoOpen]);

  const hadSub = useRef(false);
  useEffect(() => {
    const has = subAgents.length > 0;
    if (has && !hadSub.current) autoOpen('subagents');
    hadSub.current = has;
  }, [subAgents, autoOpen]);
}

export default WorkbenchPanel;
