import { createFileRoute } from '@tanstack/react-router';
import { ProjectsRail } from '~/components/projects/projects-rail';
import { ClaudeChatController } from '~/components/claude-chat/claude-chat-controller';
import type { PermissionInfo } from '~/components/claude-chat/permission-badge';
import { getPermissionInfo } from '~/server/permissions.server';
import { ensureDefaultSkillsFn } from '~/server/function/skills.server';

/**
 * Solo (loose) chat — /agents/c/$sessionId. The single chat entry's solo mode: same
 * unified rail (ProjectsRail) + the shared ClaudeChatController, driven by the URL session
 * (URL is the truth; every conversation has a URL). Project chats live at
 * /agents/projects/$projectId/c/$sessionId.
 * (Phase 2 — single chat entry + URL truth.)
 */
export const Route = createFileRoute('/agents/c/$sessionId')({
  component: SoloChatPage,
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

function SoloChatPage() {
  const { sessionId } = Route.useParams();
  const { permissionInfo } = Route.useLoaderData();
  return (
    <div className="flex h-full min-h-0">
      <ProjectsRail />
      <div className="min-h-0 flex-1">
        <ClaudeChatController
          permissionInfo={permissionInfo}
          urlSessionId={sessionId}
          showInternalSessionList={false}
        />
      </div>
    </div>
  );
}
