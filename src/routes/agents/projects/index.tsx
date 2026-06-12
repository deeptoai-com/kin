import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { Folder, FolderOpen, Plus, Search, Users } from 'lucide-react';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import { CreateProjectDialog } from '~/components/projects/create-project-dialog';
import { useProjects, type ProjectDTO } from '~/lib/hooks/use-projects';
import { toLocalizedString } from '~/lib/utils';

export const Route = createFileRoute('/agents/projects/')({
  component: ProjectsIndex,
});

/** Relative time in zh-CN (component runtime — Date is available here). */
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/**
 * Projects landing (IA redesign 2026-06, prd §2.3): card grid of the team's projects —
 * name + members + updated time. Unlike Claude Desktop's Project (a local folder), an
 * oxygenie Project is a server-side team container, so cards show team attributes.
 */
function ProjectsIndex() {
  const content = useIntlayer('projects');
  const navigate = useNavigate();
  const { projects, isLoading, createProject } = useProjects();
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const personalLabel = toLocalizedString(content.rail.personal);
  const nameOf = (p: ProjectDTO) => (p.isDefault ? personalLabel : p.name);
  const filtered = projects.filter((p) => !q || nameOf(p).toLowerCase().includes(q.toLowerCase()));

  const handleCreate = async ({ name }: { name: string }) => {
    const project = await createProject({ name });
    navigate({ to: '/agents/projects/$projectId', params: { projectId: project.id } });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          {content.rail.projectsHeading}
        </h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {content.rail.newProject}
        </Button>
      </div>

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索项目…"
          className="pl-9"
        />
      </div>

      {isLoading && projects.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">加载中…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">{content.index.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{content.index.subtitle}</p>
          </div>
          {!q && (
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {content.rail.newProject}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              displayName={nameOf(project)}
              onOpen={() =>
                navigate({ to: '/agents/projects/$projectId', params: { projectId: project.id } })
              }
            />
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
    </div>
  );
}

function ProjectCard({
  project,
  displayName,
  onOpen,
}: {
  project: ProjectDTO;
  displayName: string;
  onOpen: () => void;
}) {
  const members = project.members;
  const shownAvatars = members.slice(0, 3);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background p-4 text-left transition-colors hover:border-border hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        <Folder className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{displayName}</span>
      </div>
      {project.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
      )}
      <div className="mt-auto flex items-center justify-between pt-1">
        <div className="flex items-center">
          {members.length > 1 ? (
            <div className="flex -space-x-2">
              {shownAvatars.map((m) => (
                <LetterAvatar
                  key={m.userId}
                  name={m.name}
                  size="sm"
                  className="!size-6 rounded-full ring-2 ring-background"
                />
              ))}
              {members.length > 3 && (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-2 ring-background">
                  +{members.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {members.length} 成员
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{timeAgo(project.updatedAt)} 更新</span>
      </div>
    </button>
  );
}
