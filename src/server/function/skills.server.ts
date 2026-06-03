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
import type { CatalogSchemaResult } from '~/claude/skills/catalog-schema';
import type { SkillsApiListItem } from '~/claude/skills/skills-api-client';

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
 * Curated skill catalog item (DB-backed, the "product" layer).
 * Read-only display shape for the Capability Center curated preview (Skills S1a).
 * Runtime enable/materialization + SKILL.md detail are later phases (S1b/S2).
 */
export interface CuratedSkillItem {
  slug: string;
  name: string;
  titleZh: string | null;
  summaryZh: string | null;
  category: string | null;
  level: string | null;
  tags: string[];
  reusabilityStatus: string | null;
  iconEmoji: string | null;
  addsCount: string | null;
  source: string;
  githubUrl: string | null;
  skillsShUrl: string | null;
  sourceLabel: string | null;
  sourceIcon: string | null;
}

/**
 * List the curated skill catalog (DB-backed, seeded from the platform's curated-100).
 *
 * No authentication required — this is the public catalog (browse/search/category).
 * Returns official-scope curated/builtin skills ordered by editorial sortWeight.
 * See docs/project/prd/2026-06-skills-integration-prd.md (S1).
 */
export const listCuratedSkillsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CuratedSkillItem[]> => {
    const { db } = await import('~/db/db-config');
    const { skillCatalog } = await import('~/db/schema');
    const { eq, desc, asc } = await import('drizzle-orm');

    const rows = await db
      .select({
        slug: skillCatalog.slug,
        name: skillCatalog.name,
        titleZh: skillCatalog.titleZh,
        summaryZh: skillCatalog.summaryZh,
        category: skillCatalog.category,
        level: skillCatalog.level,
        tags: skillCatalog.tags,
        reusabilityStatus: skillCatalog.reusabilityStatus,
        iconEmoji: skillCatalog.iconEmoji,
        addsCount: skillCatalog.addsCount,
        source: skillCatalog.source,
        githubUrl: skillCatalog.githubUrl,
        skillsShUrl: skillCatalog.skillsShUrl,
        sourceLabel: skillCatalog.sourceLabel,
        sourceIcon: skillCatalog.sourceIcon,
      })
      .from(skillCatalog)
      .where(eq(skillCatalog.scope, 'official'))
      .orderBy(desc(skillCatalog.sortWeight), asc(skillCatalog.name));

    return rows.map((r) => ({
      ...r,
      tags: Array.isArray(r.tags) ? r.tags : [],
    }));
  },
);

/**
 * Status of a curated skill's SKILL.md content.
 * - cached: served from skill_content_cache
 * - fetched: just fetched from skills-api and cached
 * - no_upstream: catalog row has no upstream ref (cannot fetch)
 * - unavailable: fetch failed (network / 404) and nothing cached
 */
export type CuratedContentStatus = 'cached' | 'fetched' | 'no_upstream' | 'unavailable';

export interface CuratedSkillDetail {
  slug: string;
  name: string;
  titleZh: string | null;
  summaryZh: string | null;
  category: string | null;
  level: string | null;
  tags: string[];
  reusabilityStatus: string | null;
  suitableForZh: string | null;
  problemZh: string | null;
  firstTaskZh: string | null;
  riskNotesZh: string | null;
  iconEmoji: string | null;
  source: string;
  githubUrl: string | null;
  skillsShUrl: string | null;
  sourceLabel: string | null;
  // Content (from skills-api, cached in skill_content_cache)
  skillMd: string | null;
  instructions: string | null;
  metadata: Record<string, string> | null;
  contentHash: string | null;
  contentStatus: CuratedContentStatus;
  contentError: string | null;
}

/**
 * Get a curated skill's full detail: editorial fields (from skill_catalog) +
 * SKILL.md content (cache-first from skill_content_cache, else fetched from
 * skills-api and cached). Authenticated — content fetch hits an external API
 * and writes the cache. See PRD S1b.
 */
