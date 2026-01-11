/**
 * AI Workflow Layout Route
 *
 * 这是一个纯 Layout 路由，用于渲染子路由内容。
 * 符合 TanStack Router 官方推荐的 Layout 模式。
 *
 * 目录结构：
 * - route.tsx (本文件) → Layout，包含 <Outlet />
 * - index.tsx → /agents/ai-workflow 的默认内容（WorkflowHub）
 * - pr-creator/route.tsx → /agents/ai-workflow/pr-creator
 */

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/agents/ai-workflow')({
  component: LayoutComponent,
});

/**
 * Layout 组件
 *
 * 根据官方文档：
 * - Layout Routes 用于包装子路由的组件和逻辑
 * - <Outlet /> 渲染下一个匹配的子路由
 * - 如果没有子路由匹配，<Outlet /> 返回 null（但这里会匹配 index.tsx）
 */
function LayoutComponent() {
  return <Outlet />;
}
