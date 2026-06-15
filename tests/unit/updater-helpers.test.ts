/**
 * Unit tests for the updater controller's pure helpers (the critical no-op-detection fix):
 *  - sameImage: tolerant docker image-id comparison (sha256: prefix, short vs full hex)
 *  - parseComposeJson: compose v2 `--format json` output (array OR NDJSON OR empty)
 * Importing the controller does NOT start the server (it only listens when run directly).
 */
import { describe, it, expect } from 'vitest';
import { sameImage, parseComposeJson } from '~/updater/controller.mjs';

describe('sameImage', () => {
  it('matches identical full ids', () => {
    expect(sameImage('sha256:abcdef0123', 'sha256:abcdef0123')).toBe(true);
  });
  it('matches across a sha256: prefix difference', () => {
    expect(sameImage('sha256:abcdef0123', 'abcdef0123')).toBe(true);
  });
  it('matches a short id against the full id (prefix)', () => {
    expect(sameImage('abcdef012345', 'sha256:abcdef0123456789deadbeef')).toBe(true);
  });
  it('does not match different ids', () => {
    expect(sameImage('sha256:aaaa1111', 'sha256:bbbb2222')).toBe(false);
  });
  it('is false when either id is missing (so apply proceeds, never silently no-ops)', () => {
    expect(sameImage(null, 'sha256:abc')).toBe(false);
    expect(sameImage('sha256:abc', null)).toBe(false);
  });
});

describe('parseComposeJson', () => {
  it('parses a JSON array', () => {
    expect(parseComposeJson('[{"ID":"a"},{"ID":"b"}]')).toEqual([{ ID: 'a' }, { ID: 'b' }]);
  });
  it('parses NDJSON (one object per line, compose v2)', () => {
    expect(parseComposeJson('{"ID":"a"}\n{"ID":"b"}\n')).toEqual([{ ID: 'a' }, { ID: 'b' }]);
  });
  it('returns [] for empty output', () => {
    expect(parseComposeJson('')).toEqual([]);
    expect(parseComposeJson('   ')).toEqual([]);
  });
  it('wraps a single JSON object into an array', () => {
    expect(parseComposeJson('{"ID":"a"}')).toEqual([{ ID: 'a' }]);
  });
});
