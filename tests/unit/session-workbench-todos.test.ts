/**
 * Unit tests for selectLatestTodos (Phase 3 Wave 1, ① Progress panel).
 *
 * Encodes the contract the WorkbenchPanel relies on: the *latest* TodoWrite call
 * in the current session is the current plan; statuses are coerced safely; and
 * non-TodoWrite tool calls / malformed entries never leak into the list.
 */
import { describe, it, expect } from 'vitest';
import { selectLatestTodos } from '~/lib/hooks/use-session-workbench';
import type { ThreadMessage } from '~/lib/chat-session-store';

function todoWriteMsg(id: string, todos: unknown): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: `tc-${id}`,
        toolName: 'TodoWrite',
        args: { todos },
        argsText: '',
      },
    ],
  };
}

describe('selectLatestTodos', () => {
  it('returns null when there is no TodoWrite call', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'a', toolName: 'Write', args: { file: 'x' }, argsText: '' },
        ],
      },
    ];
    expect(selectLatestTodos(messages)).toBeNull();
  });

  it('extracts content + status from a TodoWrite call', () => {
    const messages = [
      todoWriteMsg('m1', [
        { content: 'Read file', status: 'completed' },
        { content: 'Compute', status: 'in_progress' },
        { content: 'Write result', status: 'pending' },
      ]),
    ];
    expect(selectLatestTodos(messages)).toEqual([
      { content: 'Read file', status: 'completed', activeForm: undefined },
      { content: 'Compute', status: 'in_progress', activeForm: undefined },
      { content: 'Write result', status: 'pending', activeForm: undefined },
    ]);
  });

  it('uses the LATEST TodoWrite call when several exist (the live plan)', () => {
    const messages = [
      todoWriteMsg('m1', [{ content: 'Step A', status: 'pending' }]),
      todoWriteMsg('m2', [
        { content: 'Step A', status: 'completed' },
        { content: 'Step B', status: 'in_progress' },
      ]),
    ];
    const todos = selectLatestTodos(messages);
    expect(todos).toHaveLength(2);
    expect(todos?.[0]).toMatchObject({ content: 'Step A', status: 'completed' });
  });

  it('defaults unknown status to pending and drops empty-content entries', () => {
    const messages = [
      todoWriteMsg('m1', [
        { content: 'Valid', status: 'frobnicate' },
        { content: '', status: 'completed' },
        { status: 'pending' },
      ]),
    ];
    expect(selectLatestTodos(messages)).toEqual([
      { content: 'Valid', status: 'pending', activeForm: undefined },
    ]);
  });

  it('returns null for a TodoWrite call whose todos is not an array', () => {
    const messages = [todoWriteMsg('m1', 'not-an-array')];
    expect(selectLatestTodos(messages)).toBeNull();
  });

  it('preserves activeForm when present', () => {
    const messages = [
      todoWriteMsg('m1', [{ content: 'Run script', status: 'in_progress', activeForm: 'Running script' }]),
    ];
    expect(selectLatestTodos(messages)?.[0]).toEqual({
      content: 'Run script',
      status: 'in_progress',
      activeForm: 'Running script',
    });
  });
});
