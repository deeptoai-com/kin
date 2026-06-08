/**
 * Auto-rebuild the running preview when the agent finishes a turn that edited the
 * app's source.
 *
 * Why: preview is build mode (static serve of `dist`, no HMR), so code changes only
 * become visible after a rebuild. Rather than make the user click "重新构建" every
 * time, we trigger a force-rebuild automatically — but ONLY at a coherent boundary.
 *
 * Trigger = agent turn completion (isRunning true→false), NOT per-edit: mid-turn the
 * code is often a half-applied, broken intermediate state, so building then would
 * fail or show garbage. Turn-end means the agent finished a self-contained change.
 *
 * Gates (all must hold):
 *  1. A preview is currently up (`previewState.status === 'ready'`) for THIS session.
 *  2. The just-finished turn touched ≥1 file via Write/Edit/MultiEdit/NotebookEdit
 *     that isn't in an excluded dir (node_modules / dist / build / .oxygenie /
 *     .uploads / .git). (Bash-written changes aren't tracked here — those fall back
 *     to the manual "重新构建" button.)
 *
 * The server coalesces concurrent rebuilds (inFlight guard) and the force-rebuild is
 * the same primitive the manual button uses, so this is safe to fire optimistically.
 */
import { useEffect, useRef } from 'react';
import { useChatSessionStore, type ThreadMessage } from '~/lib/chat-session-store';
import { startPreview } from '~/claude/adapters';

const FILE_EDIT_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit']);
// Dirs whose churn should NOT trigger a rebuild (install output, build output,
// preview internals, uploads, vcs).
const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|\.oxygenie|\.uploads|\.git)(\/|$)/;

function turnEditedAppFiles(message: ThreadMessage): boolean {
  for (const part of message.content) {
    if (part.type !== 'tool-call') continue;
    if (!FILE_EDIT_TOOLS.has(part.toolName.toLowerCase())) continue;
    const args = (part.args ?? {}) as Record<string, unknown>;
    const fp =
      (typeof args.file_path === 'string' && args.file_path) ||
      (typeof args.path === 'string' && args.path) ||
      (typeof args.notebook_path === 'string' && args.notebook_path) ||
      '';
    if (fp && !EXCLUDED_DIR.test(fp)) return true;
  }
  return false;
}

export function usePreviewAutoRebuild(): void {
  const isRunning = useChatSessionStore((s) => s.isRunning);
  // Seed with the current value so we never fire on mount — only on a real
  // true→false transition (an actual turn finishing).
  const prevRunning = useRef(isRunning);

  useEffect(() => {
    const was = prevRunning.current;
    prevRunning.current = isRunning;
    if (!was || isRunning) return; // only the moment a turn ends

    const state = useChatSessionStore.getState();
    const preview = state.previewState;
    if (!preview || preview.status !== 'ready') return;
    if (preview.sessionId !== state.currentSessionId) return;

    // The store coalesces a turn into a single assistant message, so the last
    // assistant message IS the just-finished turn.
    const lastTurn = [...state.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastTurn || !turnEditedAppFiles(lastTurn)) return;

    void startPreview(undefined, 'static', { force: true }).catch(() => {});
  }, [isRunning]);
}
