/**
 * MCP Configuration Resolver for Mastra
 *
 * Converts Claude Agent MCP configurations to Mastra MCPClient format.
 * Enables sharing MCP configurations between Claude Agent SDK and Mastra SDK.
 */

import { MCPClient } from '@mastra/mcp';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - manager.js is a JavaScript module without type declarations
import { resolveMcpServerConfigs } from '~/claude/mcp/manager.js';

/**
 * MCP server configuration types from Claude Agent format
 */
interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface HttpServerConfig {
  type: 'sse' | 'http';
  url: string;
  headers?: Record<string, string>;
}

type ServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Mastra MCPClient server configuration format
 */
interface MastraMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: URL;
  requestInit?: {
    headers?: Record<string, string>;
  };
}

/**
 * Convert Claude Agent MCP config to Mastra MCPClient format
 */
function convertToMastraFormat(
  serverName: string,
  config: ServerConfig
): MastraMcpServerConfig | null {
  // stdio type: has command property (no type field)
  if ('command' in config && config.command) {
    return {
      command: config.command,
      args: config.args,
      env: config.env,
    };
  }

  // http/sse type: has type and url fields
  if ('type' in config && 'url' in config && config.url) {
    return {
      url: new URL(config.url),
      requestInit: config.headers
        ? { headers: config.headers }
        : undefined,
    };
  }

  console.warn(`[Mastra MCP] Unsupported config for ${serverName}:`, config);
  return null;
}

/**
 * Create Mastra MCPClient from user's enabled MCP configurations
 *
 * @param userId - User ID to resolve MCP configs for
 * @returns MCPClient instance with all enabled servers, or null if no servers enabled
 */
export async function createMcpClientForUser(
  userId: string
): Promise<MCPClient | null> {
  // Resolve user's enabled MCP configurations using existing logic
  // The manager.js function accepts { userId, userHome, sdkServers }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (resolveMcpServerConfigs as any)({ userId }) as {
    mcpServers: Record<string, unknown>;
    allowedTools: string[];
  };
  const { mcpServers } = result;

  const serverNames = Object.keys(mcpServers);
  if (serverNames.length === 0) {
    return null;
  }

  // Convert to Mastra format
  const mastraServers: Record<string, MastraMcpServerConfig> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    const converted = convertToMastraFormat(name, config as ServerConfig);
    if (converted) {
      mastraServers[name] = converted;
    }
  }

  if (Object.keys(mastraServers).length === 0) {
    return null;
  }

  // Create MCPClient with all servers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new MCPClient({
    servers: mastraServers as Record<string, any>,
  });

  return client;
}

/**
 * Get tools from MCPClient for Mastra Agent
 *
 * @param client - MCPClient instance
 * @returns Tool record for Mastra Agent
 */
export async function getToolsFromMcpClient(
  client: MCPClient
): Promise<Record<string, unknown>> {
  try {
    // Connect and get all tools from all configured servers
    // listTools() returns tools namespaced by server name
    const tools = await client.listTools();
    return tools;
  } catch (error) {
    console.error('[Mastra MCP] Failed to get tools:', error);
    return {};
  }
}

/**
 * Create MCPClient and get tools in one step
 *
 * @param userId - User ID
 * @returns Object with tools and cleanup function
 */
export async function getMcpToolsForUser(userId: string): Promise<{
  tools: Record<string, unknown>;
  cleanup: () => Promise<void>;
}> {
  const client = await createMcpClientForUser(userId);

  if (!client) {
    return {
      tools: {},
      cleanup: async () => {},
    };
  }

  const tools = await getToolsFromMcpClient(client);

  return {
    tools,
    cleanup: async () => {
      try {
        await client.disconnect();
      } catch (error) {
        console.error('[Mastra MCP] Failed to disconnect:', error);
      }
    },
  };
}