export const getCuratedSkillDetailFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({
      slug: z.string().min(1),
      force: z.boolean().optional().default(false),
    }).parse(data);
  })
  .handler(async ({ data }): Promise<CuratedSkillDetail> => {
    const user = await requireUser();

    const { db } = await import('~/db/db-config');
    const { skillContentCache } = await import('~/db/schema');
    const { eq } = await import('drizzle-orm');
    const { fetchSkillContent, parseSkillMarkdown } = await import('~/claude/skills/skills-api-client');

    // Official by slug, else the user's own upstream-added entry (S3).
    const row = await loadCatalogRowForUser(data.slug, user.id);

    if (!row) {
      throw new Error(`Curated skill not found: ${data.slug}`);
    }

    const editorial = {
      slug: row.slug,
      name: row.name,
      titleZh: row.titleZh,
      summaryZh: row.summaryZh,
      category: row.category,
      level: row.level,
      tags: Array.isArray(row.tags) ? row.tags : [],
      reusabilityStatus: row.reusabilityStatus,
      suitableForZh: row.suitableForZh,
      problemZh: row.problemZh,
      firstTaskZh: row.firstTaskZh,
      riskNotesZh: row.riskNotesZh,
      iconEmoji: row.iconEmoji,
      source: row.source,
      githubUrl: row.githubUrl,
      skillsShUrl: row.skillsShUrl,
      sourceLabel: row.sourceLabel,
    };

    const renderContent = (
      raw: string | null,
      contentHash: string | null,
      status: CuratedContentStatus,
      contentError: string | null,
    ): CuratedSkillDetail => {
      const { metadata, body } = parseSkillMarkdown(raw);
      return {
        ...editorial,
        skillMd: raw,
        instructions: raw ? body : null,
        metadata: raw ? metadata : null,
        contentHash,
        contentStatus: status,
        contentError,
      };
    };

    // Cache-first
    if (!data.force) {
      const [cached] = await db
        .select()
        .from(skillContentCache)
        .where(eq(skillContentCache.catalogId, row.id))
        .limit(1);
      if (cached?.skillMd) {
        return renderContent(cached.skillMd, cached.contentHash, 'cached', null);
      }
    }

    if (!row.upstream) {
      return renderContent(null, null, 'no_upstream', null);
    }

    // Fetch from skills-api + cache
    try {
      const content = await fetchSkillContent(row.upstream);
      const raw = content.raw ?? null;
      if (!raw) {
        return renderContent(null, null, 'unavailable', 'skills-api returned empty content');
      }
      const contentHash = hashSkillMd(raw);
      const now = new Date();
      await db
        .insert(skillContentCache)
        .values({
          catalogId: row.id,
          skillMd: raw,
          contentHash,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: skillContentCache.catalogId,
          set: { skillMd: raw, contentHash, fetchedAt: now },
        });
      return renderContent(raw, contentHash, 'fetched', null);
    } catch (error) {
      console.error('[Skills] getCuratedSkillDetail content fetch failed', {
        slug: data.slug,
        error: error instanceof Error ? error.message : String(error),
      });
      // Last-resort: return any stale cache even on force
      const [cached] = await db
        .select()
        .from(skillContentCache)
        .where(eq(skillContentCache.catalogId, row.id))
        .limit(1);
      if (cached?.skillMd) {
        return renderContent(cached.skillMd, cached.contentHash, 'cached', null);
      }
      return renderContent(
        null,
        null,
        'unavailable',
        error instanceof Error ? error.message : 'content fetch failed',
      );
    }
  });

// ============================================================================
// Catalog "install" (My Skills) — S2 execution layer
//
// Install = materialize the skill onto disk (per-user) + record in
// skill_enablement. Takes effect on the NEXT new conversation (this SDK version
// does not hot-reload a running session). Default skills (find-skills,
// skill-creator) are always installed and locked. See PRD D6/D7/S2.
// ============================================================================

export interface MySkillItem {
  slug: string;
  name: string;
  titleZh: string | null;
  iconEmoji: string | null;
  category: string | null;
  source: string;
  isDefault: boolean;
}

const curatedSlugSchema = z.object({ slug: z.string().min(1) });

function parseSlugInput(input: unknown): { slug: string } {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : payload;
  return curatedSlugSchema.parse(data);
}

