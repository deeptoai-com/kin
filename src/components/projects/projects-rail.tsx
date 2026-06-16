'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useIntlayer } from 'react-intlayer';
import {
  Plus,
  FolderPlus,
  Folder,
  Users,
  MessageSquare,
  Loader2,
  Search,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Pin,
  Pencil,
} from 'lucide-react';
import { CreateProjectDialog } from './create-project-dialog';
import { SessionSearchDialog } from '~/components/claude-chat/session-search-dialog';
import { SessionMenu } from './session-menu';
import { ProjectMenu } from './project-menu';
import { ProjectSettingsDialog } from './project-settings-dialog';
import { useProjects, isShared, type ProjectDTO } from '~/lib/hooks/use-projects';
import { listProjectSessions } from '~/server/function/projects.server';
import { useRailStore } from '~/lib/stores/rail-store';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { cn, toLocalizedString } from '~/lib/utils';

/**
 * Concurrent sessions (FR4): a small pulsing green dot at the end of a session row
 * marking it as currently running in the background (Owner-approved "option B").
 * Sits in the row's `group/sess relative` wrapper at the far right; fades out on
 * hover so the row's ⋯ menu takes the slot. Driven by the store's runningSessionIds
 * (server-authoritative via list_running + live frames), so it's correct across
 * tabs and survives a refresh.
 */
function RunningDot() {
  return (
    <span
      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity group-hover/sess:opacity-0"
      aria-label="运行中"
      title="运行中"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
    </span>
  );
}

interface RecentSession {
  id: string;
  sdkSessionId: string;
  title: string;
  favorite?: boolean;
  projectId?: string | null;
}

interface ProjectsRailProps {
  activeProjectId?: string;
}

/** How many projects show in the rail tree before "显示更多" routes to the landing page. */
const RAIL_PROJECT_LIMIT = 5;
/** How many chats show under an expanded project before "显示更多" routes into the project. */
const PROJECT_SESSION_LIMIT = 5;

/**
 * Rail-2 — the agent workbench (IA redesign 2026-06, prd §2.2):
 *   [+新建任务] · 搜索(⌘K) · 项目(入口) · 作品(待建)
 *   ── 项目 (collapsible group) → project tree: each project expands to its chats ──
 *   ── 最近 (loose chats) ──
 * The 项目 GROUP HEADING toggles the tree (it is NOT the landing-page entry — that's the
 * 项目 entry under 搜索). Project rows expand to their sessions (listProjectSessions).
 */
