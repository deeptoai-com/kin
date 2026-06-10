/**
 * Pure access-decision logic for Projects — NO database, NO imports.
 *
 * The security-critical rules ("who can see / mutate a session") live here so they are
 * unit-testable in isolation (the audit flagged zero coverage on exactly this). access.ts
 * wraps these with the DB queries (accessibleProjectIds, etc.).
 */

/** The minimal session shape the access decisions need. */
export interface SessionAccessRow {
  userId: string;
  projectId: string | null;
}

/**
 * READ visibility, given a precomputed set of the user's accessible project ids:
 * - a loose (project-less) session is visible only to its own user;
 * - a project session is visible to any member of that project.
 */
export function isSessionVisible(
  userId: string,
  s: SessionAccessRow,
  accessibleProjectIds: ReadonlySet<string>
): boolean {
  return s.projectId == null ? s.userId === userId : accessibleProjectIds.has(s.projectId);
}

/**
 * MUTATE (rename / delete / favorite) is limited to the session's originator (PRD §9).
 * A member may SEE a teammate's shared session but not mutate it. Writing a NEW turn to a
 * non-owned session is handled separately (non-owner reply → branch).
 */
export function isSessionMutable(userId: string, s: SessionAccessRow): boolean {
  return s.userId === userId;
}
