import { createFileRoute } from '@tanstack/react-router';
import { ProjectsRail } from '~/components/projects/projects-rail';
import { ClaudeChatController } from '~/components/claude-chat/claude-chat-controller';
import type { PermissionInfo } from '~/components/claude-chat/permission-badge';
import { getPermissionInfo } from '~/server/permissions.server';
import { ensureDefaultSkillsFn } from '~/server/function/skills.server';

/**
 * New solo chat landing — /agents/c. No sessionId yet: the controller (newChat) shows a
 * blank composer WITHOUT creating anything (lazy-create, Phase 2 P1.5). The session is
 * created on the first send, then onSessionInit mirrors the URL to /agents/c/$newId.
 * The single chat entry's "new chat" button lands here. (Phase 2 — single entry + URL truth.)
 */
export const Route = createFileRoute('/agents/c/')({
  component: NewSoloChatPage,
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

function NewSoloChatPage() {
  const { permissionInfo } = Route.useLoaderData();
  return (
    <div className="flex h-full min-h-0">
      <ProjectsRail />
      <div className="min-h-0 flex-1">
        <ClaudeChatController permissionInfo={permissionInfo} newChat showInternalSessionList={false} />
      </div>
    </div>
  );
}
