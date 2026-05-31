/**
 * MCP Status Indicator Component
 *
 * Displays real-time MCP server connection status in the chat header.
 * Shows status indicators (connected/failed/pending) with tooltips.
 */

import type { FC } from 'react';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'pending';
  error?: string;
  tool_count?: number;
}

interface McpStatusIndicatorProps {
  className?: string;
}

export const McpStatusIndicator: FC<McpStatusIndicatorProps> = ({ className = '' }) => {
  const currentToolName = useChatSessionStore((state) => state.currentToolName);
  const agentStatus = useChatSessionStore((state) => state.agentStatus);

  if (!currentToolName || !currentToolName.startsWith('mcp__') || agentStatus !== 'toolUse') {
    return null;
  }

  const parts = currentToolName.split('__');
  const server = parts[1] || 'mcp';
  const tool = parts.length > 2 ? parts.slice(2).join('__') : '';
  const tooltipLabel = tool ? `${server} · ${tool}` : server;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`flex items-center gap-1.5 text-xs ${className}`}>
          <span className="text-emerald-500 animate-pulse" aria-hidden="true">●</span>
          <span className="text-muted-foreground">MCP</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="text-muted-foreground">MCP 正在工作</div>
        <div className="font-mono text-[11px]">{tooltipLabel}</div>
      </TooltipContent>
    </Tooltip>
  );
};

interface McpStatusPopoverProps {
  className?: string;
}

/**
 * Expanded MCP status display with all servers listed
 */
export const McpStatusPopover: FC<McpStatusPopoverProps> = ({ className = '' }) => {
  const sessionMetadata = useChatSessionStore((state) => state.sessionMetadata);
  const mcpServers = sessionMetadata?.mcp_servers;

  if (!mcpServers || mcpServers.length === 0) {
    return null;
  }

  const servers: McpServerStatus[] = mcpServers.map((s) => {
    if (typeof s === 'string') {
      return { name: s, status: 'pending' as const };
    }
    return s;
  });

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {servers.map((server) => {
        const statusIndicator = server.status === 'connected' ? '🟢' :
          server.status === 'failed' ? '🔴' :
          server.status === 'pending' ? '🟡' : '⚪';

        const toolCount = server.tool_count !== undefined
          ? ` (${server.tool_count} tools)`
          : '';

        const errorSuffix = server.error
          ? ` - ${server.error}`
          : '';

        return (
          <div key={server.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{statusIndicator}</span>
            <span>{server.name}</span>
            <span className="text-muted-foreground">{toolCount}</span>
            {server.error && (
              <span className="text-destructive" title={server.error}>⚠️</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
