'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useIntlayer } from 'react-intlayer';
import { Plus, FolderPlus, Users, MessageSquare, Loader2, Search, Sparkles } from 'lucide-react';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import { CreateProjectDialog } from './create-project-dialog';
import { SessionSearchDialog } from '~/components/claude-chat/session-search-dialog';
import { useProjects, isShared, type ProjectDTO } from '~/lib/hooks/use-projects';
import { useRailStore } from '~/lib/stores/rail-store';
import { cn, toLocalizedString } from '~/lib/utils';

interface RecentSession {
  id: string;
  sdkSessionId: string;
  title: string;
}

interface ProjectsRailProps {
  activeProjectId?: string;
}

/**
 * Rail-2 for the Projects surface: `[+ New chat]` + a 项目 (Projects) section +
 * a 最近 (Recent) section — the ChatGPT / Claude Desktop layout. Daily chats stay
 * loose under 最近; a Project is an explicit container you create to organize or
 * share. Backed by the projects server functions (useProjects).
 */
export function ProjectsRail({ activeProjectId }: ProjectsRailProps) {
  const content = useIntlayer('projects');
  const navigate = useNavigate();
  const collapsed = useRailStore((s) => s.collapsed);
  const { projects, isLoading: projectsLoading, ensureDefault, createProject } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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
  const recent = data?.sessions ?? [];

  const handleCreate = async ({ name }: { name: string }) => {
    const project = await createProject({ name });
    navigate({ to: '/agents/projects/$projectId', params: { projectId: project.id } });
  };

  // Collapsed: hide the rail but keep the search dialog mounted so ⌘K still works.
  if (collapsed) {
    return <SessionSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />;
  }

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

      {/* Search + Artifacts entries (IA redesign §2.2) */}
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
        {/* ---- Projects ---- */}
        <div className="flex items-center justify-between px-2 pt-2 pb-1">
          <Link
            to="/agents/projects"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            {content.rail.projectsHeading}
          </Link>
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

        {projectsLoading && projects.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70">{content.rail.noProjects}</p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                personalLabel={toLocalizedString(content.rail.personal)}
                sharedLabel={toLocalizedString(content.home.sharedBadge)}
              />
            ))}
          </div>
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
              <Link
                key={session.id}
                to="/agents/c/$sessionId"
                params={{ sessionId: session.sdkSessionId }}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{session.title || toLocalizedString(content.rail.newChat)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      <SessionSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function ProjectRow({
  project,
  isActive,
  personalLabel,
  sharedLabel,
}: {
  project: ProjectDTO;
  isActive: boolean;
  personalLabel: string;
  sharedLabel: string;
}) {
  const displayName = project.isDefault ? personalLabel : project.name;
  const shared = isShared(project);
  return (
    <Link
      to="/agents/projects/$projectId"
      params={{ projectId: project.id }}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
        isActive ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent/60'
      )}
    >
      <LetterAvatar name={displayName} size="sm" className="!size-7 !rounded-md text-xs" />
      <span className="min-w-0 flex-1 truncate text-sm">{displayName}</span>
      {shared && (
        <span className="flex items-center" title={sharedLabel}>
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      )}
    </Link>
  );
}