/** Load an official catalog row by slug (id + source + upstream). */
async function loadOfficialCatalogRow(slug: string) {
  const { db } = await import('~/db/db-config');
  const { skillCatalog } = await import('~/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const [row] = await db
    .select({
      id: skillCatalog.id,
      slug: skillCatalog.slug,
      source: skillCatalog.source,
      upstream: skillCatalog.upstream,
    })
    .from(skillCatalog)
    .where(and(eq(skillCatalog.slug, slug), eq(skillCatalog.scope, 'official')))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a catalog skill visible to a user: an official entry by slug, else
 * the user's own upstream-added entry. Returns the full row (or null).
 * S3: makes user-added skills first-class for install/detail/schema.
 */
async function loadCatalogRowForUser(slug: string, userId: string) {
  const { db } = await import('~/db/db-config');
  const { skillCatalog } = await import('~/db/schema');
  const { and, eq } = await import('drizzle-orm');

  const [official] = await db
    .select()
    .from(skillCatalog)
    .where(and(eq(skillCatalog.slug, slug), eq(skillCatalog.scope, 'official')))
    .limit(1);
  if (official) return official;

  const [own] = await db
    .select()
    .from(skillCatalog)
    .where(and(
      eq(skillCatalog.slug, slug),
      eq(skillCatalog.scope, 'user'),
      eq(skillCatalog.ownerUserId, userId),
    ))
    .limit(1);
  return own ?? null;
}

/**
 * List the current user's installed skills (My Skills).
 */
export const listMySkillsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MySkillItem[]> => {
    const user = await requireUser();
    const { db } = await import('~/db/db-config');
    const { skillCatalog, skillEnablement } = await import('~/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const { isDefaultSkill } = await import('~/claude/skills/catalog-materializer');

    const rows = await db
      .select({
        slug: skillCatalog.slug,
        name: skillCatalog.name,
        titleZh: skillCatalog.titleZh,
        iconEmoji: skillCatalog.iconEmoji,
        category: skillCatalog.category,
        source: skillCatalog.source,
      })
      .from(skillEnablement)
      .innerJoin(skillCatalog, eq(skillEnablement.catalogId, skillCatalog.id))
      .where(and(eq(skillEnablement.userId, user.id), eq(skillEnablement.enabled, true)));

    return rows.map((r) => ({ ...r, isDefault: isDefaultSkill(r.slug) }));
  },
);

/**
 * Install (enable) a catalog skill for the current user:
 * materialize onto disk + record in skill_enablement. Effective next conversation.
 */
export const installCuratedSkillFn = createServerFn({ method: 'POST' })
  .inputValidator(parseSlugInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db } = await import('~/db/db-config');
    const { skillEnablement } = await import('~/db/schema');
    const { materializeCatalogSkill } = await import('~/claude/skills/catalog-materializer');

    const row = await loadCatalogRowForUser(data.slug, user.id);
    if (!row) throw new Error(`Curated skill not found: ${data.slug}`);

    const result = await materializeCatalogSkill(user.id, row);
    if (!result.ok) {
      throw new Error(`Failed to install ${data.slug}: ${result.error ?? result.status}`);
    }

    const now = new Date();
    await db
      .insert(skillEnablement)
      .values({ userId: user.id, catalogId: row.id, enabled: true, updatedAt: now })
      .onConflictDoUpdate({
        target: [skillEnablement.userId, skillEnablement.catalogId],
        set: { enabled: true, updatedAt: now },
      });

    return { slug: data.slug, installed: true, effectiveNextConversation: true };
  });

/**
 * Uninstall (disable) a catalog skill for the current user:
 * remove the materialized dir + clear skill_enablement. Default skills are locked.
 */
export const uninstallCuratedSkillFn = createServerFn({ method: 'POST' })
  .inputValidator(parseSlugInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { isDefaultSkill, dematerializeSkill } = await import('~/claude/skills/catalog-materializer');

    if (isDefaultSkill(data.slug)) {
      throw new Error('SKILL_DEFAULT_LOCKED');
    }

    const { db } = await import('~/db/db-config');
    const { skillEnablement } = await import('~/db/schema');
    const { and, eq } = await import('drizzle-orm');

    const row = await loadCatalogRowForUser(data.slug, user.id);
    if (!row) throw new Error(`Curated skill not found: ${data.slug}`);

    await dematerializeSkill(user.id, data.slug);
    await db
      .delete(skillEnablement)
      .where(and(eq(skillEnablement.userId, user.id), eq(skillEnablement.catalogId, row.id)));

    return { slug: data.slug, installed: false };
  });

