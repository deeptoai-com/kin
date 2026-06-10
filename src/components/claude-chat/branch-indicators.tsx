'use client';

import { GitBranch } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { cn, toLocalizedString } from '~/lib/utils';

/**
 * Branch-on-reply UX affordances (Projects C#2, ChatGPT parity). Presentational only —
 * the chat surface drives them from useSessionBranchInfo.
 */

/** 图1: shown above the composer when viewing a session you don't own → reply will branch. */
export function BranchReplyBanner({ className }: { className?: string }) {
  const content = useIntlayer('projects');
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2',
        'text-xs text-muted-foreground',
        className
      )}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      <span>{content.branch.replyWillBranch}</span>
    </div>
  );
}

/** 图2: "— 从 <源标题> 建立的分支 —" divider, marking where a branch diverges from its source. */
export function BranchedFromDivider({
  sourceTitle,
  className,
}: {
  sourceTitle: string | null;
  className?: string;
}) {
  const content = useIntlayer('projects');
  const title = sourceTitle?.trim() || toLocalizedString(content.branch.untitledSource);
  const label = toLocalizedString(content.branch.fromSource).replace('{title}', title);
  return (
    <div className={cn('flex items-center gap-3 py-2', className)} role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GitBranch className="h-3 w-3" />
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
