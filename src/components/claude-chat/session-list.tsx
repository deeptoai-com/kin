/**
 * Session List Component
 *
 * Displays a list of chat sessions.
 * Fetches sessions from /api/agent-sessions endpoint.
 * Supports expand/collapse functionality for better space utilization.
 */

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, MessageSquare, PanelLeftClose } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { SessionItem, type SessionItemData } from './session-item';
import { cn, toLocalizedString } from '~/lib/utils';

interface SessionListResponse {
  sessions: SessionItemData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface SessionListProps {
  currentSessionId: string | null;
  onSelectSession: (sdkSessionId: string) => void;
  onNewSession: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export function SessionList({
  currentSessionId,
  onSelectSession,
  onNewSession,
  isExpanded,
  onToggleExpanded,
}: SessionListProps) {
  const content = useIntlayer('claude-chat');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<SessionListResponse>({
    // Loose chats only — project chats live inside their Project (ProjectsRail / project chat
    // route), so the loose rail no longer mixes them in (Projects×Chat unification, Phase 1).
    queryKey: ['agent-sessions', 'loose-list'],
    queryFn: async () => {
      const res = await fetch('/api/agent-sessions?scope=loose&limit=50');
      if (!res.ok) {
        throw new Error('Failed to fetch sessions');
      }
      return res.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const sessions = data?.sessions ?? [];

  // Handle title update
  const handleUpdateTitle = async (id: string, title: string) => {
    try {
      const res = await fetch(`/api/agent-sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        throw new Error('Failed to update title');
      }
      // Invalidate cache to refresh list
      queryClient.invalidateQueries({ queryKey: ['agent-sessions'] });
    } catch (error) {
      console.error('Failed to update session title:', error);
    }
  };

  // Handle session deletion
  const handleDelete = async (id: string) => {
    try {
      // Find the session being deleted
      const sessionToDelete = sessions.find((s) => s.id === id);
      const isCurrentSession = sessionToDelete?.sdkSessionId === currentSessionId;

      const res = await fetch(`/api/agent-sessions/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete session');
      }

      // Invalidate cache to refresh list
      queryClient.invalidateQueries({ queryKey: ['agent-sessions'] });

      // If we deleted the current session, create a new one
      if (isCurrentSession) {
        onNewSession();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      throw error; // Re-throw to let SessionItem handle the error
    }
  };

  return (
    <div
      className={cn(
        'flex h-full flex-col transition-all duration-300 ease-in-out border-r border-sidebar-border bg-sidebar',
        isExpanded ? 'w-64' : 'w-0 overflow-hidden'
      )}
    >
      {isExpanded ? (
        <>
          {/* Header: New Chat (primary) + collapse toggle (sidebar owns its own collapse) */}
          <div className="flex shrink-0 items-center gap-2 border-b p-3">
            <button
              type="button"
              onClick={onNewSession}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5',
                'bg-primary text-primary-foreground text-sm font-medium',
                'transition-colors hover:bg-primary/90',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
            >
              <Plus className="h-4 w-4" />
              <span>{content.sessionList.newChat}</span>
            </button>
            <button
              type="button"
              onClick={onToggleExpanded}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sidebar-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={toLocalizedString(content.sidebar.collapse)}
              title={toLocalizedString(content.sidebar.collapse)}
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* Session list - fixed height with scroll */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
                {content.sessionList.loadError}
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {content.sessionList.noConversations}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {content.sessionList.startNewChat}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.sdkSessionId === currentSessionId}
                    onClick={() => onSelectSession(session.sdkSessionId)}
                    onUpdateTitle={handleUpdateTitle}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer with session count */}
          {sessions.length > 0 && (
            <div className="shrink-0 border-t px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {toLocalizedString(content.sessionList.conversations).replace('{count}', String(sessions.length))}
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Hook to invalidate session list cache
 * Call this after creating a new session or updating a session
 */
export function useInvalidateSessions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'agent-sessions',
  });
}
