'use client';

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '~/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '~/components/ui/dialog';
import { useProjects } from '~/lib/hooks/use-projects';
import { searchMessagesFn, type MessageSearchResult } from '~/server/function/message-search.server';
import { renderSnippetHtml } from '~/lib/search-highlight';

interface SessionRow {
  id: string;
  sdkSessionId: string;
  title: string | null;
  projectId: string | null;
}

// Same styling cmdk wrapper as CommandDialog, but we drive filtering ourselves (shouldFilter
// is off): the title group filters client-side, the message group comes pre-filtered from Meili.
const COMMAND_CLASS =
  "[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2";

/**
 * ⌘K conversation search — dual mode (IA redesign §4 + 对话历史检索 PRD).
 *  - 标题: instant client-side filter over the user's sessions.
 *  - 正文: debounced full-text search over message bodies (Meili, access-isolated server fn),
 *    with highlighted snippets; selecting one deep-links to that message (?m=) which the
 *    chat controller scrolls to + highlights.
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
  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? null : null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 220);
    return () => clearTimeout(t);
  }, [query]);

  // Title search: every accessible session (loose + project), filtered client-side.
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
  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const titleMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? sessions.filter((s) => `${s.title ?? ''} ${projectName(s.projectId) ?? ''}`.toLowerCase().includes(q))
      : sessions;
    return list.slice(0, 8);
    // projectName depends on `projects`; recompute when either changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sessions, projects]);

  // Body search: access-isolated Meili server fn, debounced.
  const search = useServerFn(searchMessagesFn);
  const trimmed = debouncedQuery.trim();
  const { data: msgData, isFetching: msgLoading } = useQuery({
    queryKey: ['message-search', trimmed],
    queryFn: () => search({ data: { query: trimmed, limit: 10 } }),
    enabled: open && trimmed.length >= 2,
    staleTime: 15_000,
  });
  const messageResults: MessageSearchResult[] = msgData?.results ?? [];
  const degraded = msgData?.degraded ?? false;

  const goTitle = (s: SessionRow) => {
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

  const goMessage = (r: MessageSearchResult) => {
    onOpenChange(false);
    if (r.projectId) {
      navigate({
        to: '/agents/projects/$projectId/c/$sessionId',
        params: { projectId: r.projectId, sessionId: r.sessionId },
        search: { m: r.messageId },
      });
    } else {
      navigate({ to: '/agents/c/$sessionId', params: { sessionId: r.sessionId }, search: { m: r.messageId } });
    }
  };

  const hint = (text: string) => <div className="px-2 py-3 text-center text-xs text-muted-foreground">{text}</div>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>搜索对话</DialogTitle>
        <DialogDescription>按标题或消息正文搜索你的对话</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0" showCloseButton>
        <Command shouldFilter={false} className={COMMAND_CLASS}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="搜索对话…（标题 + 消息正文）" />
          <CommandList>
            <CommandGroup heading="对话（标题）">
              {titleMatches.length === 0
                ? hint(isLoading ? '加载中…' : '无匹配标题')
                : titleMatches.map((s) => {
                    const pname = projectName(s.projectId);
                    return (
                      <CommandItem key={`title-${s.id}`} value={`title-${s.id}`} onSelect={() => goTitle(s)}>
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className="truncate text-sm">{s.title || '新对话'}</span>
                          {pname && <span className="shrink-0 text-xs text-muted-foreground">{pname}</span>}
                        </div>
                      </CommandItem>
                    );
                  })}
            </CommandGroup>

            <CommandGroup heading="消息（正文）">
              {trimmed.length < 2
                ? hint('输入关键词搜索消息正文')
                : degraded
                  ? hint('搜索暂不可用')
                  : msgLoading && messageResults.length === 0
                    ? hint('搜索中…')
                    : messageResults.length === 0
                      ? hint('未找到消息')
                      : messageResults.map((r) => (
                          <CommandItem
                            key={`msg-${r.sessionId}-${r.messageId}`}
                            value={`msg-${r.sessionId}-${r.messageId}`}
                            onSelect={() => goMessage(r)}
                          >
                            <div className="flex w-full flex-col gap-1">
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-xs text-muted-foreground">{r.title || '新对话'}</span>
                                <span className="flex shrink-0 items-center gap-2">
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {r.role === 'user' ? '我' : '助手'}
                                  </span>
                                  {r.createdAt > 0 && (
                                    <span className="text-[10px] text-muted-foreground">
                                      {new Date(r.createdAt).toLocaleDateString()}
                                    </span>
                                  )}
                                </span>
                              </div>
                              {/* Snippet HTML is escaped then re-marked in renderSnippetHtml (XSS-safe). */}
                              <span
                                className="line-clamp-2 text-sm [&_mark]:bg-primary/20 [&_mark]:text-foreground"
                                dangerouslySetInnerHTML={{ __html: renderSnippetHtml(r.snippet) }}
                              />
                            </div>
                          </CommandItem>
                        ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
