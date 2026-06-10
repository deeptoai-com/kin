// @vitest-environment node
/**
 * Unit tests for RAG R0 document/KB visibility (final spec D2).
 *
 * Mirrors projects-access.test.ts: documents and knowledge bases use the same access
 * primitive as sessions (`projectId` nullable). The "非成员看不到" regression is mandatory
 * for every retrieval path — both kb_search legs filter through visibleDocumentsWhere /
 * visibleKbWhere, whose decision core is isResourceVisible.
 */
import { describe, it, expect } from 'vitest';
import { isResourceVisible } from '../../src/server/projects/access-logic';

const ME = 'user_me';
const OTHER = 'user_other';
const PROJ_A = 'proj_a';
const PROJ_B = 'proj_b';

describe('isResourceVisible — personal documents/KBs are private to their owner', () => {
  const noProjects = new Set<string>();

  it('owner sees their own personal document', () => {
    expect(isResourceVisible(ME, { userId: ME, projectId: null }, noProjects)).toBe(true);
  });

  it("a user CANNOT see someone else's personal document (the private case)", () => {
    expect(isResourceVisible(ME, { userId: OTHER, projectId: null }, noProjects)).toBe(false);
  });

  it('project memberships are irrelevant for a personal document — still private', () => {
    expect(isResourceVisible(ME, { userId: OTHER, projectId: null }, new Set([PROJ_A]))).toBe(
      false,
    );
  });
});

describe('isResourceVisible — project documents/KBs are visible to members only', () => {
  it('a member sees a document in a project they belong to (even uploaded by another)', () => {
    expect(isResourceVisible(ME, { userId: OTHER, projectId: PROJ_A }, new Set([PROJ_A]))).toBe(
      true,
    );
  });

  it('THE key regression: a NON-member cannot see a project document', () => {
    expect(isResourceVisible(ME, { userId: OTHER, projectId: PROJ_A }, new Set([PROJ_B]))).toBe(
      false,
    );
  });

  it("being the uploader does NOT grant access once the doc belongs to a project you left", () => {
    // userId is attribution, not an access grant, for project-scoped resources (final spec D2).
    expect(isResourceVisible(ME, { userId: ME, projectId: PROJ_A }, new Set<string>())).toBe(
      false,
    );
  });

  it('membership in an unrelated project does not leak access', () => {
    expect(isResourceVisible(ME, { userId: OTHER, projectId: PROJ_A }, new Set([PROJ_B]))).toBe(
      false,
    );
  });
});
