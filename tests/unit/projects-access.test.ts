// @vitest-environment node
/**
 * Unit tests for the Projects access decisions (Projects P1).
 *
 * These pure functions are the one security-critical subsystem of the feature — the PRD
 * mandates a "非成员看不到" regression for every list/read. They encode: a loose session
 * is private to its owner; a project session is visible to members but mutable only by its
 * originator. (The DB-backed wrappers in access.ts compose accessibleProjectIds → the set.)
 */
import { describe, it, expect } from 'vitest';
import { isSessionVisible, isSessionMutable } from '../../src/server/projects/access-logic';

const ME = 'user_me';
const OTHER = 'user_other';
const PROJ_A = 'proj_a';
const PROJ_B = 'proj_b';

describe('isSessionVisible — loose (project-less) sessions are private to their owner', () => {
  const noProjects = new Set<string>();

  it('owner sees their own loose session', () => {
    expect(isSessionVisible(ME, { userId: ME, projectId: null }, noProjects)).toBe(true);
  });

  it("a user CANNOT see someone else's loose session (the private case)", () => {
    expect(isSessionVisible(ME, { userId: OTHER, projectId: null }, noProjects)).toBe(false);
  });

  it('membership is irrelevant for a loose session — still private', () => {
    // Even with projects, a loose session ignores them.
    expect(isSessionVisible(ME, { userId: OTHER, projectId: null }, new Set([PROJ_A]))).toBe(false);
  });
});

describe('isSessionVisible — project sessions are visible to members only', () => {
  it('a member sees a session in a project they belong to (even authored by another)', () => {
    expect(isSessionVisible(ME, { userId: OTHER, projectId: PROJ_A }, new Set([PROJ_A]))).toBe(true);
  });

  it('THE key regression: a NON-member cannot see a project session', () => {
    expect(isSessionVisible(ME, { userId: OTHER, projectId: PROJ_A }, new Set([PROJ_B]))).toBe(false);
  });

  it('a non-member cannot see a project session even if they have other memberships', () => {
    expect(isSessionVisible(ME, { userId: OTHER, projectId: PROJ_A }, new Set([PROJ_B, 'proj_c']))).toBe(false);
  });

  it('with no memberships, no project session is visible', () => {
    expect(isSessionVisible(ME, { userId: ME, projectId: PROJ_A }, new Set())).toBe(false);
  });
});

describe('isSessionMutable — mutate (rename/delete) is originator-only', () => {
  it('the originator may mutate their own session', () => {
    expect(isSessionMutable(ME, { userId: ME, projectId: null })).toBe(true);
    expect(isSessionMutable(ME, { userId: ME, projectId: PROJ_A })).toBe(true);
  });

  it("a member may NOT mutate a teammate's session, even in a shared project they can see", () => {
    expect(isSessionMutable(ME, { userId: OTHER, projectId: PROJ_A })).toBe(false);
  });

  it("a user may not mutate someone else's loose session", () => {
    expect(isSessionMutable(ME, { userId: OTHER, projectId: null })).toBe(false);
  });
});
