/**
 * Projects Server Functions (Projects P1)
 *
 * Real backend for the Projects IA. All access goes through the resolver
 * (src/server/projects/access.ts) — owner-only mutations are guarded there.
 * Sharing = addProjectMember (instant; no re-index). The default "个人/Personal"
 * Project is ensured per user.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '~/db/db-config';
import { project, projectMember, type ProjectRole } from '~/db/schema/project.schema';
import { agentSession } from '~/db/schema/agent-session.schema';
import { user } from '~/db/schema/auth.schema';
import { auth } from '~/server/auth.server';
import { accessibleProjectIds, assertProjectMember, assertProjectOwner } from '~/server/projects/access';

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error('UNAUTHORIZED');
  return session.user;
};

// ---- DTOs (shape the Projects UI consumes; mirrors the old localStorage store) ----

export interface ProjectMemberDTO {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: ProjectRole;
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  ownerUserId: string;
  isDefault: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  members: ProjectMemberDTO[];
}

/** Load full Project DTOs (with members joined to user) for the given ids. */
async function loadProjectsWithMembers(projectIds: string[]): Promise<ProjectDTO[]> {
  if (projectIds.length === 0) return [];
  const projects = await db.select().from(project).where(inArray(project.id, projectIds));
  const memberRows = await db
    .select({
      projectId: projectMember.projectId,
      role: projectMember.role,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(projectMember)
    .innerJoin(user, eq(projectMember.userId, user.id))
    .where(inArray(projectMember.projectId, projectIds));

  const byProject = new Map<string, ProjectMemberDTO[]>();
  for (const m of memberRows) {
    const arr = byProject.get(m.projectId) ?? [];
    arr.push({ userId: m.userId, name: m.name ?? m.email, email: m.email, image: m.image ?? null, role: m.role });
    byProject.set(m.projectId, arr);
  }

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    instructions: p.instructions,
    ownerUserId: p.ownerUserId,
    isDefault: p.isDefault,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    members: byProject.get(p.id) ?? [],
  }));
}

function sortProjectDTOs(projects: ProjectDTO[]): ProjectDTO[] {
  return projects.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ---- queries ----

/** All Projects the current user can access (owned + shared), default first. */
export const listProjects = createServerFn({ method: 'GET' }).handler(async (): Promise<ProjectDTO[]> => {
  const u = await requireUser();
  const ids = await accessibleProjectIds(u.id);
  return sortProjectDTOs(await loadProjectsWithMembers(ids));
});

/** A single Project the user is a member of (else FORBIDDEN). */
export const getProject = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ projectId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const u = await requireUser();
    await assertProjectMember(u.id, data.projectId);
    const [dto] = await loadProjectsWithMembers([data.projectId]);
    if (!dto) throw new Error('NOT_FOUND');
    return dto;
  });

// ---- mutations ----

/** Idempotently ensure the user's default "个人/Personal" Project exists; return it. */
export const ensureDefaultProject = createServerFn({ method: 'POST' }).handler(async (): Promise<ProjectDTO> => {
  const u = await requireUser();
  const findDefault = async () =>
    (await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.ownerUserId, u.id), eq(project.isDefault, true)))
      .limit(1))[0]?.id;

  let projectId = await findDefault();
  if (!projectId) {
    try {
      projectId = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(project)
          .values({ ownerUserId: u.id, name: '个人', isDefault: true })
          .returning({ id: project.id });
        await tx.insert(projectMember).values({ projectId: p.id, userId: u.id, role: 'owner' });
        return p.id;
      });
    } catch {
      // Lost a race against the partial-unique default index — re-read the winner.
      projectId = await findDefault();
    }
  }
  if (!projectId) throw new Error('ENSURE_DEFAULT_FAILED');
  const [dto] = await loadProjectsWithMembers([projectId]);
  return dto;
});

/** Create a Project (owner = current user). Private by default; share later. */
export const createProject = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().trim().min(1).max(100),
      description: z.string().max(500).optional(),
      instructions: z.string().max(5000).optional(),
    }),
  )
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const u = await requireUser();
    const projectId = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(project)
        .values({
          ownerUserId: u.id,
          name: data.name.trim(),
          description: data.description?.trim() || null,
          instructions: data.instructions?.trim() || null,
        })
        .returning({ id: project.id });
      await tx.insert(projectMember).values({ projectId: p.id, userId: u.id, role: 'owner' });
      return p.id;
    });
    const [dto] = await loadProjectsWithMembers([projectId]);
    return dto;
  });

/** Update name/description/instructions (owner-only). */
export const updateProject = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      instructions: z.string().max(5000).optional(),
    }),
  )
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const u = await requireUser();
    await assertProjectOwner(u.id, data.projectId);
    await db
      .update(project)
      .set({
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() || null } : {}),
        ...(data.instructions !== undefined ? { instructions: data.instructions.trim() || null } : {}),
      })
      .where(eq(project.id, data.projectId));
    const [dto] = await loadProjectsWithMembers([data.projectId]);
    return dto;
  });

