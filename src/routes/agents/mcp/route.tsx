import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Legacy route — MCP moved into the unified Capability Center.
 * Redirect to /agents/capabilities with the MCP tab preselected.
 */
export const Route = createFileRoute('/agents/mcp')({
  beforeLoad: () => {
    throw redirect({ to: '/agents/capabilities', search: { tab: 'mcp' } });
  },
});
