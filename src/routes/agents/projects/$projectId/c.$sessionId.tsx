import { createFileRoute } from '@tanstack/react-router';
import { ClaudeChatController } from '~/components/claude-chat/claude-chat-controller';
import type { PermissionInfo } from '~/components/claude-chat/permission-badge';
import { getPermissionInfo } from '~/server/permissions.server';
import { ensureDefaultSkillsFn } from '~/server/function/skills.server';

/**
 * A chat INSIDE a Project: /agents/projects/$projectId/c/$sessionId.
 * Reuses the shared ClaudeChatController but hides the
 * controller's own SessionList — the ProjectsRail (parent layout) is the rail here.
 * The URL carries project + session, so the chat stays "in the project" (Projects×Chat
 * navigation unification, Phase 1). See 2026-06-09-projects-chat-nav-unification-plan.md.
 */
export const Route = createFileRoute('/agents/projects/$projectId/c/$sessionId')({
  component: ProjectChatPage,
  // ?m=<messageUuid> — conversation-search deep link target (controller scrolls + highlights).
  validateSearch: (search: Record<string, unknown>): { m?: string } => ({
    m: typeof search.m === 'string' ? search.m : undefined,
  }),
  // Same as the solo chat loader: permission + idempotent default-skills. No WS resume in SSR.
  loader: async () => {
    const [permissionInfo] = await Promise.all([
      getPermissionInfo(),
      ensureDefaultSkillsFn().catch((error) => {
        console.warn('[Skills] ensureDefaultSkills failed (non-fatal):', error);
        return null;
      }),
    ]);
    // The server-fn RPC typing widens `mode` to string; the runtime value is a PermissionMode.
    return { permissionInfo: permissionInfo as PermissionInfo };
  },
});

function ProjectChatPage() {
  const { projectId, sessionId } = Route.useParams();
  const { permissionInfo } = Route.useLoaderData();
  return (
    <ClaudeChatController
      permissionInfo={permissionInfo}
      urlSessionId={sessionId}
      projectId={projectId}
      showInternalSessionList={false}
    />
  );
}
