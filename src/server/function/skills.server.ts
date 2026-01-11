/**
 * Skills Server Functions
 *
 * Server functions for Skills management using TanStack Start
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { auth } from '~/server/auth.server';
import {
  getSkillsStore,
  getUserEnabledSkills,
  enableSkill,
  disableSkill,
  getSkillDetail,
  uploadUserSkill,
  getUserUploadedSkills,
  deleteUserSkill,
  enableUserUploadedSkill,
  disableUserUploadedSkill,
  getUserSkillFiles,
  type SkillInfo,
  type SkillDetail,
} from '~/claude/skills';

/**
 * Require authenticated user
 * Throws error if not authenticated
 */
const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }

  return session.user;
};

// Input validation schemas
const enableSkillSchema = z.object({
  skillName: z.string().min(1),
});

const disableSkillSchema = z.object({
  skillName: z.string().min(1),
});

const getSkillDetailSchema = z.object({
  skillSlug: z.string().min(1),
});

export type EnableSkillInput = z.infer<typeof enableSkillSchema>;
export type DisableSkillInput = z.infer<typeof disableSkillSchema>;

/**
 * List all available skills from the store
 * No authentication required - this is just the catalog
 */
export const listSkillsStore = createServerFn({ method: 'GET' }).handler(async () => {
  return await getSkillsStore();
});

/**
 * Get user's enabled skills
 * Authentication required
 */
export const listUserSkills = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const enabledSlugs = await getUserEnabledSkills(user.id);
  const allSkills = await getSkillsStore();

  // Return full skill info for enabled skills only
  return allSkills.filter((skill) => enabledSlugs.includes(skill.slug));
});

/**
 * Enable a skill for the user
 * Authentication required
 */
export const enableUserSkill = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    // Normalize input like documents.server.ts does
    const payload =
      typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return enableSkillSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await enableSkill(user.id, data.skillName);
    return { success: true };
  });

/**
 * Disable a skill for the user
 * Authentication required
 */
export const disableUserSkill = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    // Normalize input like documents.server.ts does
    const payload =
      typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return disableSkillSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await disableSkill(user.id, data.skillName);
    return { success: true };
  });

/**
 * Get full Skill detail including all files
 * No authentication required - this is public information
 */
export const getSkillDetailFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    // Handle both URL params and query string
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const skillSlug = searchParams?.get('skillSlug') || (typeof input === 'object' && input && 'skillSlug' in input ? (input as { skillSlug?: string }).skillSlug : null);
    return getSkillDetailSchema.parse({ skillSlug });
  })
  .handler(async ({ data }) => {
    // Get current user (optional, for user-uploaded skills)
    const { headers } = getRequest();
    const session = await auth.api.getSession({ headers });
    const userId = session?.user?.id || null;

    return await getSkillDetail(data.skillSlug, userId);
  });

// ============================================================================
// User-Uploaded Skills Server Functions
// ============================================================================

/**
 * Upload a user-created skill
 * Authentication required
 */
export const uploadUserSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      name: z.string().min(1).max(50),
      description: z.string().optional(),
      category: z.string().optional(),
      files: z.array(z.object({
        path: z.string(),
        content: z.string(),
      })),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();

    // Validate file count
    if (data.files.length > 100) {
      throw new Error('Too many files. Maximum 100 files per skill.');
    }

    // Validate total size (10 MB limit)
    const totalSize = data.files.reduce((sum, f) => sum + f.content.length, 0);
    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (totalSize > maxSize) {
      throw new Error(`Skill size exceeds limit (${(totalSize / 1024 / 1024).toFixed(2)} MB > 10 MB)`);
    }

    await uploadUserSkill(user.id, data.name, data.files);

    return {
      success: true,
      skillName: data.name,
    };
  });

/**
 * Get all skills (both official and user-uploaded)
 * Authentication required
 */
export const listAllSkillsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireUser();

    // Get official skills (from src/skills-store)
    const allOfficialSkills = await getSkillsStore();
    const enabledOfficialSlugs = await getUserEnabledSkills(user.id);

    const officialSkills = allOfficialSkills.map(skill => ({
      ...skill,
      store: 'official' as const,
      enabled: enabledOfficialSlugs.includes(skill.slug),
    }));

    // Get user-uploaded skills
    const userSkills = await getUserUploadedSkills(user.id);

    return {
      official: officialSkills,
      user: userSkills.map(skill => ({
        ...skill,
        store: 'user' as const,
      })),
    };
  });

/**
 * Delete a user-uploaded skill
 * Authentication required
 */
export const deleteUserSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      skillName: z.string().min(1),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deleteUserSkill(user.id, data.skillName);

    return { success: true };
  });

/**
 * Enable a user-uploaded skill
 * Authentication required
 */
export const enableUserUploadedSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      skillName: z.string().min(1),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await enableUserUploadedSkill(user.id, data.skillName);

    return { success: true };
  });

/**
 * Disable a user-uploaded skill
 * Authentication required
 */
export const disableUserUploadedSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      skillName: z.string().min(1),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await disableUserUploadedSkill(user.id, data.skillName);

    return { success: true };
  });

/**
 * Get files in a user-uploaded skill
 * Authentication required
 */
export const getUserSkillFilesFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const skillName = searchParams?.get('skillName') || (typeof input === 'object' && input && 'skillName' in input ? (input as { skillName?: string }).skillName : null);
    return z.object({
      skillName: z.string().min(1),
    }).parse({ skillName });
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    return await getUserSkillFiles(user.id, data.skillName);
  });
