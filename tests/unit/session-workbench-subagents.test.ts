/**
 * Unit tests for selectSubAgents (Phase 3 Wave 1, ② Sub-agents panel).
 *
 * Contract: each Claude Code `Task` tool-call in the current session is one
 * sub-agent, surfaced in call order with subagent_type + description + a status
 * mapped from the tool-call status. Non-Task tool calls are ignored.
 */
import { describe, it, expect } from 'vitest';
import { selectSubAgents } from '~/lib/hooks/use-session-workbench';
import type { ThreadMessage, ToolStatus } from '~/lib/chat-session-store';

function taskMsg(
  id: string,
  args: Record<string, unknown>,
  toolStatus?: ToolStatus,
  isError?: boolean,
): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: `tc-${id}`,
        toolName: 'Task',
        args,
        argsText: '',
        ...(toolStatus ? { toolStatus } : {}),
        ...(isError ? { isError } : {}),
      },
    ],
  };
}

describe('selectSubAgents', () => {
  it('returns [] when there are no Task calls', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'a', toolName: 'Bash', args: {}, argsText: '' },
        ],
      },
    ];
    expect(selectSubAgents(messages)).toEqual([]);
  });

  it('maps a Task call to a sub-agent with type, description and status', () => {
    const messages = [
      taskMsg('m1', { subagent_type: 'researcher', description: 'Research pricing' }, 'completed'),
    ];
    expect(selectSubAgents(messages)).toEqual([
      { id: 'tc-m1', subagentType: 'researcher', description: 'Research pricing', status: 'completed' },
    ]);
  });

  it('maps tool status to running/completed/error and honours isError', () => {
    const messages = [
      taskMsg('a', { description: 'one' }, 'executing'),
      taskMsg('b', { description: 'two' }, 'backgrounded'),
      taskMsg('c', { description: 'three' }, 'error'),
      taskMsg('d', { description: 'four' }, 'completed', true),
      taskMsg('e', { description: 'five' }), // no status → running
    ];
    expect(selectSubAgents(messages).map((s) => s.status)).toEqual([
      'running',
      'running',
      'error',
      'error',
      'running',
    ]);
  });

  it('preserves call order across messages', () => {
    const messages = [taskMsg('first', { description: 'A' }), taskMsg('second', { description: 'B' })];
    expect(selectSubAgents(messages).map((s) => s.description)).toEqual(['A', 'B']);
  });

  it('falls back to intent then a default when description is missing', () => {
    const withIntent: ThreadMessage = {
      id: 'm1',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'tc1',
          toolName: 'Task',
          args: {},
          argsText: '',
          intent: 'Summarise the doc',
        },
      ],
    };
    expect(selectSubAgents([withIntent])[0].description).toBe('Summarise the doc');
    expect(selectSubAgents([taskMsg('m2', {})])[0].description).toBe('Sub-agent task');
  });
});
