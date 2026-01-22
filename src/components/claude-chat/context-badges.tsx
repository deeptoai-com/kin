/**
 * Context Badges Component
 *
 * Displays active Skills and MCP Sources badges in the chat input area.
 * Helps users understand the current context sources.
 *
 * Aligned with Craft's ActiveOptionBadges pattern.
 */

import { type FC, useMemo } from 'react';
import { Badge } from '~/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';
import type { SessionMetadata, McpServerStatus } from './session-info-panel';

interface ContextBadgesProps {
  sessionMetadata: SessionMetadata | null;
  maxVisible?: number;
}

/**
 * Extract display name from MCP server entry
 * Handles both string and McpServerStatus object formats
 */
function getMcpDisplayName(item: string | McpServerStatus): string {
  if (typeof item === 'string') return item;
  return item.name || 'unknown';
}

/**
 * Context Badges - Shows active Skills and MCP sources
 */
export const ContextBadges: FC<ContextBadgesProps> = ({
  sessionMetadata,
  maxVisible = 5,
}) => {
  // Extract skills
  const skills = useMemo(() => {
    if (!sessionMetadata?.skills) return [];
    return sessionMetadata.skills.filter(Boolean);
  }, [sessionMetadata?.skills]);

  // Extract MCP servers
  const mcpServers = useMemo(() => {
    if (!sessionMetadata?.mcp_servers) return [];
    return sessionMetadata.mcp_servers
      .map(getMcpDisplayName)
      .filter(Boolean);
  }, [sessionMetadata?.mcp_servers]);

  // Combine all items for display
  const allItems = useMemo(() => {
    const items: Array<{ type: 'skill' | 'mcp'; name: string }> = [];
    skills.forEach((name) => items.push({ type: 'skill', name }));
    mcpServers.forEach((name) => items.push({ type: 'mcp', name }));
    return items;
  }, [skills, mcpServers]);

  // Don't render if no items
  if (allItems.length === 0) return null;

  // Split into visible and overflow
  const visibleItems = allItems.slice(0, maxVisible);
  const overflowCount = allItems.length - maxVisible;
  const overflowItems = overflowCount > 0 ? allItems.slice(maxVisible) : [];
  const overflowLabel = overflowItems
    .map((item) => `${item.type === 'skill' ? 'Skill' : 'MCP'}: ${item.name}`)
    .join('\n');

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleItems.map((item, index) => (
        <Badge
          key={`${item.type}-${item.name}-${index}`}
          variant="secondary"
          className="text-[10px] px-1.5 py-0 h-5 font-normal"
        >
          {item.type === 'skill' ? (
            <span title={`Skill: ${item.name}`}>
              <span className="opacity-60">Skill:</span> {item.name}
            </span>
          ) : (
            <span title={`MCP: ${item.name}`}>
              <span className="opacity-60">MCP:</span> {item.name}
            </span>
          )}
        </Badge>
      ))}

      {overflowCount > 0 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-5 font-normal cursor-help"
              >
                +{overflowCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap text-xs">
              {overflowLabel}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

export default ContextBadges;
