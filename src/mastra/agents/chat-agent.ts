import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { getFileFromObjectStore } from '~/mastra/tools/get-file-from-object-store.tool';
import { getMcpToolsForUser } from '~/mastra/mcp';

/**
 * Lazy-initialize memory to avoid "Cannot access 'pg' before initialization" error.
 *
 * Root cause: PostgresStore depends on 'pg' (CommonJS package). During Vite/Nitro SSR
 * bundling, ESM/CJS interop creates getter proxies for CommonJS exports. When module
 * top-level code executes `new PostgresStore()`, the 'pg' getter may not be ready yet,
 * triggering a Temporal Dead Zone (TDZ) error.
 *
 * Solution: Use dynamic import() to defer module loading until runtime, ensuring all
 * dependencies are fully initialized before instantiation.
 *
 * @see https://mastra.ai/docs/v1/memory/storage - Official storage configuration docs
 */
let _memory: MastraMemory | undefined;

async function createMemory(): Promise<MastraMemory> {
  if (!_memory) {
    // Dynamic imports ensure pg is fully loaded before PostgresStore instantiation
    const { Memory } = await import('@mastra/memory');
    const { PostgresStore } = await import('@mastra/pg');

    _memory = new Memory({
      // Agent-level storage for dedicated data boundaries
      // See: https://mastra.ai/docs/v1/memory/storage#agent-level-storage
      storage: new PostgresStore({
        id: 'chat-agent-storage',
        connectionString: process.env.DATABASE_URL!,
      }),
      options: {
        // Enable message history (last N messages in context)
        lastMessages: 20,
        // Auto-generate thread titles from first user message
        // Note: generateTitle moved to top-level options in Mastra v1
        generateTitle: true,
      },
    });
  }
  return _memory;
}

export const chatAgent = new Agent({
  id: 'chat-agent',
  name: 'Chat Agent',
  instructions: [
    'You are a helpful AI assistant.',
    'When a prompt references files or code, use the get-file-from-object-store tool to retrieve the exact content before answering.',
    'Always mention the object key(s) you consulted, adapt verbosity to user directions, and escalate with follow-up questions when context is ambiguous.',
  ].join(' '),
  // Mastra v1 uses model router with provider/model format
  // Requires ZHIPU_API_KEY environment variable
  model: 'zhipuai/glm-4.7',
  tools: {
    getFileFromObjectStore,
  },
  // DynamicArgument<MastraMemory> - Mastra calls this function when memory is needed
  memory: async () => createMemory(),
});

/**
 * Base tools for chat agent (without MCP tools)
 */
const BASE_TOOLS = {
  getFileFromObjectStore,
};

/**
 * Agent instructions (shared between base and MCP-enhanced agents)
 */
const AGENT_INSTRUCTIONS = [
  'You are a helpful AI assistant.',
  'When a prompt references files or code, use the get-file-from-object-store tool to retrieve the exact content before answering.',
  'Always mention the object key(s) you consulted, adapt verbosity to user directions, and escalate with follow-up questions when context is ambiguous.',
  'You may have access to additional MCP tools based on user configuration. Use them when appropriate.',
].join(' ');

/**
 * Create a chat agent with user's MCP tools dynamically injected.
 *
 * Use this when you need per-user MCP tool access. The returned agent
 * includes all enabled MCP tools for the specified user.
 *
 * @param userId - User ID to resolve MCP tools for
 * @returns Agent with MCP tools and cleanup function
 */
export async function createChatAgentWithMcp(userId: string): Promise<{
  agent: Agent;
  cleanup: () => Promise<void>;
}> {
  // Get MCP tools for this user
  const { tools: mcpTools, cleanup } = await getMcpToolsForUser(userId);

  // Create agent with both base tools and MCP tools
  const agent = new Agent({
    id: 'chat-agent-mcp',
    name: 'Chat Agent (MCP)',
    instructions: AGENT_INSTRUCTIONS,
    model: 'zhipuai/glm-4.7',
    tools: {
      ...BASE_TOOLS,
      ...mcpTools,
    },
    memory: async () => createMemory(),
  });

  return { agent, cleanup };
}
