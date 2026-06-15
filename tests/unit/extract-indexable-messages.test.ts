/**
 * Unit tests for conversation-search JSONL extraction rules (spec §3.2 / §6.1).
 * Pure: no Meili, no fs. Verifies only user/assistant `text` is indexed, tool/thinking
 * blocks are skipped, timestamps come from the JSONL, and uuid-less / empty entries drop.
 */
import { describe, it, expect } from 'vitest';
import { extractIndexableMessages } from '~/server/sessions/jsonl';

const ctx = { sessionId: 'sess-1', userId: 'me', projectId: 'proj-1', title: 'My chat' };

const line = (obj: unknown) => JSON.stringify(obj);

describe('extractIndexableMessages', () => {
  it('indexes user + assistant text, skips tool_use/tool_result/thinking', () => {
    const jsonl = [
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-14T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello contract clause' }] },
      }),
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-14T10:00:05.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'first part' },
            { type: 'tool_use', name: 'bash', input: {} },
            { type: 'text', text: 'second part' },
          ],
        },
      }),
      line({
        type: 'user',
        uuid: 'tr1',
        timestamp: '2026-06-14T10:00:06.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] },
      }),
      line({
        type: 'assistant',
        uuid: 'th1',
        timestamp: '2026-06-14T10:00:07.000Z',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret reasoning' }] },
      }),
    ].join('\n');

    const out = extractIndexableMessages(jsonl, ctx);
    expect(out.map((m) => m.messageId)).toEqual(['u1', 'a1']); // tool_result + thinking entries drop (empty text)
    expect(out[0]).toMatchObject({
      id: 'sess-1__u1', // composite PK (session-scoped, branch-collision-safe)
      messageId: 'u1',
      sessionId: 'sess-1',
      userId: 'me',
      projectId: 'proj-1',
      role: 'user',
      text: 'hello contract clause',
      title: 'My chat',
    });
    expect(out[0].createdAt).toBe(Date.parse('2026-06-14T10:00:00.000Z'));
    expect(out[1].text).toBe('first part\nsecond part'); // text blocks joined, tool_use skipped
  });

  it('handles string content and missing timestamp (createdAt = 0)', () => {
    const jsonl = line({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'plain string body' } });
    const out = extractIndexableMessages(jsonl, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('plain string body');
    expect(out[0].createdAt).toBe(0);
  });

  it('drops entries without a uuid (no stable anchor) and non user/assistant types', () => {
    const jsonl = [
      line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'no uuid here' }] } }),
      line({ type: 'system', uuid: 's1', message: { content: [{ type: 'text', text: 'system note' }] } }),
      line({ type: 'summary', uuid: 'sum1', summary: 'a summary' }),
    ].join('\n');
    expect(extractIndexableMessages(jsonl, ctx)).toEqual([]);
  });

  it('tolerates malformed / blank lines', () => {
    const jsonl = ['', 'not json', line({ type: 'user', uuid: 'u9', message: { role: 'user', content: 'kept' } }), ''].join(
      '\n',
    );
    const out = extractIndexableMessages(jsonl, ctx);
    expect(out.map((m) => m.messageId)).toEqual(['u9']);
  });

  it('composite id is session-scoped so branched/forked sessions (reused uuids) do NOT collide', () => {
    const jsonl = line({ type: 'user', uuid: 'shared-uuid', message: { role: 'user', content: 'forked message' } });
    const a = extractIndexableMessages(jsonl, { ...ctx, sessionId: 'sessA' });
    const b = extractIndexableMessages(jsonl, { ...ctx, sessionId: 'sessB' });
    expect(a[0].id).toBe('sessA__shared-uuid');
    expect(b[0].id).toBe('sessB__shared-uuid');
    expect(a[0].id).not.toBe(b[0].id); // distinct Meili primary keys → no upsert overwrite
    expect(a[0].messageId).toBe('shared-uuid'); // same raw uuid for the deep-link anchor in each
  });
});
