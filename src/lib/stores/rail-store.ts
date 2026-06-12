import { create } from 'zustand';

interface RailState {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * 副侧边栏（ProjectsRail）折叠状态（IA redesign 2026-06, prd §3）。
 * 顶栏的折叠键（SiteHeader）与 ProjectsRail 跨组件共享这一状态。
 * 内存态（刷新回到展开）——折叠是会话内临时操作；如需持久化后续再加。
 */
export const useRailStore = create<RailState>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setCollapsed: (collapsed) => set({ collapsed }),
}));