/** Delete a Project (owner-only; the default Project cannot be deleted). Sessions become loose. */
export const deleteProject = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ projectId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const u = await requireUser();
    await assertProjectOwner(u.id, data.projectId);
    const [p] = await db
      .select({ isDefault: project.isDefault })
      .from(project)
      .where(eq(project.id, data.projectId))
      .limit(1);
    if (!p) throw new Error('NOT_FOUND');
    if (p.isDefault) throw new Error('CANNOT_DELETE_DEFAULT');
    // agent_session.project_id is ON DELETE SET NULL → its sessions become loose, not deleted.
    await db.delete(project).where(eq(project.id, data.projectId));
    return { success: true as const };
  });

// ---- members (sharing) ----

/** Add a member by email = share the Project (owner-only; instant). */
export const addProjectMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ projectId: z.string().uuid(), email: z.string().email() }))
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const u = await requireUser();
    await assertProjectOwner(u.id, data.projectId);
    const wanted = data.email.toLowerCase().trim();
    // NOTE (org boundary, audit D3): this matches the whole user table by email. Safe on
    // a single-org self-hosted instance (everyone is a colleague). When `project.orgId` /
    // multi-org is enabled, this MUST constrain the lookup to the project's org (via the
    // better-auth `member` table) or an owner could add a cross-org user.
    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(sql`lower(${user.email})`, wanted))
      .limit(1);
    if (!target) throw new Error('USER_NOT_FOUND');
    await db
      .insert(projectMember)
      .values({ projectId: data.projectId, userId: target.id, role: 'member' })
      .onConflictDoNothing();
    const [dto] = await loadProjectsWithMembers([data.projectId]);
    return dto;
  });

/** Remove a member (owner-only; the owner cannot be removed). */
export const removeProjectMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ projectId: z.string().uuid(), userId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const u = await requireUser();
    await assertProjectOwner(u.id, data.projectId);
    const [p] = await db
      .select({ ownerUserId: project.ownerUserId })
      .from(project)
      .where(eq(project.id, data.projectId))
      .limit(1);
    if (p && p.ownerUserId === data.userId) throw new Error('CANNOT_REMOVE_OWNER');
    await db
      .delete(projectMember)
      .where(and(eq(projectMember.projectId, data.projectId), eq(projectMember.userId, data.userId)));
    const [dto] = await loadProjectsWithMembers([data.projectId]);
    return dto;
  });

// ---- sessions ↔ project ----

export interface ProjectSessionDTO {
  id: string;
  sdkSessionId: string;
  title: string | null;
  /** The session's originating user (attribution for shared Projects). */
  createdByUserId: string;
  /** Display name + avatar of the originating user — so a shared Project's chat list
   *  shows WHO started each conversation (distinguishing A's chats from B's). */
  createdByName: string | null;
  createdByImage: string | null;
  updatedAt: string; // ISO
}

/** Sessions that belong to a Project (visible to any member). */
export const listProjectSessions = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ projectId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProjectSessionDTO[]> => {
    const u = await requireUser();
    await assertProjectMember(u.id, data.projectId);
    const rows = await db
      .select({
        id: agentSession.id,
        sdkSessionId: agentSession.sdkSessionId,
        title: agentSession.title,
        userId: agentSession.userId,
        ownerName: user.name,
        ownerImage: user.image,
        updatedAt: agentSession.updatedAt,
      })
      .from(agentSession)
      .leftJoin(user, eq(user.id, agentSession.userId))
      .where(eq(agentSession.projectId, data.projectId))
      .orderBy(desc(agentSession.updatedAt));
    return rows.map((r) => ({
      id: r.id,
      sdkSessionId: r.sdkSessionId,
      title: r.title,
      createdByUserId: r.userId,
      createdByName: r.ownerName ?? null,
      createdByImage: r.ownerImage ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });

/**
 * Move a session into a Project (or back out, projectId=null). Only the session's
 * own user may move it, and only into a Project they belong to. This is the binding
 * the "new chat in <project>" flow will call once the session exists.
 */
export const assignSessionToProject = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ sdkSessionId: z.string().min(1), projectId: z.string().uuid().nullable() }))
  .handler(async ({ data }) => {
    const u = await requireUser();
    if (data.projectId) await assertProjectMember(u.id, data.projectId);
    const res = await db
      .update(agentSession)
      .set({ projectId: data.projectId })
      .where(and(eq(agentSession.userId, u.id), eq(agentSession.sdkSessionId, data.sdkSessionId)))
      .returning({ id: agentSession.id });
    if (res.length === 0) throw new Error('NOT_FOUND');
    return { success: true as const };
  });
