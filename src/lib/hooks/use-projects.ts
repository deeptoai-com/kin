'use client';

/**
 * useProjects — server-backed Projects data (Projects P1).
 *
 * Replaces the shell's localStorage mock store: reads via the listProjects server
 * function (TanStack Query) and mutates via the project server functions, mirroring
 * the same shape the UI already consumed (ProjectDTO ≈ the old Project). The current
 * user is resolved server-side, so components no longer thread a user object through.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  listProjects,
  ensureDefaultProject,
  createProject as createProjectFn,
  updateProject as updateProjectFn,
  deleteProject as deleteProjectFn,
  addProjectMember,
  removeProjectMember,
  type ProjectDTO,
  type ProjectMemberDTO,
} from '~/server/function/projects.server';

export type { ProjectDTO, ProjectMemberDTO };

export const PROJECTS_QUERY_KEY = ['projects', 'list'] as const;

export function useProjects() {
  const qc = useQueryClient();
  const list = useServerFn(listProjects);
  const ensure = useServerFn(ensureDefaultProject);
  const create = useServerFn(createProjectFn);
  const update = useServerFn(updateProjectFn);
  const del = useServerFn(deleteProjectFn);
  const addMem = useServerFn(addProjectMember);
  const removeMem = useServerFn(removeProjectMember);

  const query = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['projects'] });

  return {
    projects: (query.data ?? []) as ProjectDTO[],
    isLoading: query.isLoading,
    error: query.error,

    /** Idempotently ensure the default "个人/Personal" Project exists. */
    async ensureDefault(): Promise<ProjectDTO> {
      const p = await ensure();
      await invalidate();
      return p;
    },
    async createProject(input: { name: string; description?: string; instructions?: string }): Promise<ProjectDTO> {
      const p = await create({ data: input });
      await invalidate();
      return p;
    },
    async updateProject(input: {
      projectId: string;
      name?: string;
      description?: string;
      instructions?: string;
    }): Promise<ProjectDTO> {
      const p = await update({ data: input });
      await invalidate();
      return p;
    },
    async deleteProject(projectId: string): Promise<void> {
      await del({ data: { projectId } });
      await invalidate();
    },
    /** Share: add a member by email (owner-only, server-enforced). */
    async addMember(projectId: string, email: string): Promise<ProjectDTO> {
      const p = await addMem({ data: { projectId, email } });
      await invalidate();
      return p;
    },
    async removeMember(projectId: string, userId: string): Promise<ProjectDTO> {
      const p = await removeMem({ data: { projectId, userId } });
      await invalidate();
      return p;
    },
  };
}

// ---- pure helpers (ported from the old store; operate on ProjectDTO) ----

export function selectProject(projects: ProjectDTO[], id: string | undefined): ProjectDTO | undefined {
  return id ? projects.find((p) => p.id === id) : undefined;
}

/** A Project is "shared" once it has more than its owner. */
export function isShared(project: ProjectDTO): boolean {
  return project.members.length > 1;
}
