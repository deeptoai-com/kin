import { createFileRoute } from '@tanstack/react-router';
import { ClaudeChatController } from '~/components/claude-chat/claude-chat-controller';
import type { PermissionInfo } from '~/components/claude-chat/permission-badge';
import { getPermissionInfo } from '~/server/permissions.server';
import { ensureDefaultSkillsFn } from '~/server/function/skills.server';

/**
 * "New chat IN this project": /agents/projects/$projectId/c (no sessionId yet).
 * The project home's "new chat" button lands here. Lazy-create (Phase 2 P1.5): nothing is
 * created on landing — the first send creates the session bound to THIS project (the URL
 * carries the project context into create_session{projectId}), then onSessionInit mirrors
 * the URL to /agents/projects/$projectId/c/$newId.
 * (Projects×Chat unification, Phase 1 fix.)
 */
export const Route = createFileRoute('/agents/projects/$projectId/c/')({
  component: NewProjectChatPage,
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

function NewProjectChatPage() {
  const { projectId } = Route.useParams();
  const { permissionInfo } = Route.useLoaderData();
  // No urlSessionId yet: this is the project new-chat landing. `newChat` arms the lazy
  // first-send create even if the pendingProjectId arm is absent (direct URL / refresh),
  // while projectId ensures that create binds the session to this project.
  return (
    <ClaudeChatController
      permissionInfo={permissionInfo}
      projectId={projectId}
      newChat
      showInternalSessionList={false}
    />
  );
}
