import { createFileRoute } from '@tanstack/react-router';
import { listAllMcpsFn } from '~/server/function/mcp.server';
import { McpPageComponent } from '~/components/mcp/mcp-page';
import type { ExtendedMcpInfo } from '~/claude/mcp';

/**
 * MCP Management Route - New List-Based Design
 *
 * Displays all MCPs in two groups: Installed and Recommended
 * - Installed: MCPs that the user has enabled
 * - Recommended: All other available MCPs
 *
 * Custom MCPs (system or personal) can be deleted.
 * Official MCPs cannot be deleted.
 */
export const Route = createFileRoute('/agents/mcp')({
  loader: async () => {
    const result = await listAllMcpsFn();
    const official = result.official || [];
    const system = result.system || [];
    const user = result.user || [];
    const allMcps: ExtendedMcpInfo[] = [...official, ...system, ...user];

    return {
      officialMcps: official,
      systemMcps: system,
      userMcps: user,
      allMcps,
    };
  },
  component: () => {
    const { officialMcps, systemMcps, userMcps, allMcps } = Route.useLoaderData();
    const enabledMcps = allMcps.filter((mcp) => mcp.enabled).map((mcp) => mcp.slug);

    return (
      <div className="container mx-auto px-6 py-8 max-w-6xl">
        <McpPageComponent
          mcps={officialMcps}
          systemMcps={systemMcps}
          userMcps={userMcps}
          enabledMcps={enabledMcps}
        />
      </div>
    );
  },
});
