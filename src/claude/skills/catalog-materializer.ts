/**
 * Catalog → filesystem materializer (server-only).
 *
 * Projects an installed catalog skill onto disk at the per-user skills dir
 * `{claudeHome}/.claude/skills/<slug>/` so the Claude Agent SDK loads it on the
 * NEXT conversation (this SDK version does not hot-reload a running/resumed
 * session — see PRD D7 / the "需重新发起对话" contract).
 *
 * Content source:
 *  - source='builtin' → copy the directory from the FS skills-store (the legacy
 *    local store is currently empty — the 8 baoyu assets were retired per D9 —
 *    but the path is kept for any future local builtins)
 *  - source='curated'|'upstream' → write SKILL.md from skill_content_cache
 *    (fetched from skills-api on demand, cache-first)
 *
 * ws-server.mjs's filesystem sync preserves whatever is materialized here
 * (it only removes user-*disabled* skills), so this is the single write path;
 * no ws-server changes are needed.
 *
 * See docs/project/prd/2026-06-skills-integration-prd.md (S2).
 */

import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { getUserClaudeHome, getSkillsStoreDir, normalizeSkillName } from './manager';
import { fileExists } from './metadata';
import { getCatalogSkillContent } from './catalog-content';

/** Admin-default skills: always installed, locked (cannot be uninstalled). */
export const DEFAULT_SKILL_SLUGS = ['find-skills', 'skill-creator'] as const;

export function isDefaultSkill(slug: string): boolean {
  return (DEFAULT_SKILL_SLUGS as readonly string[]).includes(slug);
}

function userSkillDir(userId: string, slug: string): string {
  return path.join(getUserClaudeHome(userId), '.claude', 'skills', normalizeSkillName(slug));
}

export interface MaterializeResult {
  slug: string;
  ok: boolean;
  status: 'builtin_copied' | 'content_written' | 'skipped_no_content' | 'error';
  error?: string;
}

/**
 * Materialize one installed catalog skill onto disk for a user.
 * Idempotent: overwrites any existing directory (auto-update).
 */
export async function materializeCatalogSkill(
  userId: string,
  catalog: {
    id: string;
    slug: string;
    source: string;
    upstream: { owner: string; repo: string; skillId: string } | null;
  },
): Promise<MaterializeResult> {
  const slug = normalizeSkillName(catalog.slug);
  const targetDir = userSkillDir(userId, slug);

  try {
    if (catalog.source === 'builtin') {
      // Copy the whole skill directory from the FS skills-store.
      const sourceDir = path.join(getSkillsStoreDir(), slug);
      if (!(await fileExists(sourceDir))) {
        return { slug, ok: false, status: 'error', error: `builtin source not found: ${slug}` };
      }
      await fsp.rm(targetDir, { recursive: true, force: true });
      await fsp.mkdir(path.dirname(targetDir), { recursive: true });
      await fsp.cp(sourceDir, targetDir, { recursive: true });
      return { slug, ok: true, status: 'builtin_copied' };
    }

    // curated / upstream → write SKILL.md from the content cache (cache-first).
    const content = await getCatalogSkillContent({ id: catalog.id, upstream: catalog.upstream });
    if (!content.skillMd) {
      return {
        slug,
        ok: false,
        status: 'skipped_no_content',
        error: content.error ?? content.status,
      };
    }
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(path.join(targetDir, 'SKILL.md'), content.skillMd, 'utf-8');
    return { slug, ok: true, status: 'content_written' };
  } catch (error) {
    return {
      slug,
      ok: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'materialize failed',
    };
  }
}

/**
 * Remove a materialized skill directory for a user (uninstall projection).
 * Does NOT touch the global/disabled lists — catalog skills are not global, so
 * ws-server's sync won't re-add them.
 */
export async function dematerializeSkill(userId: string, slug: string): Promise<void> {
  await fsp.rm(userSkillDir(userId, normalizeSkillName(slug)), { recursive: true, force: true });
}