/**
 * Ensure the default skills (find-skills + skill-creator) are installed for the
 * current user. Idempotent — call on app/chat load. Materializes any missing
 * default and records enablement.
 */
export const ensureDefaultSkillsFn = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser();
  const { db } = await import('~/db/db-config');
  const { skillCatalog, skillEnablement } = await import('~/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const { DEFAULT_SKILL_SLUGS, materializeCatalogSkill } = await import('~/claude/skills/catalog-materializer');

  const ensured: string[] = [];
  for (const slug of DEFAULT_SKILL_SLUGS) {
    const row = await loadOfficialCatalogRow(slug);
    if (!row) {
      console.warn(`[Skills] default skill not in catalog, skipping: ${slug}`);
      continue;
    }

    const [existing] = await db
      .select({ enabled: skillEnablement.enabled })
      .from(skillEnablement)
      .where(and(eq(skillEnablement.userId, user.id), eq(skillEnablement.catalogId, row.id)))
      .limit(1);
    if (existing?.enabled) continue;

    const result = await materializeCatalogSkill(user.id, row);
    if (!result.ok) {
      console.error(`[Skills] failed to materialize default skill ${slug}:`, result.error);
      continue;
    }

    const now = new Date();
    await db
      .insert(skillEnablement)
      .values({ userId: user.id, catalogId: row.id, enabled: true, updatedAt: now })
      .onConflictDoUpdate({
        target: [skillEnablement.userId, skillEnablement.catalogId],
        set: { enabled: true, updatedAt: now },
      });
    ensured.push(slug);
  }

  return { ensured };
});

// ============================================================================
// Catalog fillable-variable schema (S2.2) — generated from SKILL.md, cached in
// skill_schema_cache by content hash. Lazy/on-demand (each generation is an SDK
// call); the cache is global per (catalogId, contentHash). See PRD D5/S2.2.
// ============================================================================

/**
 * Read the cached fillable-variable schema for a curated skill (no generation).
 */
export const getCuratedSkillSchemaFn = createServerFn({ method: 'POST' })
  .inputValidator(parseSlugInput)
  .handler(async ({ data }): Promise<CatalogSchemaResult> => {
    const user = await requireUser();
    const { readCatalogSchema } = await import('~/claude/skills/catalog-schema');
    const row = await loadCatalogRowForUser(data.slug, user.id);
    if (!row) throw new Error(`Curated skill not found: ${data.slug}`);
    return await readCatalogSchema(row.id);
  });

/**
 * Generate (or refresh) the fillable-variable schema for a curated skill.
 * Costs an SDK/LLM call; result is cached globally by content hash.
 */
export const generateCuratedSkillSchemaFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({ slug: z.string().min(1), force: z.boolean().optional().default(false) }).parse(data);
  })
  .handler(async ({ data }): Promise<CatalogSchemaResult> => {
    const user = await requireUser();
    const { generateCatalogSchema } = await import('~/claude/skills/catalog-schema');
    const row = await loadCatalogRowForUser(data.slug, user.id);
    if (!row) throw new Error(`Curated skill not found: ${data.slug}`);
    return await generateCatalogSchema({ id: row.id, upstream: row.upstream }, { force: data.force });
  });

// ============================================================================
// Upstream discovery / add (S3) — search the skills-api registry and pull a
// skill into the user's own catalog (scope='user', source='upstream'). Once
// added it installs / shows detail / generates schema like any catalog skill.
// Admins can see + remove all user-added skills (governance guardrail).
// ============================================================================

