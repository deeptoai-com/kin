/**
 * Ask-mode HITL approval prompt.
 *
 * Renders the session's pending tool-approval requests (from the store, pushed by
 * the worker via `approval_request`). Approve/Reject → respondApproval() sends the
 * decision back to the worker's canUseTool. Only visible in Ask mode (the worker
 * only emits approval_request when permissionMode is 'default').
 */

import type { FC } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useChatSessionStore, type ApprovalRequest } from '~/lib/chat-session-store';
import { respondApproval } from '~/claude/adapters';

function summarizeInput(input?: Record<string, unknown>): string {
  if (!input || typeof input !== 'object') return '';
  const fp = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof fp === 'string') return fp;
  const cmd = input.command;
  if (typeof cmd === 'string') return cmd.length > 140 ? `${cmd.slice(0, 140)}…` : cmd;
  try {
    const s = JSON.stringify(input);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  } catch {
    return '';
  }
}

function heading(req: ApprovalRequest): string {
  return req.title || req.displayName || `运行工具:${req.toolName}`;
}

export const ApprovalPrompt: FC = () => {
  const pending = useChatSessionStore((s) => s.pendingApprovals);
  if (!pending.length) return null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-2 pb-2">
      {pending.map((req) => {
        const detail = req.description || summarizeInput(req.input);
        return (
          <div
            key={req.toolUseID}
            className="rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  {heading(req)}
                </div>
                {detail && (
                  <div className="mt-0.5 truncate font-mono text-xs text-amber-800 dark:text-amber-300">
                    {detail}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void respondApproval(req.toolUseID, 'deny')}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" /> 拒绝
                </button>
                <button
                  type="button"
                  onClick={() => void respondApproval(req.toolUseID, 'allow')}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" /> 批准
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
