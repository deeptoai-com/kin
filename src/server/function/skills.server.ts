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
  normalizeSkillName,
  getUserEnabledSkills,
  readGlobalSkills,
  setGlobalSkillEnabled,
  ensureGlobalSkillsForUser,
  enableSkill,
  disableSkill,
  getSkillDetail,
  uploadUserSkill,
  getUserUploadedSkills,
  deleteUserSkill,
  enableUserUploadedSkill,
  disableUserUploadedSkill,
  getUserSkillFiles,
  checkSkillCompatibility,
  formatCompatibilityWarnings,
  installSkillFromGitHub,
  deleteGitHubSkill,
  getExtendedSkillInfo,
  // Schema generator (independent SDK call chain)
  generateSkillSchemaWithMeta,
  schemaExists,
  readExistingSchema,
  readUserSkillSchema,
  validateSkillSchema,
  atomicWriteSchema,
  atomicWriteSchemaMeta,
  readSchemaMeta,
  readSkillMd,
  hashSkillMd,
  SCHEMA_GENERATOR_VERSION,
  computeSchemaStatus,
  updateSchemaMetaError,
  type SkillInfo,
  type SkillDetail,
  type CompatibilityCheckResult,
  type SkillSchema,
  type SchemaMeta,
  type SchemaStatus,
} from '~/claude/skills';
import { validateGitHubUrl } from '~/claude/skills/command-parser';

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

/**
 * Require system admin
 * Throws error if not admin
 */
const requireAdmin = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }

  // Check system role from database
  const { db } = await import('~/db/db-config');
  const { user: userTable } = await import('~/db/schema');
  const { eq } = await import('drizzle-orm');

  const userData = await db.query.user.findFirst({
    where: eq(userTable.id, session.user.id),
    columns: {
      systemRole: true,
    },
  });

  if (userData?.systemRole !== 'admin') {
    throw new Error('FORBIDDEN: Admin access required');
  }

  return session.user;
};

/**
 * Check if current user is system admin
 * Returns true/false without throwing error
 */
export const isAdminUser = createServerFn({ method: 'GET' }).handler(async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    return { isAdmin: false };
  }

  // Check system role from database
  const { db } = await import('~/db/db-config');
  const { user: userTable } = await import('~/db/schema');
  const { eq } = await import('drizzle-orm');

  const userData = await db.query.user.findFirst({
    where: eq(userTable.id, session.user.id),
    columns: {
      systemRole: true,
    },
  });

  return {
    isAdmin: userData?.systemRole === 'admin',
  };
});

// Input validation schemas
const enableSkillSchema = z.object({
  skillName: z.string().min(1),
});

const disableSkillSchema = z.object({
  skillName: z.string().min(1),
});

const setGlobalSkillSchema = z.object({
  skillName: z.string().min(1),
  enabled: z.boolean(),
});

const ensureSkillEnabledSchema = z.object({
  skillName: z.string().min(1),
});

const disableSkillsSchema = z.object({
  skillNames: z.array(z.string().min(1)).min(1),
});

const getSkillDetailSchema = z.object({
  skillSlug: z.string().min(1),
});

const getSkillSchemaSchema = z.object({
  skillSlug: z.string().min(1).nullable().optional(),
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
 * Get global skills (admin only)
 */
export const getGlobalSkillsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  const skills = await readGlobalSkills();
  return { skills };
});

/**
 * Enable/disable a global skill (admin only)
 */
export const setGlobalSkillEnabledFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return setGlobalSkillSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const skills = await setGlobalSkillEnabled(data.skillName, data.enabled);
    return { skills };
  });

/**
 * Get schema for a skill (if exists)
 * Authenticated users can read schema for composer hints.
 *
 * Reading order:
 * 1. Skills store (src/skills-store / SKILLS_STORE_DIR)
 * 2. User skills directory (~/.claude/skills/user/<skill-slug>/.schema.json)
 */
export const getSkillSchemaFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    // P1 fix: Use POST method for reliable serialization with useServerFn
    // GET method via useServerFn sends undefined input
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    const skillSlug = data && typeof data === 'object' && 'skillSlug' in data
      ? (data as { skillSlug?: string }).skillSlug
      : null;

    console.info('[Skills] getSkillSchemaFn input:', { skillSlug });

    return getSkillSchemaSchema.parse({ skillSlug });
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!data.skillSlug) {
      return { skillSlug: null, schema: null };
    }

    console.info('[Skills] getSkillSchema request', {
      skillSlug: data.skillSlug,
      userId: user.id,
    });

    // Try reading from skills store first
    let schema = await readExistingSchema(data.skillSlug);
    let source: 'store' | 'user' | null = schema ? 'store' : null;

    // Fallback to user skills directory
    if (!schema) {
      schema = await readUserSkillSchema(user.id, data.skillSlug);
      if (schema) source = 'user';
    }

    console.info('[Skills] getSkillSchema result', {
      skillSlug: data.skillSlug,
      source,
      hasSchema: Boolean(schema),
    });

    return { skillSlug: data.skillSlug, schema };
  });