export type UpstreamSkillStatus = 'official' | 'added' | 'addable';
export interface UpstreamSearchItem extends SkillsApiListItem {
  slug: string;
  status: UpstreamSkillStatus;
}
export interface UpstreamSearchResponse {
  items: UpstreamSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Search the upstream skills-api registry. Each result is tagged with whether
 * it's already in the official library, already added by this user, or addable.
 */
export const searchUpstreamSkillsFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({
      query: z.string().optional().default(''),
      page: z.number().int().min(1).optional().default(1),
    }).parse(data);
  })
  .handler(async ({ data }): Promise<UpstreamSearchResponse> => {
    const user = await requireUser();
    const { searchSkills } = await import('~/claude/skills/skills-api-client');
    const { db } = await import('~/db/db-config');
    const { skillCatalog } = await import('~/db/schema');
    const { and, eq, inArray } = await import('drizzle-orm');

    const result = await searchSkills({ query: data.query || undefined, page: data.page, pageSize: 20 });
    const slugs = result.skills.map((s) => normalizeSkillName(s.skillId));

    const officialSlugs = new Set<string>();
    const addedSlugs = new Set<string>();
    if (slugs.length > 0) {
      const official = await db
        .select({ slug: skillCatalog.slug })
        .from(skillCatalog)
        .where(and(eq(skillCatalog.scope, 'official'), inArray(skillCatalog.slug, slugs)));
      official.forEach((r) => officialSlugs.add(r.slug));

      const added = await db
        .select({ slug: skillCatalog.slug })
        .from(skillCatalog)
        .where(and(
          eq(skillCatalog.scope, 'user'),
          eq(skillCatalog.ownerUserId, user.id),
          inArray(skillCatalog.slug, slugs),
        ));
      added.forEach((r) => addedSlugs.add(r.slug));
    }

    const items: UpstreamSearchItem[] = result.skills.map((s) => {
      const slug = normalizeSkillName(s.skillId);
      const status: UpstreamSkillStatus = officialSlugs.has(slug)
        ? 'official'
        : addedSlugs.has(slug)
          ? 'added'
          : 'addable';
      return { ...s, slug, status };
    });

    return { items, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages };
  });

/**
 * Add an upstream skill to the current user's catalog (scope='user').
 * Skips if an official entry with the same slug exists (points to it instead);
 * idempotent if the user already added it. Best-effort content prefetch.
 */
export const addUpstreamSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      skillId: z.string().min(1),
      name: z.string().optional(),
      githubUrl: z.string().optional(),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db } = await import('~/db/db-config');
    const { skillCatalog } = await import('~/db/schema');
    const { and, eq } = await import('drizzle-orm');

    const slug = normalizeSkillName(data.skillId);

    // Official entry exists → don't duplicate; point the user to it.
    const [official] = await db
      .select({ id: skillCatalog.id })
      .from(skillCatalog)
      .where(and(eq(skillCatalog.slug, slug), eq(skillCatalog.scope, 'official')))
      .limit(1);
    if (official) {
      return { added: false, slug, reason: 'exists_official' as const };
    }

    // Already added by this user → idempotent.
    const [own] = await db
      .select({ id: skillCatalog.id })
      .from(skillCatalog)
      .where(and(eq(skillCatalog.slug, slug), eq(skillCatalog.scope, 'user'), eq(skillCatalog.ownerUserId, user.id)))
      .limit(1);
    if (own) {
      return { added: true, slug, reason: 'already_added' as const };
    }

    let inserted: { id: string } | undefined;
    try {
      [inserted] = await db
        .insert(skillCatalog)
        .values({
          slug,
          name: data.name || data.skillId,
          source: 'upstream',
          scope: 'user',
          ownerUserId: user.id,
          upstream: { owner: data.owner, repo: data.repo, skillId: data.skillId },
          githubUrl: data.githubUrl ?? null,
          sourceLabel: `${data.owner}/${data.repo}`,
        })
        .returning({ id: skillCatalog.id });
    } catch (error) {
      // Unique (ownerUserId, slug) race or a same-slug-different-repo conflict.
      console.warn('[Skills] addUpstreamSkill insert conflict:', error);
      return { added: false, slug, reason: 'slug_conflict' as const };
    }

    // Best-effort content prefetch (validates + caches); non-fatal.
    if (inserted) {
      try {
        const { getCatalogSkillContent } = await import('~/claude/skills/catalog-content');
        await getCatalogSkillContent({ id: inserted.id, upstream: { owner: data.owner, repo: data.repo, skillId: data.skillId } });
      } catch (error) {
        console.warn('[Skills] addUpstreamSkill content prefetch failed (non-fatal):', error);
      }
    }

    return { added: true, slug, reason: 'added' as const };
  });

/**
 * List the current user's upstream-added skills (scope='user').
 */
