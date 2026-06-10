'use client';

/**
 * useSessionBranchInfo — the frontend's view of the CURRENT session's branch state
 * (Projects C#2, 续聊即分支 UX). Fed by the session DB row (now member-readable after the
 * A2 resolver sweep), since session_init/session_metadata don't carry owner/lineage.
 *
 * Drives two UI affordances (ChatGPT parity):
 *  - viewing a session you DON'T own → "发表回复将创建你的分支" banner (reply will branch)
 *  - this session IS a branch → "从 <源标题> 建立的分支" indicator
 */

import { useQuery } from '@tanstack/react-query';

interface SessionRow {
  id: string;
  userId: string;
  title: string | null;
  projectId: string | null;
  branchedFromSessionId: string | null;
  ownerName?: string | null;
  ownerImage?: string | null;
}

export interface SessionBranchInfo {
  /** Current user is not the session owner → a reply will fork (branch-on-reply). */
  isViewingNonOwned: boolean;
  /** This session is itself a branch — carries the source's title (may be null while loading). */
  branchedFrom: { title: string | null } | null;
  /** Owner of the CURRENT session (name + avatar) = author of its non-inherited turns. */
  owner: { name: string | null; image: string | null } | null;
  /** Owner of the SOURCE session = author of inherited turns. Null unless this is a branch. */
  sourceOwner: { name: string | null; image: string | null } | null;
  isLoading: boolean;
}

async function fetchSessionBySdkId(sdkSessionId: string): Promise<SessionRow | null> {
  const res = await fetch(`/api/agent-sessions/by-sdk-id/${encodeURIComponent(sdkSessionId)}`);
  if (!res.ok) return null;
  return (await res.json()) as SessionRow;
}

async function fetchSessionById(id: string): Promise<SessionRow | null> {
  const res = await fetch(`/api/agent-sessions/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as SessionRow;
}

export function useSessionBranchInfo(
  sdkSessionId: string | null,
  currentUserId: string | null | undefined,
): SessionBranchInfo {
  const sessionQuery = useQuery({
    queryKey: ['session-branch-meta', sdkSessionId],
    queryFn: () => fetchSessionBySdkId(sdkSessionId as string),
    enabled: !!sdkSessionId,
    staleTime: 30_000,
  });

  const session = sessionQuery.data ?? null;
  const branchedFromId = session?.branchedFromSessionId ?? null;

  // Resolve the source title only when this session is a branch.
  const sourceQuery = useQuery({
    queryKey: ['session-branch-source', branchedFromId],
    queryFn: () => fetchSessionById(branchedFromId as string),
    enabled: !!branchedFromId,
    staleTime: 30_000,
  });

  return {
    isViewingNonOwned: !!session && !!currentUserId && session.userId !== currentUserId,
    branchedFrom: branchedFromId ? { title: sourceQuery.data?.title ?? null } : null,
    owner: session ? { name: session.ownerName ?? null, image: session.ownerImage ?? null } : null,
    sourceOwner: branchedFromId
      ? { name: sourceQuery.data?.ownerName ?? null, image: sourceQuery.data?.ownerImage ?? null }
      : null,
    isLoading: sessionQuery.isLoading || (!!branchedFromId && sourceQuery.isLoading),
  };
}