/**
 * Get user's enabled skills
 * Authentication required
 */
export const listUserSkills = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const globalSkills = await ensureGlobalSkillsForUser(user.id);
  const enabledSlugs = await getUserEnabledSkills(user.id);
  const allSkills = await getSkillsStore();
  const effective = new Set([...enabledSlugs, ...globalSkills]);

  // Return full skill info for enabled skills only
  return allSkills.filter((skill) => effective.has(skill.slug));
});

/**
 * Ensure a skill is enabled for the current user (template/session helper)
 */
export const ensureUserSkillEnabledFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return ensureSkillEnabledSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const normalized = normalizeSkillName(data.skillName);
    const globalSkills = await readGlobalSkills();
    if (globalSkills.includes(normalized)) {
      await ensureGlobalSkillsForUser(user.id);
      return { skillName: normalized, enabledNow: false };
    }
    const enabled = await getUserEnabledSkills(user.id);
    if (enabled.includes(normalized)) {
      return { skillName: normalized, enabledNow: false };
    }
    await enableSkill(user.id, normalized);
    return { skillName: normalized, enabledNow: true };
  });

/**
 * Disable multiple skills for current user (used for session cleanup)
 */
export const disableUserSkillsFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return disableSkillsSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const disabled: string[] = [];
    for (const name of data.skillNames) {
      await disableSkill(user.id, name);
      disabled.push(normalizeSkillName(name));
    }
    return { disabled };
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
    const globalSkills = await readGlobalSkills();
    const normalized = normalizeSkillName(data.skillName);
    if (globalSkills.includes(normalized)) {
      throw new Error('SKILL_GLOBAL_ENABLED');
    }
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
 * Check skill compatibility before installation
 * Returns warnings about potential issues (browser/CDP, MCP dependencies)
 *
 * Only accepts files array (not tempDir) for security.
 * Path traversal protection prevents writing outside temp directory.
 */