export const listMyAddedSkillsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CuratedSkillItem[]> => {
    const user = await requireUser();
    const { db } = await import('~/db/db-config');
    const { skillCatalog } = await import('~/db/schema');
    const { and, eq, desc } = await import('drizzle-orm');

    const rows = await db
      .select({
        slug: skillCatalog.slug,
        name: skillCatalog.name,
        titleZh: skillCatalog.titleZh,
        summaryZh: skillCatalog.summaryZh,
        category: skillCatalog.category,
        level: skillCatalog.level,
        tags: skillCatalog.tags,
        reusabilityStatus: skillCatalog.reusabilityStatus,
        iconEmoji: skillCatalog.iconEmoji,
        addsCount: skillCatalog.addsCount,
        source: skillCatalog.source,
        githubUrl: skillCatalog.githubUrl,
        skillsShUrl: skillCatalog.skillsShUrl,
        sourceLabel: skillCatalog.sourceLabel,
        sourceIcon: skillCatalog.sourceIcon,
      })
      .from(skillCatalog)
      .where(and(eq(skillCatalog.scope, 'user'), eq(skillCatalog.ownerUserId, user.id)))
      .orderBy(desc(skillCatalog.createdAt));

    return rows.map((r) => ({ ...r, tags: Array.isArray(r.tags) ? r.tags : [] }));
  },
);

/**
 * Remove one of the current user's upstream-added skills (deletes the catalog
 * row → cascade content/schema/enablement) and cleans the materialized dir.
 */
export const removeAddedSkillFn = createServerFn({ method: 'POST' })
  .inputValidator(parseSlugInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db } = await import('~/db/db-config');
    const { skillCatalog } = await import('~/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const { dematerializeSkill } = await import('~/claude/skills/catalog-materializer');

    const deleted = await db
      .delete(skillCatalog)
      .where(and(
        eq(skillCatalog.slug, data.slug),
        eq(skillCatalog.scope, 'user'),
        eq(skillCatalog.ownerUserId, user.id),
      ))
      .returning({ id: skillCatalog.id });

    if (deleted.length > 0) {
      await dematerializeSkill(user.id, data.slug);
    }
    return { removed: deleted.length > 0, slug: data.slug };
  });

/**
 * Normalize uploaded skill files: strip a single common root dir (so SKILL.md
 * sits at the root) and locate SKILL.md content.
 */
function normalizeUploadedSkillFiles(
  files: Array<{ path: string; content: string }>,
): { files: Array<{ path: string; content: string }>; skillMd: string | null } {
  const norm = files.map((f) => f.path.replace(/\\/g, '/').replace(/^\/+/, ''));
  const roots = new Set(norm.map((p) => (p.includes('/') ? p.split('/')[0] : '')));
  const stripRoot = roots.size === 1 && [...roots][0] !== '' && norm.every((p) => p.includes('/'));
  const out = files
    .map((f, i) => {
      let p = norm[i];
      if (stripRoot) p = p.split('/').slice(1).join('/');
      return { path: p, content: f.content };
    })
    .filter((f) => f.path);
  const skillMd =
    (out.find((f) => f.path === 'SKILL.md') ??
      out.find((f) => f.path.toLowerCase().endsWith('skill.md')))?.content ?? null;
  return { files: out, skillMd };
}

/**
 * Upload a user-created skill INTO the DB catalog (scope='user', source='upload').
 * Content (SKILL.md + files) is stored in skill_content_cache; install then
 * materializes it like any catalog skill. Re-upload overwrites. (S4 — replaces
 * the legacy FS-only uploadUserSkillFn.)
 */
