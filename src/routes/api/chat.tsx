import { json } from '@tanstack/react-start';
import { createFileRoute } from '@tanstack/react-router';
import { createUIMessageStreamResponse } from 'ai';
import { toAISdkStream } from '@mastra/ai-sdk';
import type { Agent } from '@mastra/core/agent';
import { chatAgent, createChatAgentWithMcp } from '~/mastra/agents/chat-agent';
import { optionalUser } from '~/server/require-user';

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();

          // Extract memory config from request body
          // Frontend can pass: { messages, memory: { thread, resource } }
          // Or legacy format: { messages, threadId }
          const { messages, memory, threadId, resourceId } = body;

          // Build memory configuration
          const memoryConfig = memory || (threadId ? { thread: threadId, resource: resourceId || 'default-user' } : undefined);

          // Get current user (optional - MCP tools require authentication)
          const user = await optionalUser(request);

          // Use a generic agent type to allow both base and MCP-enhanced agents
          let agent: Agent = chatAgent;
          let cleanup: (() => Promise<void>) | null = null;

          // If user is authenticated, create agent with their MCP tools
          if (user) {
            try {
              const result = await createChatAgentWithMcp(user.id);
              agent = result.agent;
              cleanup = result.cleanup;
            } catch (error) {
              console.warn('[/api/chat] Failed to load MCP tools, using base agent:', error);
              // Fall back to base agent without MCP tools
            }
          }

          try {
            // Stream the agent response
            const agentStream = await agent.stream(messages, {
              memory: memoryConfig,
            });

            // Convert Mastra agent stream to AI SDK format
            const aiSdkStream = toAISdkStream(agentStream, {
              from: 'agent',
              sendStart: true,
              sendFinish: true,
            });

            return createUIMessageStreamResponse({ stream: aiSdkStream });
          } finally {
            // Cleanup MCP connections after stream completes
            if (cleanup) {
              cleanup().catch((error) => {
                console.error('[/api/chat] MCP cleanup failed:', error);
              });
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unexpected error';
          console.error('POST /api/chat error', error);
          return json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
