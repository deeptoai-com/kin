/**
 * Isolation-boundary tests for conversation search (spec §4 + A's review §2).
 * buildMessageSearchFilter must mirror visibleSessionsWhere (access.ts) exactly:
 *   (userId = me AND projectId IS NULL) OR projectId IN myAccessibleProjects
 * Pure (no Meili) — proves the access predicate without a live index.
 */
import { describe, it, expect } from 'vitest';
import { buildMessageSearchFilter } from '~/search/meilisearch';

describe('buildMessageSearchFilter (isolation)', () => {
  it('scopes to own loose sessions + accessible projects', () => {
    expect(buildMessageSearchFilter({ userId: 'me', projectIds: ['p1', 'p2'] })).toBe(
      '((userId = "me" AND projectId IS NULL) OR projectId IN ["p1", "p2"])',
    );
  });

  it('guards the loose clause with projectId IS NULL (not a bare userId = me)', () => {
    const f = buildMessageSearchFilter({ userId: 'me', projectIds: [] });
    expect(f).toContain('userId = "me" AND projectId IS NULL');
    // A bare `userId = "me"` (without the IS NULL guard) would leak my messages from projects
    // I was removed from — assert it is NOT present.
    expect(f).not.toMatch(/userId = "me"(?!\s+AND projectId IS NULL)/);
  });

  it('with no accessible projects, only own loose sessions match', () => {
    expect(buildMessageSearchFilter({ userId: 'me', projectIds: [] })).toBe(
      '((userId = "me" AND projectId IS NULL))',
    );
  });

  it('removed from a project → that project no longer searchable', () => {
    const member = buildMessageSearchFilter({ userId: 'me', projectIds: ['p1', 'p2'] });
    const removed = buildMessageSearchFilter({ userId: 'me', projectIds: ['p1'] }); // left p2
    expect(member).toContain('"p2"');
    expect(removed).not.toContain('"p2"'); // can no longer reach p2's messages
    // and crucially, the loose clause can't backfill p2 (it requires projectId IS NULL)
    expect(removed).toBe('((userId = "me" AND projectId IS NULL) OR projectId IN ["p1"])');
  });

  it('optional projectId/role narrowing is AND-ed outside the OR group (cannot widen access)', () => {
    expect(
      buildMessageSearchFilter({ userId: 'me', projectIds: ['p1'], projectId: 'p1', role: 'user' }),
    ).toBe('((userId = "me" AND projectId IS NULL) OR projectId IN ["p1"]) AND projectId = "p1" AND role = "user"');
  });

  it('escapes quotes/backslashes in ids (filter injection)', () => {
    const f = buildMessageSearchFilter({ userId: 'a"b\\c', projectIds: [] });
    expect(f).toContain('userId = "a\\"b\\\\c"');
  });
});