export const uploadSkillToCatalogFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({
      name: z.string().min(1).max(80),
      description: z.string().optional(),
      files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
    }).parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();

    if (data.files.length > 100) throw new Error('Too many files (max 100 per skill).');
    const totalSize = data.files.reduce((sum, f) => sum + f.content.length, 0);
    if (totalSize > 10 * 1024 * 1024) throw new Error('Skill size exceeds 10 MB.');

    const { files, skillMd } = normalizeUploadedSkillFiles(data.files);
    if (!skillMd) throw new Error('Skill package must contain a SKILL.md file.');

    const { db } = await import('~/db/db-config');
    const { skillCatalog, skillContentCache } = await import('~/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const { hashSkillMd } = await import('~/claude/skills/schema-generator');

    const slug = normalizeSkillName(data.name);

    const [official] = await db
      .select({ id: skillCatalog.id })
      .from(skillCatalog)
      .where(and(eq(skillCatalog.slug, slug), eq(skillCatalog.scope, 'official')))
      .limit(1);
    if (official) throw new Error('A curated skill with this name already exists; pick another name.');

    const [existing] = await db
      .select({ id: skillCatalog.id })
      .from(skillCatalog)
      .where(and(eq(skillCatalog.slug, slug), eq(skillCatalog.scope, 'user'), eq(skillCatalog.ownerUserId, user.id)))
      .limit(1);

    let catalogId: string;
    if (existing) {
      catalogId = existing.id;
      await db
        .update(skillCatalog)
        .set({ name: data.name, summaryZh: data.description ?? null, updatedAt: new Date() })
        .where(eq(skillCatalog.id, catalogId));
    } else {
      const [ins] = await db
        .insert(skillCatalog)
        .values({
          slug,
          name: data.name,
          summaryZh: data.description ?? null,
          source: 'upload',
          scope: 'user',
          ownerUserId: user.id,
          sourceLabel: 'upload',
        })
        .returning({ id: skillCatalog.id });
      catalogId = ins.id;
    }

    const contentHash = hashSkillMd(skillMd);
    const now = new Date();
    const filesPayload = files.map((f) => ({ path: f.path, content: f.content, encoding: 'utf-8' }));
    await db
      .insert(skillContentCache)
      .values({ catalogId, skillMd, files: filesPayload, contentHash, fetchedAt: now })
      .onConflictDoUpdate({
        target: skillContentCache.catalogId,
        set: { skillMd, files: filesPayload, contentHash, fetchedAt: now },
      });

    return { slug, uploaded: true };
  });

// ── Admin governance: see + remove all user-added skills ─────────────────────

export interface AdminUserAddedSkill {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  upstream: { owner: string; repo: string; skillId: string } | null;
  githubUrl: string | null;
  createdAt: string | null;
}

/**
 * List ALL users' upstream-added skills (admin only) — governance guardrail.
 */
export const listAllUserAddedSkillsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminUserAddedSkill[]> => {
    await requireAdmin();
    const { db } = await import('~/db/db-config');
    const { skillCatalog, user: userTable } = await import('~/db/schema');
    const { eq, desc } = await import('drizzle-orm');

    const rows = await db
      .select({
        id: skillCatalog.id,
        slug: skillCatalog.slug,
        name: skillCatalog.name,
        ownerUserId: skillCatalog.ownerUserId,
        ownerEmail: userTable.email,
        ownerName: userTable.name,
        upstream: skillCatalog.upstream,
        githubUrl: skillCatalog.githubUrl,
        createdAt: skillCatalog.createdAt,
      })
      .from(skillCatalog)
      .leftJoin(userTable, eq(skillCatalog.ownerUserId, userTable.id))
      .where(eq(skillCatalog.scope, 'user'))
      .orderBy(desc(skillCatalog.createdAt));

    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt ? new Date(r.createdAt as unknown as string).toISOString() : null,
    }));
  },
);

/**
 * Remove any user-added skill by id (admin only) — governance guardrail.
 * Cascades content/schema/enablement and cleans the owner's materialized dir.
 */
export const adminRemoveUserAddedSkillFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({ id: z.string().min(1) }).parse(data);
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db } = await import('~/db/db-config');
    const { skillCatalog } = await import('~/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const { dematerializeSkill } = await import('~/claude/skills/catalog-materializer');

    const [row] = await db
      .select({ slug: skillCatalog.slug, ownerUserId: skillCatalog.ownerUserId })
      .from(skillCatalog)
      .where(and(eq(skillCatalog.id, data.id), eq(skillCatalog.scope, 'user')))
      .limit(1);
    if (!row) return { removed: false };

    await db.delete(skillCatalog).where(eq(skillCatalog.id, data.id));
    if (row.ownerUserId) {
      await dematerializeSkill(row.ownerUserId, row.slug);
    }
    return { removed: true };
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

