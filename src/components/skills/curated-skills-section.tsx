import { FC, useMemo, useState } from 'react';
import { Search, ExternalLink, Sparkles } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import type { CuratedSkillItem } from '~/server/function/skills.server';

/**
 * Curated Skills Section — read-only browse of the DB-backed curated catalog
 * (seeded from the platform's curated-100). Skills S1a: display only —
 * search + category filter + cards. Runtime enable/materialization (S2) and
 * SKILL.md detail from skills-api (S1b) are later phases, so there is
 * intentionally no enable toggle here yet.
 *
 * See docs/project/prd/2026-06-skills-integration-prd.md (§9 S1).
 */

const CATEGORY_ORDER = [
  'ai_engineering',
  'research',
  'writing',
  'design_frontend',
  'automation',
  'learning',
  'security',
] as const;

export const CuratedSkillsSection: FC<{ skills: CuratedSkillItem[] }> = ({ skills }) => {
  const content = useIntlayer('skills');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categoryLabel = (key: string | null): string => {
    if (!key) return key ?? '';
    const map = content.curated.categories as Record<string, unknown>;
    return key in map ? toLocalizedString(map[key]) : key;
  };

  // Categories actually present in the data, in canonical order
  const presentCategories = useMemo(() => {
    const set = new Set(skills.map((s) => s.category).filter(Boolean) as string[]);
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [skills]);

  const filtered = useMemo(() => {
    let list = skills;
    if (activeCategory) {
      list = list.filter((s) => s.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.titleZh ?? '').toLowerCase().includes(q) ||
          (s.summaryZh ?? '').toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [skills, activeCategory, searchQuery]);

  return (
    <section className="mb-10">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">{content.curated.title}</h2>
        <Badge variant="secondary">{content.curated.previewBadge}</Badge>
        <span className="text-sm text-muted-foreground">
          {toLocalizedString(content.curated.count).replace('{count}', String(skills.length))}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{content.curated.subtitle}</p>

      {/* Toolbar: search + category filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={toLocalizedString(content.curated.searchPlaceholder)}
            className="w-64 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={activeCategory === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveCategory(null)}
          >
            {content.curated.allCategories}
          </Button>
          {presentCategories.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory(cat)}
            >
              {categoryLabel(cat)}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">{content.curated.empty}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((skill) => (
            <div
              key={skill.slug}
              className="flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="mb-2 flex items-start gap-2">
                <span className="text-2xl leading-none" aria-hidden>
                  {skill.iconEmoji || '🧩'}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium" title={skill.titleZh || skill.name}>
                    {skill.titleZh || skill.name}
                  </h3>
                  <p className="truncate text-xs text-muted-foreground" title={skill.name}>
                    {skill.name}
                  </p>
                </div>
                {skill.level && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {skill.level}
                  </Badge>
                )}
              </div>

              {skill.summaryZh && (
                <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{skill.summaryZh}</p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                {skill.category && (
                  <Badge variant="secondary" className="text-[10px]">
                    {categoryLabel(skill.category)}
                  </Badge>
                )}
                {skill.tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
                {skill.githubUrl && (
                  <a
                    href={skill.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    title={toLocalizedString(content.curated.viewOnGithub)}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {skill.sourceLabel || 'GitHub'}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
