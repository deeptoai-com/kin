/**
 * Skill Catalog Schema (Skills integration, S1)
 *
 * DB-backed catalog of curated + user-added skills (the "product" layer), seeded
 * from the platform's curated-100 manifest. Content (SKILL.md) is fetched from the
 * upstream skills-api and cached; the fillable-variable schema is generated locally.
 *
 * DB = source of truth; the SDK runtime gets an on-disk projection of enabled skills
 * (materialized to ~/.claude/skills/<slug>/), per the persistence/architecture decisions.
 * See docs/project/prd/2026-06-skills-integration-prd.md.
 */

import {
  pgTable, text, integer, boolean, jsonb, uuid, index, uniqueIndex, pgEnum, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema';
import { createdAt, updatedAt, timestamptz } from './_shared';

// ── Enums (mirror the platform's CuratedSkillSeed) ────────────────────────────
export const skillCategoryEnum = pgEnum('skill_category', [
  'ai_engineering', 'research', 'writing', 'design_frontend', 'automation', 'learning', 'security',
]);
export const skillLevelEnum = pgEnum('skill_level', ['L1', 'L2', 'L3', 'L4', 'L5']);
export const skillReusabilityEnum = pgEnum('skill_reusability', [
  'ready', 'minor_adaptation', 'major_adaptation', 'unknown',
]);
export const skillSourceEnum = pgEnum('skill_source', ['curated', 'upstream', 'builtin', 'upload']);
export const skillScopeEnum = pgEnum('skill_scope', ['official', 'user']);
export const skillSchemaStatusEnum = pgEnum('skill_schema_status', [
  'missing', 'valid', 'stale', 'failed', 'needs_review',
]);

export type SkillUpstreamRef = { owner: string; repo: string; skillId: string };

// ── skill_catalog ─ the product layer (editorial metadata + upstream reference) ─
export const skillCatalog = pgTable('skill_catalog', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),

  // Editorial layer (Chinese now; English columns can be added later)
  titleZh: text('title_zh'),
  summaryZh: text('summary_zh'),
  category: skillCategoryEnum('category'),
  level: skillLevelEnum('level'),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  reusabilityStatus: skillReusabilityEnum('reusability_status'),
  suitableForZh: text('suitable_for_zh'),
  problemZh: text('problem_zh'),
  firstTaskZh: text('first_task_zh'),
  riskNotesZh: text('risk_notes_zh'),
  iconEmoji: text('icon_emoji'),
  sortWeight: integer('sort_weight').default(0).notNull(),
  addsCount: text('adds_count'),

  // Upstream reference (to fetch SKILL.md from skills-api) + provenance
  source: skillSourceEnum('source').notNull().default('curated'),
  upstream: jsonb('upstream').$type<SkillUpstreamRef | null>(),
  installCommand: text('install_command'),
  githubUrl: text('github_url'),
  skillsShUrl: text('skills_sh_url'),
  sourceLabel: text('source_label'),
  sourceIcon: text('source_icon'),

  // Scope: official (curated/builtin, shared) vs user (added from upstream)
  scope: skillScopeEnum('scope').notNull().default('official'),
  ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  // Official skills: slug unique. User skills: slug unique per owner.
  officialSlugIdx: uniqueIndex('idx_skill_catalog_official_slug')
    .on(t.slug).where(sql`scope = 'official'`),
  userSlugIdx: uniqueIndex('idx_skill_catalog_user_slug')
    .on(t.ownerUserId, t.slug).where(sql`scope = 'user'`),
  categoryIdx: index('idx_skill_catalog_category').on(t.category),
  sortIdx: index('idx_skill_catalog_sort').on(t.sortWeight),
}));

// ── skill_content_cache ─ SKILL.md (+files) fetched from skills-api, by content hash
export const skillContentCache = pgTable('skill_content_cache', {
  catalogId: uuid('catalog_id').primaryKey()
    .references(() => skillCatalog.id, { onDelete: 'cascade' }),
  skillMd: text('skill_md'),
  files: jsonb('files').$type<Array<{ path: string; content: string; encoding: string }> | null>(),
  contentHash: text('content_hash'),
  upstreamScrapedAt: text('upstream_scraped_at'),
  fetchedAt: timestamptz('fetched_at'),
});

// ── skill_schema_cache ─ locally-generated fillable-variable schema, by content hash
export const skillSchemaCache = pgTable('skill_schema_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  catalogId: uuid('catalog_id').notNull()
    .references(() => skillCatalog.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: jsonb('schema').$type<Record<string, any> | null>(),
  status: skillSchemaStatusEnum('status').notNull().default('missing'),
  generatorVersion: text('generator_version'),
  lastError: text('last_error'),
  generatedAt: timestamptz('generated_at'),
}, (t) => ({
  uniq: uniqueIndex('idx_skill_schema_catalog_hash').on(t.catalogId, t.contentHash),
}));

// ── skill_enablement ─ per-user enable state ─────────────────────────────────
export const skillEnablement = pgTable('skill_enablement', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  catalogId: uuid('catalog_id').notNull()
    .references(() => skillCatalog.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: updatedAt(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.catalogId] }),
}));
