// @vitest-environment node
/**
 * Unit tests for the history-display transcript filter.
 *
 * Encodes the contract ws-server's parseJsonlContent relies on: drop the SDK's
 * prompt-less-resume artifacts ("Continue from where you left off." + the
 * synthetic "No response requested." reply) and legacy eager-init blank
 * prompts — and NOTHING else. Entry shapes mirror real SDK 0.2.112 JSONL.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error - .js module without type declarations
import { isSyntheticTranscriptEntry } from '../../src/server/history/transcript-filter.js';

/** Real shape (trimmed) of the SDK-injected continuation prompt. */
const continuationEntry = {
  parentUuid: '24e73236-590f-4787-b435-144d28348de2',
  isSidechain: false,
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'text', text: 'Continue from where you left off.' }],
  },
  isMeta: true,
  uuid: '35ad4c06-a076-41ef-b3a6-7ac8d68b4b55',
  sessionId: '87857d23-f714-4c07-9658-ff792d4c22d2',
};

/** Real shape (trimmed) of its synthetic auto-reply. */
const noResponseEntry = {
  type: 'assistant',
  message: {
    model: '<synthetic>',
    role: 'assistant',
    type: 'message',
    content: [{ type: 'text', text: 'No response requested.' }],
  },
  uuid: '40e0c6ed-f92d-45a3-bd64-d05456eabcec',
};

describe('isSyntheticTranscriptEntry — drops the artifacts', () => {
  it('drops the isMeta continuation prompt (marker check)', () => {
    expect(isSyntheticTranscriptEntry(continuationEntry)).toBe(true);
  });

  it('drops the continuation prompt by exact string when isMeta is absent', () => {
    const { isMeta: _isMeta, ...withoutMeta } = continuationEntry;
    expect(isSyntheticTranscriptEntry(withoutMeta)).toBe(true);
  });

  it('drops any isMeta user entry regardless of its text', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: 'some injected meta text' },
      }),
    ).toBe(true);
  });

  it('drops the legacy eager-init single-space prompt (array form, no isMeta)', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: ' ' }] },
      }),
    ).toBe(true);
  });

  it('drops whitespace-only string-content user entries', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: { role: 'user', content: '  \n ' },
      }),
    ).toBe(true);
  });

  it('drops the synthetic "No response requested." reply', () => {
    expect(isSyntheticTranscriptEntry(noResponseEntry)).toBe(true);
  });
});

describe('isSyntheticTranscriptEntry — keeps everything else', () => {
  it('keeps a real user text message', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '看看这个文件里有什么，最好能把它展示出来' }],
        },
      }),
    ).toBe(false);
  });

  it('keeps an inherited (forkedFrom) real user message', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        forkedFrom: 'other-session-id',
        message: { role: 'user', content: [{ type: 'text', text: 'branched question' }] },
      }),
    ).toBe(false);
  });

  it('keeps user text merely resembling the continuation prompt', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: { role: 'user', content: 'Continue from where you left off, please!' },
      }),
    ).toBe(false);
  });

  it('keeps tool_result user entries (turn backfill depends on them)', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
        },
      }),
    ).toBe(false);
  });

  it('keeps attachment-bearing prompts (【附件信息】 block makes text non-blank)', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '\n\n【附件信息】\n1) name: report.pdf' }],
        },
      }),
    ).toBe(false);
  });

  it('keeps user entries with non-text blocks even when text is blank', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', data: '...' } },
            { type: 'text', text: ' ' },
          ],
        },
      }),
    ).toBe(false);
  });

  it('keeps normal assistant messages', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'assistant',
        message: {
          model: 'glm-5.1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the answer.' }],
        },
      }),
    ).toBe(false);
  });

  it('keeps synthetic assistant notices with other texts (e.g. API errors)', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'assistant',
        message: {
          model: '<synthetic>',
          role: 'assistant',
          content: [{ type: 'text', text: 'API Error: 529 overloaded' }],
        },
      }),
    ).toBe(false);
  });

  it('keeps "No response requested." from a real (non-synthetic) model', () => {
    expect(
      isSyntheticTranscriptEntry({
        type: 'assistant',
        message: {
          model: 'glm-5.1',
          role: 'assistant',
          content: [{ type: 'text', text: 'No response requested.' }],
        },
      }),
    ).toBe(false);
  });

  it('ignores entries without a message (queue-operation, attachment, last-prompt)', () => {
    expect(isSyntheticTranscriptEntry({ type: 'queue-operation' })).toBe(false);
    expect(isSyntheticTranscriptEntry({ type: 'attachment' })).toBe(false);
    expect(isSyntheticTranscriptEntry({ type: 'last-prompt', lastPrompt: 'x' })).toBe(false);
    expect(isSyntheticTranscriptEntry(null)).toBe(false);
    expect(isSyntheticTranscriptEntry(undefined)).toBe(false);
  });
});
