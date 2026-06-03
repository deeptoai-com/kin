/**
 * Seed the curated-100 skills into skill_catalog (source='curated', scope='official').
 *
 * Source data: src/db/seed/curated-skills.json (extracted from the platform's
 * CURATED_SKILLS manifest). Idempotent: upserts by slug among official rows.
 *
 * Usage: DATABASE_URL="..." npx tsx src/db/seed/seed-curated-skills.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { skillCatalog, type SkillUpstreamRef } from '../schema/skill-catalog.schema';

type CuratedSkillSeed = {
  slug: string; name: string; titleZh: string; summaryZh: string;
  category: string; level: string; recommendationTags: string[];
  reusabilityStatus: string; suitableForZh: string; problemZh: string;
  firstTaskZh: string; riskNotesZh: string | null; installCommand: string | null;
  githubUrl: string | null; skillsShUrl: string | null; sourceLabel: string;
  sortWeight: number; iconEmoji?: string; addsCount?: string; sourceIcon?: string;
};

/** Parse `npx skills add owner/repo/skillId` → { owner, repo, skillId }. */
function parseUpstream(installCommand: string | null): SkillUpstreamRef | null {
  if (!installCommand) return null;
  const m = installCommand.trim().match(/([^\s/]+)\/([^\s/]+)\/([^\s]+)\s*$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], skillId: m[3] };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const seeds = JSON.parse(
    readFileSync(path.join(here, 'curated-skills.json'), 'utf-8'),
  ) as CuratedSkillSeed[];

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  let inserted = 0;
  let updated = 0;

  try {
    for (const s of seeds) {
      const row = {
        slug: s.slug,
        name: s.name,
        titleZh: s.titleZh,
        summaryZh: s.summaryZh,
        category: s.category as typeof skillCatalog.$inferInsert.category,
        level: s.level as typeof skillCatalog.$inferInsert.level,
        tags: s.recommendationTags ?? [],
        reusabilityStatus: s.reusabilityStatus as typeof skillCatalog.$inferInsert.reusabilityStatus,
        suitableForZh: s.suitableForZh,
        problemZh: s.problemZh,
        firstTaskZh: s.firstTaskZh,
        riskNotesZh: s.riskNotesZh,
        iconEmoji: s.iconEmoji ?? null,
        sortWeight: s.sortWeight ?? 0,
        addsCount: s.addsCount ?? null,
        source: 'curated' as const,
        upstream: parseUpstream(s.installCommand),
        installCommand: s.installCommand,
        githubUrl: s.githubUrl,
        skillsShUrl: s.skillsShUrl,
        sourceLabel: s.sourceLabel,
        sourceIcon: s.sourceIcon ?? null,
        scope: 'official' as const,
        ownerUserId: null,
      };

      const existing = await db
        .select({ id: skillCatalog.id })
        .from(skillCatalog)
        .where(and(eq(skillCatalog.slug, s.slug), eq(skillCatalog.scope, 'official')))
        .limit(1);

      if (existing.length > 0) {
        await db.update(skillCatalog)
          .set({ ...row, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(skillCatalog.id, existing[0].id));
        updated++;
      } else {
        await db.insert(skillCatalog).values(row);
        inserted++;
      }
    }

    console.log(`[seed] curated skills: ${inserted} inserted, ${updated} updated (total ${seeds.length})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
