/**
 * Workbench UI store — open/closed state for the right-side workbench.
 *
 * Lives in a shared store (not component state) because two far-apart parts of the
 * tree drive it: the chat composer's「会话文件」button TOGGLES it, and the
 * controller's WorkbenchDock (a sibling of the chat surface) RENDERS from it. This is
 * a UI preference, NOT session data, so it persists across sessions via localStorage
 * and is deliberately separate from the per-session chat store.
 *
 * SSR-safe: defaults to closed on the server + initial client render (collapsed by
 * default — more chat space), then `hydrate()` restores the user's last choice on mount.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'kin.workbench.open';

interface WorkbenchUIState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Restore the persisted choice (call once on the client, e.g. in a mount effect). */
  hydrate: () => void;
}

export const useWorkbenchUI = create<WorkbenchUIState>((set, get) => ({
  open: false,
  setOpen: (open) => {
    set({ open });
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {
      /* localStorage unavailable */
    }
  },
  toggle: () => get().setOpen(!get().open),
  hydrate: () => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') set({ open: true });
    } catch {
      /* ignore */
    }
  },
}));