export function ProjectsRail({ activeProjectId }: ProjectsRailProps) {
  const content = useIntlayer('projects');
  const navigate = useNavigate();
  const collapsed = useRailStore((s) => s.collapsed);
  // Concurrent sessions (FR4): which of this user's sessions are running now.
  const runningSessionIds = useChatSessionStore((s) => s.runningSessionIds);
  const { projects, isLoading: projectsLoading, ensureDefault, createProject } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleProject = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ⌘K / Ctrl-K toggles conversation search (IA redesign §4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ensure the default "个人/Personal" Project exists — once, only if missing.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (ensuredRef.current) return;
    if (!projectsLoading && !projects.some((p) => p.isDefault)) {
      ensuredRef.current = true;
      void ensureDefault();
    }
  }, [projectsLoading, projects, ensureDefault]);

  // 最近 = loose chats only (project chats live inside their Project, not here).
  const { data, isLoading: recentLoading } = useQuery<{ sessions: RecentSession[] }>({
    queryKey: ['agent-sessions', 'loose'],
    queryFn: async () => {
      const res = await fetch('/api/agent-sessions?scope=loose&limit=50');
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
    refetchInterval: 30000,
  });
  // 置顶 = favorite sessions across loose + projects; 最近 = loose 非置顶（去重）。
  const { data: pinnedData } = useQuery<{ sessions: RecentSession[] }>({
    queryKey: ['agent-sessions', 'all-pinned'],
    queryFn: async () => {
      const res = await fetch('/api/agent-sessions?limit=100');
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
    refetchInterval: 30000,
  });
  const pinned = (pinnedData?.sessions ?? []).filter((s) => s.favorite);
  const recent = (data?.sessions ?? []).filter((s) => !s.favorite);

  const handleCreate = async ({ name }: { name: string }) => {
    const project = await createProject({ name });
    navigate({ to: '/agents/projects/$projectId', params: { projectId: project.id } });
  };

  // Collapsed: hide the rail but keep the search dialog mounted so ⌘K still works.
  if (collapsed) {
    return <SessionSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />;
  }

  const visibleProjects = projects.slice(0, RAIL_PROJECT_LIMIT);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* New chat (loose chat — lands on the chat surface) */}
      <div className="shrink-0 p-3">
        <button
          type="button"
          onClick={() => navigate({ to: '/agents/c' })}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5',
            'bg-primary text-primary-foreground text-sm font-medium',
            'transition-colors hover:bg-primary/90',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
        >
          <Plus className="h-4 w-4" />
          <span>{content.rail.newChat}</span>
        </button>
      </div>

      {/* Fixed entries: 搜索 / 项目(landing) / 作品 (IA redesign §2.2) */}
      <div className="shrink-0 space-y-0.5 px-3 pb-1">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left">搜索</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: '/agents/projects' })}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent"
        >
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left">项目</span>
        </button>
        <button
          type="button"
          disabled
          title="即将上线"
          className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground/40"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">作品</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">待建</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {/* ---- 项目 group (heading TOGGLES the tree; not the landing entry) ---- */}
        <div className="flex items-center justify-between px-2 pt-2 pb-1">
          <button
            type="button"
            onClick={() => setProjectsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', !projectsOpen && '-rotate-90')}
            />
            {content.rail.projectsHeading}
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={toLocalizedString(content.rail.newProject)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>{content.rail.newProject}</span>
          </button>
        </div>

        {projectsOpen &&
          (projectsLoading && projects.length === 0 ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground/70">{content.rail.noProjects}</p>
          ) : (
            <div className="space-y-0.5">
              {visibleProjects.map((project) => (
                <ProjectTreeRow
                  key={project.id}
                  project={project}
                  isActive={project.id === activeProjectId}
                  expanded={expanded.has(project.id)}
                  onToggle={() => toggleProject(project.id)}
                  personalLabel={toLocalizedString(content.rail.personal)}
                  sharedLabel={toLocalizedString(content.home.sharedBadge)}
                  newChatLabel={toLocalizedString(content.rail.newChat)}
                />
              ))}
              {projects.length > RAIL_PROJECT_LIMIT && (
                <Link
                  to="/agents/projects"
                  className="block rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  显示更多
                </Link>
              )}
            </div>
          ))}

        {/* ---- 置顶 (favorite: loose + project) ---- */}
        {pinned.length > 0 && (
          <>
            <div className="px-2 pt-4 pb-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">置顶</span>
            </div>
            <div className="space-y-0.5">
              {pinned.map((s) => {
                const label = s.title || toLocalizedString(content.rail.newChat);
                return (
                  <div key={s.id} className="group/sess relative">
                    {s.projectId ? (
                      <Link
                        to="/agents/projects/$projectId/c/$sessionId"
                        params={{ projectId: s.projectId, sessionId: s.sdkSessionId }}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 pr-8 text-sm text-foreground/80 transition-colors hover:bg-accent"
                      >
                        <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{label}</span>
                      </Link>
                    ) : (
                      <Link
                        to="/agents/c/$sessionId"
                        params={{ sessionId: s.sdkSessionId }}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 pr-8 text-sm text-foreground/80 transition-colors hover:bg-accent"
                      >
                        <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{label}</span>
                      </Link>
                    )}
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/sess:opacity-100">
                      <SessionMenu
                        session={{ id: s.id, sdkSessionId: s.sdkSessionId, title: s.title }}
                        projectId={s.projectId ?? undefined}
                        personalLabel={toLocalizedString(content.rail.personal)}
                        favorite
                      />
                    </div>
                    {runningSessionIds.includes(s.sdkSessionId) && <RunningDot />}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ---- Recent (loose chats) ---- */}
        <div className="px-2 pt-4 pb-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {content.rail.recentHeading}
          </span>
        </div>

        {recentLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : recent.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70">{content.rail.noRecent}</p>
        ) : (
          <div className="space-y-0.5">
            {recent.map((session) => (
              <div key={session.id} className="group/sess relative">
                <Link
                  to="/agents/c/$sessionId"
                  params={{ sessionId: session.sdkSessionId }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 pr-8 text-sm text-foreground/80 transition-colors hover:bg-accent"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{session.title || toLocalizedString(content.rail.newChat)}</span>
                </Link>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/sess:opacity-100">
                  <SessionMenu
                    session={{ id: session.id, sdkSessionId: session.sdkSessionId, title: session.title }}
                    personalLabel={toLocalizedString(content.rail.personal)}
                  />
                </div>
                {runningSessionIds.includes(session.sdkSessionId) && <RunningDot />}
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      <SessionSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

interface ProjectSessionRow {
  id: string;
  sdkSessionId: string;
  title: string | null;
}

/**
 * A project row in the rail tree: clicking the row expands it to its chats
 * (listProjectSessions, fetched lazily on first expand). The project name itself does
 * NOT navigate — expand/collapse is the click target (Owner spec). Folder header in the
 * landing page is the place to open the project.
 */
function ProjectTreeRow({
  project,
  isActive,
  expanded,
  onToggle,
  personalLabel,
  sharedLabel,
  newChatLabel,
}: {
  project: ProjectDTO;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
  personalLabel: string;
  sharedLabel: string;
  newChatLabel: string;
}) {
  const displayName = project.isDefault ? personalLabel : project.name;
  const shared = isShared(project);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fetchSessions = useServerFn(listProjectSessions);
  // Concurrent sessions (FR4): running indicator for this project's chats.
  const runningSessionIds = useChatSessionStore((s) => s.runningSessionIds);

  const { data: sessions, isLoading } = useQuery<ProjectSessionRow[]>({
    queryKey: ['project-sessions', project.id],
    queryFn: () => fetchSessions({ data: { projectId: project.id } }),
    enabled: expanded,
    staleTime: 30_000,
  });
  const list = sessions ?? [];
  const shown = list.slice(0, PROJECT_SESSION_LIMIT);

  return (
    <div>
      <div
        className={cn(
          'group/proj flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors',
          isActive ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent/60'
        )}
      >
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5">
          <ChevronRight
            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
          />
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left text-sm">{displayName}</span>
        </button>
        {shared && (
          <span className="flex items-center" title={sharedLabel}>
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )}
        {!project.isDefault && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/proj:opacity-100">
            <button
              type="button"
              aria-label="项目设置"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen(true);
              }}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <ProjectMenu project={project} />
          </div>
        )}
      </div>

      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-border/50 pl-1.5">
          {isLoading ? (
            <div className="flex items-center px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          ) : list.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-muted-foreground/70">暂无会话</p>
          ) : (
            <>
              {shown.map((s) => (
                <div key={s.id} className="group/sess relative">
                  <Link
                    to="/agents/projects/$projectId/c/$sessionId"
                    params={{ projectId: project.id, sessionId: s.sdkSessionId }}
                    className="block truncate rounded-lg px-3 py-1.5 pr-8 text-sm text-foreground/75 transition-colors hover:bg-accent"
                  >
                    {s.title || newChatLabel}
                  </Link>
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/sess:opacity-100">
                    <SessionMenu
                      session={{ id: s.id, sdkSessionId: s.sdkSessionId, title: s.title }}
                      projectId={project.id}
                      personalLabel={personalLabel}
                    />
                  </div>
                  {runningSessionIds.includes(s.sdkSessionId) && <RunningDot />}
                </div>
              ))}
              {list.length > PROJECT_SESSION_LIMIT && (
                <Link
                  to="/agents/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="block rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  显示更多
                </Link>
              )}
            </>
          )}
        </div>
      )}
      {!project.isDefault && (
        <ProjectSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} project={project} />
      )}
    </div>
  );
}
