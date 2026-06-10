import { Outlet, createFileRoute } from '@tanstack/react-router';

/**
 * Project layout (pass-through). The ChatNav rail lives in the parent
 * `/agents/projects` layout; this just nests the project's children:
 *   - index            → project home (sources / instructions / chats)
 *   - c/$sessionId      → a chat INSIDE this project (keeps project context in the URL)
 * Part of the Projects×Chat navigation unification (Phase 1, Codex Q7).
 */
export const Route = createFileRoute('/agents/projects/$projectId')({
  component: ProjectLayout,
});

function ProjectLayout() {
  return <Outlet />;
}
