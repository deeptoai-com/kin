/**
 * Unit tests for the shared route-layer relative-path guard (B3).
 *
 * This guard is used by the workspace/session file & artifact API routes to reject
 * traversal/absolute inputs before joining onto a trusted workspace root. It is the
 * strictest of the 5 previously-duplicated copies (also rejects empty + bare ".").
 */
import { describe, it, expect } from 'vitest';
import { validateRelativePath } from '../../src/server/security/validate-relative-path';

describe('validateRelativePath', () => {
  it('accepts safe relative paths', () => {
    for (const p of ['file.txt', 'dir/file.txt', 'a/b/c.md', 'sub/./file.txt', 'name with spaces.txt']) {
      expect(validateRelativePath(p)).toBe(true);
    }
  });

  it('rejects empty / whitespace / bare dot', () => {
    for (const p of ['', '   ', '.', './']) {
      expect(validateRelativePath(p)).toBe(false);
    }
  });

  it('rejects parent-traversal sequences', () => {
    for (const p of ['..', '../etc/passwd', 'a/../../b', 'dir/..', 'foo/../../bar']) {
      expect(validateRelativePath(p)).toBe(false);
    }
  });

  it('rejects home (~) references', () => {
    for (const p of ['~', '~/secrets', 'a/~/b']) {
      expect(validateRelativePath(p)).toBe(false);
    }
  });

  it('rejects POSIX absolute paths', () => {
    for (const p of ['/etc/passwd', '/', '/data/users/x']) {
      expect(validateRelativePath(p)).toBe(false);
    }
  });

  it('rejects Windows absolute paths', () => {
    for (const p of ['C:\\Windows\\System32', 'C:/Windows', '\\\\server\\share']) {
      expect(validateRelativePath(p)).toBe(false);
    }
  });

  it('rejects backslash-rooted paths', () => {
    expect(validateRelativePath('\\etc')).toBe(false);
  });
});