export const checkSkillCompatibilityFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      files: z.array(z.object({
        path: z.string(),
        content: z.string(),
      })),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');

    // Create a secure temporary directory
    const tempDir = path.join(os.tmpdir(), `skill-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Validate each file path and write securely
      for (const file of data.files) {
        // Normalize the file path to prevent directory traversal
        const normalizedPath = path.normalize(file.path);

        // Check for path traversal attempts by examining path segments
        // This avoids false positives on legitimate file names like "file..txt"
        const pathSegments = normalizedPath.split(path.sep);
        if (pathSegments.includes('..')) {
          throw new Error(`Invalid file path: contains path traversal component: ${file.path}`);
        }

        // Ensure the path is relative (not absolute)
        if (path.isAbsolute(normalizedPath)) {
          throw new Error(`Invalid file path: absolute paths not allowed: ${file.path}`);
        }

        // Construct the full target path
        const filePath = path.join(tempDir, normalizedPath);

        // Verify the resolved path is within the temp directory
        const resolvedTarget = path.resolve(filePath);
        const resolvedTemp = path.resolve(tempDir);
        if (!resolvedTarget.startsWith(resolvedTemp + path.sep) && resolvedTarget !== resolvedTemp) {
          throw new Error(`Invalid file path: would write outside temp directory: ${file.path}`);
        }

        // Create parent directory and write file
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, 'utf-8');
      }

      // Check compatibility
      const result: CompatibilityCheckResult = await checkSkillCompatibility(tempDir);
      const warnings = formatCompatibilityWarnings(result);

      return {
        compatible: result.compatible,
        rawWarnings: result.warnings,
        formattedWarnings: warnings,
      };
    } finally {
      // Always clean up temporary directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

/**
 * Check GitHub skill compatibility before installation
 * Uses Archive downloader (not git clone) and validates GitHub URL strictly
 * Only scans the target skill directory, not the entire repository
 */
export const checkGitHubSkillCompatibilityFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      repoUrl: z.string(),
      skillName: z.string().min(1),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    await requireAdmin();

    // Validate GitHub URL strictly (only https://github.com/owner/repo or owner/repo)
    const urlValidation = validateGitHubUrl(data.repoUrl);
    if (!urlValidation.valid) {
      throw new Error(`Invalid GitHub URL: ${urlValidation.error}`);
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Import functions from github-installer
    const { downloadFromGitHub, getExtractedRootDir, findSkillDirectory } = await import('~/claude/skills/github-installer');
    const { normalizeSkillName } = await import('~/claude/skills');

    let tempDir: string | null = null;

    try {
      // Download archive from GitHub (no git required)
      const downloadResult = await downloadFromGitHub(urlValidation.owner!, urlValidation.repo!);
      tempDir = downloadResult.tempDir;

      // Get the extracted root directory
      const extractedRoot = await getExtractedRootDir(tempDir);

      // Find the target skill directory first
      const normalizedSkillName = normalizeSkillName(data.skillName);
      let skillDir: string;

      try {
        skillDir = await findSkillDirectory(extractedRoot, normalizedSkillName);
      } catch (findError) {
        // Skill not found - this is OK, just return no warnings
        // The actual installation will fail with a clearer error message
        return {
          compatible: true,
          rawWarnings: [],
          formattedWarnings: [],
        };
      }

      // Check compatibility ONLY for the target skill directory
      const result = await checkSkillCompatibility(skillDir);
      const warnings = formatCompatibilityWarnings(result);

      return {
        compatible: result.compatible,
        rawWarnings: result.warnings,
        formattedWarnings: warnings,
      };
    } finally {
      // Clean up temp directory
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  });

/**
 * Install a skill from GitHub (admin only)
 * Downloads archive from GitHub and installs to skills-store
 */
export const installGitHubSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      repoUrl: z.string(),
      skillName: z.string().min(1).max(100),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const adminUser = await requireAdmin();

    // Validate GitHub URL strictly
    const urlValidation = validateGitHubUrl(data.repoUrl);
    if (!urlValidation.valid) {
      throw new Error(`Invalid GitHub URL: ${urlValidation.error}`);
    }

    // Install the skill with correct signature
    const result = await installSkillFromGitHub({
      owner: urlValidation.owner!,
      repo: urlValidation.repo!,
      skillName: data.skillName,
      installedBy: adminUser.id,
    });

    // Note: Compatibility warnings are shown to user before installation
    // via checkGitHubSkillCompatibilityFn, so we don't block installation here

    return result;
  });

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

    // Auto-generate icon if description is provided and GEMINI_API_KEY is configured
    let iconUrl: string | undefined;
    if (data.description && process.env.GEMINI_API_KEY) {
      try {
        const { generateSkillIcon } = await import('~/claude/skills/icon-generator');
        const slug = normalizeSkillName(data.name);
        const result = await generateSkillIcon(slug, data.description);
        if (result.success) {
          iconUrl = result.iconUrl;
          console.log(`[SkillUpload] Auto-generated icon for "${data.name}": ${iconUrl}`);
        }
      } catch (iconError) {
        // Don't fail upload if icon generation fails
        console.error('[SkillUpload] Icon generation failed:', iconError);
      }
    }

    return {
      success: true,
      skillName: data.name,
      iconUrl,
    };
  });

/**
 * Get all skills (both official and user-uploaded)
 * Authentication required
 */
export const listAllSkillsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireUser();

    console.log(`[Skills] listAllSkillsFn called for user: ${user.id}`);

    // Import icon utility
    const { getSkillIconUrl } = await import('~/claude/skills/icon-generator');

    // Get official skills (from src/skills-store)
    const allOfficialSkills = await getSkillsStore();
    console.log(`[Skills] Official skills in store: ${allOfficialSkills.length}`);

    const globalSkills = await ensureGlobalSkillsForUser(user.id);
    console.log(`[Skills] Global skills after sync: ${globalSkills.length}`, globalSkills);

    const enabledOfficialSlugs = await getUserEnabledSkills(user.id);
    console.log(`[Skills] User enabled skills: ${enabledOfficialSlugs.length}`, enabledOfficialSlugs);

    const effectiveEnabled = new Set([...enabledOfficialSlugs, ...globalSkills]);
    console.log(`[Skills] Effective enabled: ${effectiveEnabled.size}`, [...effectiveEnabled]);

    // Check which skills are GitHub-installed (deletable by admin)
    // Use static imports (not dynamic) to avoid runtime issues
    const officialSkillsWithDeletable = await Promise.all(
      allOfficialSkills.map(async (skill) => {
        const extendedInfo = await getExtendedSkillInfo(skill.slug);
        return {
          ...skill,
          store: 'official' as const,
          enabled: effectiveEnabled.has(skill.slug),
          globalEnabled: globalSkills.includes(skill.slug),
          deletable: extendedInfo.isGitHubInstalled,
          iconUrl: getSkillIconUrl(skill.slug),
        };
      })
    );

    // Get user-uploaded skills
    const userSkills = await getUserUploadedSkills(user.id);

    return {
      official: officialSkillsWithDeletable,
      user: userSkills.map(skill => ({
        ...skill,
        store: 'user' as const,
        deletable: true, // User skills are always deletable
        iconUrl: getSkillIconUrl(skill.slug),
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

/**
 * Delete a GitHub-installed skill from the global Skills Store
 * Admin only - requires systemRole='admin'
 */
export const deleteGitHubSkillFn = createServerFn({ method: 'POST' })
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
    // Require admin access
    const adminUser = await requireAdmin();

    // Call delete function (using static import)
    await deleteGitHubSkill(data.skillName);

    return {
      success: true,
      skillName: data.skillName,
      deletedBy: adminUser.id,
    };
  });

// ============================================================================
// Schema Generation Server Functions (Independent SDK Call Chain)
// ============================================================================

/**
 * Generate JSON Schema for a skill using Claude Agent SDK
 *
 * IMPORTANT: This uses a completely INDEPENDENT call chain from WS chat:
 * - Direct SDK query() call (not through ws-server/ws-query-worker)
 * - No WebSocket dependencies
 * - No session state
 * - No MCP tools / file operations
 * - Pure text generation with Structured Outputs
 *
 * Admin only - uses API credits for each generation.
 *
 * Now writes both .schema.json and .schema.meta.json for status tracking.
 *
 * Caching:
 * - If .schema.json exists, hash matches, and force=false, returns cached schema
 * - If force=true, regenerates and overwrites existing schema
 */
export const generateSkillSchemaFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      skillSlug: z.string().min(1),
      force: z.boolean().optional().default(false),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    // Require admin access (uses API credits)
    const adminUser = await requireAdmin();

    console.log(`[Schema Server] Admin ${adminUser.id} requested schema for: ${data.skillSlug}`);

    try {
      // Generate schema with meta (uses independent SDK call chain)
      const result = await generateSkillSchemaWithMeta({
        skillSlug: data.skillSlug,
        userId: adminUser.id,
        force: data.force,
      });

      console.log(`[Schema Server] Schema ${result.cached ? 'cached' : 'generated'} for: ${data.skillSlug}`);

      return {
        success: true,
        skillSlug: data.skillSlug,
        schema: result.schema,
        meta: result.meta,
        cached: result.cached,
        generatedBy: adminUser.id,
      };
    } catch (error) {
      // Log error and update meta with error info
      console.error(`[Schema Server] Failed to generate schema for ${data.skillSlug}:`, error);

      // Record the error in meta (non-blocking)
      try {
        await updateSchemaMetaError(
          data.skillSlug,
          error instanceof Error ? error.message : 'Unknown error',
          adminUser.id,
        );
      } catch (metaError) {
        console.error(`[Schema Server] Failed to update meta with error:`, metaError);
      }

      throw new Error(
        error instanceof Error
          ? `Schema generation failed: ${error.message}`
          : 'Schema generation failed: Unknown error'
      );
    }
  });

/**
 * Update a skill schema manually (admin only).
 *
 * Allows admins to adjust required fields or other schema details from UI.
 * Writes .schema.json and updates .schema.meta.json with latest timestamps.
 */
export const updateSkillSchemaFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      skillSlug: z.string().min(1),
      schema: z.unknown(),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const adminUser = await requireAdmin();

    // Validate schema payload
    const validatedSchema = validateSkillSchema(data.schema);

    // Write schema atomically
    await atomicWriteSchema(data.skillSlug, validatedSchema);

    // Update meta to reflect manual edit
    const now = new Date().toISOString();
    const skillMd = await readSkillMd(data.skillSlug);
    const skillMdHash = hashSkillMd(skillMd);
    const existingMeta = await readSchemaMeta(data.skillSlug);

    const meta: SchemaMeta = {
      generatedAt: now,
      lastAttemptAt: now,
      generatedBy: adminUser.id,
      model: existingMeta?.model ?? 'manual',
      skillMdHash,
      generatorVersion: existingMeta?.generatorVersion ?? SCHEMA_GENERATOR_VERSION,
      lastError: undefined,
      needsReview: false,
    };

    await atomicWriteSchemaMeta(data.skillSlug, meta);

    return {
      success: true,
      skillSlug: data.skillSlug,
      schema: validatedSchema,
      meta,
    };
  });

/**
 * Check if schema exists for a skill
 * Admin only - useful for UI to show generate/regenerate button
 *
 * @deprecated Use getSkillSchemaStatusFn for richer status information
 *
 * Returns:
 * - exists: true if .schema.json file exists on disk
 * - valid: true if schema exists AND can be parsed successfully
 * - schema: the parsed schema (null if not exists or parse failed)
 */
export const checkSkillSchemaExistsFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const skillSlug = searchParams?.get('skillSlug') ||
      (typeof input === 'object' && input && 'skillSlug' in input
        ? (input as { skillSlug?: string }).skillSlug
        : null);

    return z.object({
      skillSlug: z.string().min(1),
    }).parse({ skillSlug });
  })
  .handler(async ({ data }) => {
    await requireAdmin();

    // Try to read and parse the schema
    const schema = await readExistingSchema(data.skillSlug);

    // Determine status based on parse result
    // - exists: file exists on disk (we check via schemaExists for accuracy)
    // - valid: schema was successfully parsed
    const exists = await schemaExists(data.skillSlug);

    return {
      exists,
      valid: schema !== null,  // P1 fix: explicit valid flag
      schema,
      skillSlug: data.skillSlug,
    };
  });

/**
 * Get comprehensive schema status for a skill
 *
 * Admin only - provides full status information for UI management.
 *
 * Status values:
 * - 'missing': .schema.json does not exist
 * - 'valid': exists and parses successfully, hash matches SKILL.md
 * - 'invalid': exists but parse failed
 * - 'stale': skillMdHash mismatch with current SKILL.md
 * - 'failed': last generation failed (meta.lastError present)
 *
 * Returns:
 * - status: SchemaStatus value
 * - schema: parsed schema (null if missing/invalid)
 * - meta: SchemaMeta (null if no meta file)
 * - skillSlug: normalized skill slug
 */
export const getSkillSchemaStatusFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const skillSlug = searchParams?.get('skillSlug') ||
      (typeof input === 'object' && input && 'skillSlug' in input
        ? (input as { skillSlug?: string }).skillSlug
        : null);

    return z.object({
      skillSlug: z.string().min(1),
    }).parse({ skillSlug });
  })
  .handler(async ({ data }) => {
    await requireAdmin();

    const statusInfo = await computeSchemaStatus(data.skillSlug);

    return {
      status: statusInfo.status,
      schema: statusInfo.schema,
      meta: statusInfo.meta,
      skillSlug: statusInfo.skillSlug,
    };
  });

// ============================================================
// Icon Generation
// ============================================================

import {
  generateSkillIcon,
  getSkillIconUrl,
  deleteSkillIcon,
} from '~/claude/skills/icon-generator';

const generateIconSchema = z.object({
  skillSlug: z.string().min(1),
  description: z.string().min(1),
});

/**
 * Generate icon for a skill using Gemini API
 *
 * Can be called:
 * 1. Automatically after skill upload (with description from SKILL.md)
 * 2. Manually by admin to regenerate
 *
 * Returns the icon URL on success.
 */
export const generateSkillIconFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return generateIconSchema.parse(data);
  })
  .handler(async ({ data }) => {
    // Allow authenticated users (auto-generation on upload)
    // or admin (manual regeneration)
    await requireUser();

    const result = await generateSkillIcon(data.skillSlug, data.description);

    if (result.success && result.iconUrl) {
      return {
        success: true,
        iconUrl: result.iconUrl,
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to generate icon',
    };
  });

/**
 * Get icon URL for a skill
 */
export const getSkillIconUrlFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const skillSlug = searchParams?.get('skillSlug') ||
      (typeof input === 'object' && input && 'skillSlug' in input
        ? (input as { skillSlug?: string }).skillSlug
        : null);

    return z.object({
      skillSlug: z.string().min(1),
    }).parse({ skillSlug });
  })
  .handler(async ({ data }) => {
    const iconUrl = getSkillIconUrl(data.skillSlug);
    return { iconUrl };
  });

/**
 * Delete icon for a skill (admin only)
 */
export const deleteSkillIconFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;

    return z.object({
      skillSlug: z.string().min(1),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    await requireAdmin();

    const deleted = deleteSkillIcon(data.skillSlug);
    return { deleted };
  });

