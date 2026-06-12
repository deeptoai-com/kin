'use client';

import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useIntlayer } from 'react-intlayer';
import { Plus, Share2, MessageSquare, FileText, Upload, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/tabs';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import { ShareProjectDialog } from './share-project-dialog';
import { ProjectMenu } from './project-menu';
import { ProjectSettingsDialog } from './project-settings-dialog';
import { isShared, type ProjectDTO } from '~/lib/hooks/use-projects';
import { listProjectSessions } from '~/server/function/projects.server';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { cn, toLocalizedString } from '~/lib/utils';

interface ProjectHomeProps {
  project: ProjectDTO;
  /** The viewing user's id — used to gate owner-only sharing controls. */
  currentUserId: string;
  /** Localized "Personal" label for the default project. */
  personalLabel: string;
}

/**
 * Project home — title + members + share + a "new chat in this project" composer
 * + 聊天 / 来源 (Chats / Sources) tabs. Faithful to the ChatGPT / Claude Desktop
 * project page. The composer lands in the project's new-chat route (.../c) so the
 * session is created bound to this project and the URL stays inside the project
 * (Projects×Chat unification, Phase 1). The 来源 (RAG) list arrives with RAG R0 —
 * the tab already holds its place.
 */
export function ProjectHome({ project, currentUserId, personalLabel }: ProjectHomeProps) {
  const content = useIntlayer('projects');
  const navigate = useNavigate();
  const setPendingProjectId = useChatSessionStore((s) => s.setPendingProjectId);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isOwner = project.ownerUserId === currentUserId;

  // "New chat in <project>": arm the project, then open the chat surface — the chat
  // route creates a fresh session and binds it to this project (assignSessionToProject).
  const startChatInProject = () => {
    // Land in the PROJECT's new-chat route (not the loose chat surface) so the created
    // session stays inside the project — onSessionInit mirrors the URL to /c/$newId.
    setPendingProjectId(project.id);
    navigate({ to: '/agents/projects/$projectId/c', params: { projectId: project.id } });
  };
  const displayName = project.isDefault ? personalLabel : project.name;
  const composerPlaceholder = toLocalizedString(content.home.newChatIn).replace('{name}', displayName);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <LetterAvatar name={displayName} size="lg" className="!rounded-xl" />
            <div className="min-w-0">
              <h1 className="truncate font-serif text-2xl font-semibold tracking-tight text-foreground">
                {displayName}
              </h1>
              {project.description ? (
                <p className="truncate text-sm text-muted-foreground">{project.description}</p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <MemberAvatars project={project} />
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Share2 className="h-4 w-4" />
              {content.home.share}
            </button>
            {!project.isDefault && (
              <ProjectMenu project={project} onOpenSettings={() => setSettingsOpen(true)} />
            )}
          </div>
        </div>

        {/* Composer (new chat in this project) */}
        <button
          type="button"
          onClick={startChatInProject}
          className={cn(
            'mt-6 flex w-full items-center gap-3 rounded-2xl border border-input bg-background px-4 py-3.5 text-left',
            'text-sm text-muted-foreground shadow-sm transition-colors hover:border-ring hover:bg-accent/40'
          )}
        >
          <Plus className="h-5 w-5 shrink-0" />
          <span className="truncate">{composerPlaceholder}</span>
        </button>

        {/* Tabs */}
        <Tabs defaultValue="chats" className="mt-6">
          <TabsList>
            <TabsTrigger value="chats" className="gap-1.5">
              <MessageSquare className="h-4 w-4" />
              {content.home.tabChats}
            </TabsTrigger>
            <TabsTrigger value="sources" className="gap-1.5">
              <FileText className="h-4 w-4" />
              {content.home.tabSources}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chats" className="mt-4">
            <ProjectChatsTab projectId={project.id} currentUserId={currentUserId} />
          </TabsContent>

          <TabsContent value="sources" className="mt-4">
            <EmptyTab
              icon={<FileText className="h-8 w-8 text-muted-foreground/40" />}
              title={toLocalizedString(content.home.sourcesEmpty)}
              hint={toLocalizedString(content.home.sourcesHint)}
              action={
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
                  <Upload className="h-3.5 w-3.5" />
                  {content.home.addSource}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                    {content.home.comingSoon}
                  </span>
                </span>
              }
            />
          </TabsContent>
        </Tabs>
      </div>

      <ShareProjectDialog open={shareOpen} onOpenChange={setShareOpen} project={project} isOwner={isOwner} />
      <ProjectSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} project={project} />
    </div>
  );
}

function ProjectChatsTab({ projectId, currentUserId }: { projectId: string; currentUserId: string }) {
  const content = useIntlayer('projects');
  const listSessions = useServerFn(listProjectSessions);
  const { data, isLoading } = useQuery({
    queryKey: ['project-sessions', projectId],
    queryFn: () => listSessions({ data: { projectId } }),
  });
  const sessions = data ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <EmptyTab
        icon={<MessageSquare className="h-8 w-8 text-muted-foreground/40" />}
        title={toLocalizedString(content.home.chatsEmpty)}
        hint={toLocalizedString(content.home.chatsEmptyHint)}
      />
    );
  }
  return (
    <div className="space-y-0.5">
      {sessions.map((s) => {
        // Show WHO started each chat — avatar (colored per owner) + name — so in a
        // shared Project you can tell A's conversations apart from B's at a glance.
        const isOwn = s.createdByUserId === currentUserId;
        const ownerName = s.createdByName?.trim() || '—';
        return (
          <Link
            key={s.id}
            to="/agents/projects/$projectId/c/$sessionId"
            params={{ projectId, sessionId: s.sdkSessionId }}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <LetterAvatar
              name={ownerName}
              iconUrl={s.createdByImage ?? undefined}
              size="sm"
              className="!size-7 !rounded-full shrink-0"
            />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-foreground/90">
                {s.title || toLocalizedString(content.rail.newChat)}
              </span>
              <span className={cn('block truncate text-xs', isOwn ? 'text-foreground/60' : 'text-muted-foreground')}>
                {ownerName}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function MemberAvatars({ project }: { project: ProjectDTO }) {
  if (!isShared(project)) return null;
  const shown = project.members.slice(0, 4);
  const extra = project.members.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((m) => (
        <LetterAvatar
          key={m.userId}
          name={m.name}
          iconUrl={m.image ?? undefined}
          size="sm"
          className="!size-7 !rounded-full ring-2 ring-background"
        />
      ))}
      {extra > 0 && (
        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground ring-2 ring-background">
          +{extra}
        </span>
      )}
    </div>
  );
}

function EmptyTab({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}
