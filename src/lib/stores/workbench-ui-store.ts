/**
 * Workbench UI store — open/closed + active tab for the right-side workbench.
 *
 * Lives in a shared store (not component state) because several far-apart parts drive
 * it: the chat composer's icons OPEN it to a tab (会话文件→Files, info→Context), an
 * always-mounted watcher AUTO-OPENS it on Progress/Sub-agents activity, and the
 * controller's WorkbenchDock RENDERS from it. UI preference, not session data → the
 * open/closed choice persists across sessions via localStorage.
 *
 * SSR-safe: defaults to closed on the server + initial client render, then `hydrate()`
 * restores the user's last choice on mount.
 */

import { create } from 'zustand';

export type WorkbenchTab = 'progress' | 'subagents' | 'files' | 'context' | 'retrieval';

const STORAGE_KEY = 'kin.workbench.open';

interface WorkbenchUIState {
  open: boolean;
  activeTab: WorkbenchTab;
  /** Set when the user manually closes THIS turn → suppress auto-open until next turn. */
  suppressed: boolean;
  setOpen: (open: boolean) => void;
  /** Switch the active tab (used by the workbench's own tab bar). */
  setTab: (tab: WorkbenchTab) => void;
  /** Composer entry buttons: open + go to tab; if already open ON that tab, close it. */
  openTab: (tab: WorkbenchTab) => void;
  /** Auto-open to a tab on Progress/Sub-agents — UNLESS already open or suppressed. */
  autoOpen: (tab: WorkbenchTab) => void;
  /** Manual close (collapse button / toggle-off): close + suppress auto-open this turn. */
  close: () => void;
  /** A new turn started → allow auto-open again. */
  resetSuppress: () => void;
  hydrate: () => void;
}

function persist(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    /* localStorage unavailable */
  }
}

export const useWorkbenchUI = create<WorkbenchUIState>((set, get) => ({
  open: false,
  activeTab: 'files',
  suppressed: false,
  setOpen: (open) => {
    set({ open });
    persist(open);
  },
  setTab: (tab) => set({ activeTab: tab }),
  openTab: (tab) => {
    const { open, activeTab } = get();
    if (open && activeTab === tab) {
      // Clicking the icon for the tab you're already on closes the workbench.
      set({ open: false, suppressed: true });
      persist(false);
    } else {
      set({ open: true, activeTab: tab, suppressed: false });
      persist(true);
    }
  },
  autoOpen: (tab) => {
    const { open, suppressed } = get();
    if (open || suppressed) return;
    set({ open: true, activeTab: tab });
    persist(true);
  },
  close: () => {
    set({ open: false, suppressed: true });
    persist(false);
  },
  resetSuppress: () => set({ suppressed: false }),
  hydrate: () => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') set({ open: true });
    } catch {
      /* ignore */
    }
  },
}));
