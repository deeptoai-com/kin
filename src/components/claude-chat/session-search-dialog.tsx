'use client';

import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '~/components/ui/command';
import { useProjects } from '~/lib/hooks/use-projects';

interface SessionRow {
  id: string;
  sdkSessionId: string;
  title: string | null;
  projectId: string | null;
}

/**
 * ⌘K conversation search (IA redesign 2026-06, prd/2026-06-navigation-ia-redesign §4).
 * Phase 1: title + project filter over the user's sessions (cmdk filters client-side on
 * the CommandItem `value`). Full-text over message bodies (Meili) is a later enhancement.
 */
export function SessionSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const projectName = (id: string | null) =>
    id ? projects.find((p) => p.id === id)?.name ?? null : null;

  // Not scoped to loose: this lists every accessible session (loose + project chats).
  const { data, isLoading } = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ['agent-sessions', 'search-all'],
    queryFn: async () => {
      const res = await fetch('/api/agent-sessions?limit=100');
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });
  const sessions = data?.sessions ?? [];

  const go = (s: SessionRow) => {
    onOpenChange(false);
    if (s.projectId) {
      navigate({
        to: '/agents/projects/$projectId/c/$sessionId',
        params: { projectId: s.projectId, sessionId: s.sdkSessionId },
      });
    } else {
      navigate({ to: '/agents/c/$sessionId', params: { sessionId: s.sdkSessionId } });
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="搜索对话"
      description="按标题或项目搜索你的对话"
    >
      <CommandInput placeholder="搜索对话…" />
      <CommandList>
        <CommandEmpty>{isLoading ? '加载中…' : '未找到对话'}</CommandEmpty>
        <CommandGroup heading="近期对话">
          {sessions.map((s) => {
            const pname = projectName(s.projectId);
            return (
              <CommandItem
                key={s.id}
                value={`${s.title ?? ''} ${pname ?? ''} ${s.id}`}
                onSelect={() => go(s)}
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="truncate text-sm">{s.title || '新对话'}</span>
                  {pname && (
                    <span className="shrink-0 text-xs text-muted-foreground">{pname}</span>
                  )}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
