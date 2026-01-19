import { createFileRoute } from '@tanstack/react-router';
import { listAllMcpsFn } from '~/server/function/mcp.server';
import { McpPageComponent } from '~/components/mcp/mcp-page';
import type { ExtendedMcpInfo } from '~/claude/mcp';

export const Route = createFileRoute('/agents/mcp')({
  loader: async () => {
    const result = await listAllMcpsFn();
    // Defensive: ensure arrays are never undefined
    const official = result.official || [];
    const system = result.system || [];
    const user = result.user || [];
    const allMcps: ExtendedMcpInfo[] = [
      ...official,
      ...system,
      ...user,
    ];

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
    const customCount = systemMcps.length + userMcps.length;

    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">MCP Store</h1>
            <p className="text-sm text-muted-foreground">
              Manage MCP servers ({allMcps.length} total, {customCount} custom)
            </p>
          </div>
        </div>

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
