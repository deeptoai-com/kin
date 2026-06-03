import { FC, useMemo, useState } from 'react';
import { Search, ExternalLink, Sparkles, Check, Plus, Loader2, Lock, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useIntlayer } from 'react-intlayer';
import { useServerFn } from '@tanstack/react-start';
import { toLocalizedString } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  installCuratedSkillFn,
  uninstallCuratedSkillFn,
  removeAddedSkillFn,
  type CuratedSkillItem,
} from '~/server/function/skills.server';
import { CuratedSkillDetailDialog } from './curated-skill-detail-dialog';
import { UpstreamSearchDialog } from './upstream-search-dialog';

/**
 * Curated Skills Section — the Skill Library (DB-backed catalog).
 *
 * S1: browse/search/category + detail (SKILL.md from skills-api).
 * S2: install/uninstall into "My Skills" (per-user, materialized to disk; takes
 *     effect next conversation). Default skills locked.
 * S3: "Add from upstream" (search skills-api → user-scoped catalog) + a
 *     "My added" section. See docs/project/prd/2026-06-skills-integration-prd.md.
 */

const CATEGORY_ORDER = [
  'ai_engineering', 'research', 'writing', 'design_frontend', 'automation', 'learning', 'security',
] as const;

// Mirror of catalog-materializer DEFAULT_SKILL_SLUGS (server enforces the lock).
const DEFAULT_SKILL_SLUGS = ['find-skills', 'skill-creator'];

export const CuratedSkillsSection: FC<{
  skills: CuratedSkillItem[];
  installedSlugs?: string[];
  addedSkills?: CuratedSkillItem[];
  onNewSkill?: () => void;
}> = ({ skills, installedSlugs = [], addedSkills = [], onNewSkill }) => {
  const content = useIntlayer('skills');
  const installFn = useServerFn(installCuratedSkillFn);
  const uninstallFn = useServerFn(uninstallCuratedSkillFn);
  const removeFn = useServerFn(removeAddedSkillFn);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [installed, setInstalled] = useState<Set<string>>(() => new Set(installedSlugs));
  const [pending, setPending] = useState<string | null>(null);
  const [showUpstream, setShowUpstream] = useState(false);

  const categoryLabel = (key: string | null): string => {
    if (!key) return key ?? '';
    const map = content.curated.categories as Record<string, unknown>;
    return key in map ? toLocalizedString(map[key]) : key;
  };

  const presentCategories = useMemo(() => {
    const set = new Set(skills.map((s) => s.category).filter(Boolean) as string[]);
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [skills]);

  const filtered = useMemo(() => {
    let list = skills;
    if (onlyInstalled) {
      list = list.filter((s) => installed.has(s.slug) || DEFAULT_SKILL_SLUGS.includes(s.slug));
    }
    if (activeCategory) list = list.filter((s) => s.category === activeCategory);
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
  }, [skills, activeCategory, searchQuery, onlyInstalled, installed]);

  const handleToggleInstall = async (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    if (DEFAULT_SKILL_SLUGS.includes(slug)) {
      toast.info(toLocalizedString(content.curated.defaultLockedToast));
      return;
    }
    const isInstalled = installed.has(slug);
    setPending(slug);
    try {
      if (isInstalled) {
        await uninstallFn({ data: { slug } });
        setInstalled((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
        toast.success(toLocalizedString(content.curated.uninstalledToast));
      } else {
        await installFn({ data: { slug } });
        setInstalled((prev) => new Set(prev).add(slug));
        toast.success(toLocalizedString(content.curated.installedToast));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.error(`${toLocalizedString(content.curated.installFailed)}${message ? `: ${message}` : ''}`);
    } finally {
      setPending(null);
    }
  };

  const handleRemoveAdded = async (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    if (!confirm(toLocalizedString(content.curated.removeConfirm))) return;
    setPending(slug);
    try {
      await removeFn({ data: { slug } });
      toast.success(toLocalizedString(content.curated.removedToast));
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'remove failed');
      setPending(null);
    }
  };

  const renderInstallControl = (slug: string) => {
    const isDefault = DEFAULT_SKILL_SLUGS.includes(slug);
    const isInstalled = isDefault || installed.has(slug);
    const isPending = pending === slug;
    if (isDefault) {
      return (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Lock className="h-3 w-3" />{content.curated.defaultLocked}
        </Badge>
      );
    }
    return (
      <Button
        size="sm"
        variant={isInstalled ? 'outline' : 'default'}
        className="h-7 gap-1 px-2 text-xs"
        disabled={isPending}
        onClick={(e) => handleToggleInstall(e, slug)}
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : isInstalled ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        {isPending ? content.curated.installing : isInstalled ? content.curated.installed : content.curated.install}
      </Button>
    );
  };

  const renderCard = (skill: CuratedSkillItem, opts?: { removable?: boolean }) => (
    <div
      key={skill.slug}
      role="button"
      tabIndex={0}
      onClick={() => setDetailSlug(skill.slug)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setDetailSlug(skill.slug);
        }
      }}
      className="flex cursor-pointer flex-col rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="text-2xl leading-none" aria-hidden>{skill.iconEmoji || '🧩'}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium" title={skill.titleZh || skill.name}>{skill.titleZh || skill.name}</h3>
          <p className="truncate text-xs text-muted-foreground" title={skill.name}>{skill.name}</p>
        </div>
        {skill.level && <Badge variant="outline" className="shrink-0 text-[10px]">{skill.level}</Badge>}
      </div>

      {skill.summaryZh && <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{skill.summaryZh}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {skill.category && <Badge variant="secondary" className="text-[10px]">{categoryLabel(skill.category)}</Badge>}
        {skill.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2">
        {renderInstallControl(skill.slug)}
        {opts?.removable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
            disabled={pending === skill.slug}
            onClick={(e) => handleRemoveAdded(e, skill.slug)}
          >
            <Trash2 className="h-3 w-3" />{content.curated.remove}
          </Button>
        )}
        {skill.githubUrl && (
          <a
            href={skill.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            title={toLocalizedString(content.curated.viewOnGithub)}
          >
            <ExternalLink className="h-3 w-3" />{skill.sourceLabel || 'GitHub'}
          </a>
        )}
      </div>
    </div>
  );

  return (
    <section className="mb-10">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">{content.curated.title}</h2>
        <span className="text-sm text-muted-foreground">
          {toLocalizedString(content.curated.count).replace('{count}', String(skills.length))}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {onNewSkill && (
            <Button variant="outline" size="sm" className="gap-1" onClick={onNewSkill}>
              <Plus className="h-3.5 w-3.5" />
              {content.curated.upstream.uploadButton}
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowUpstream(true)}>
            <Download className="h-3.5 w-3.5" />
            {content.curated.upstream.addButton}
          </Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{content.curated.subtitle}</p>

      {/* Toolbar */}
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
          <Button variant={activeCategory === null ? 'default' : 'outline'} size="sm" onClick={() => setActiveCategory(null)}>
            {content.curated.allCategories}
          </Button>
          {presentCategories.map((cat) => (
            <Button key={cat} variant={activeCategory === cat ? 'default' : 'outline'} size="sm" onClick={() => setActiveCategory(cat)}>
              {categoryLabel(cat)}
            </Button>
          ))}
        </div>
        <Button variant={onlyInstalled ? 'default' : 'outline'} size="sm" className="ml-auto gap-1" onClick={() => setOnlyInstalled((v) => !v)}>
          <Check className="h-3.5 w-3.5" />{content.curated.onlyInstalled}
        </Button>
      </div>

      {/* Official grid */}
      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">{content.curated.empty}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((skill) => renderCard(skill))}
        </div>
      )}

      {/* My added (upstream) */}
      {addedSkills.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            {content.curated.myAddedTitle} ({addedSkills.length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {addedSkills.map((skill) => renderCard(skill, { removable: true }))}
          </div>
        </div>
      )}

      <CuratedSkillDetailDialog slug={detailSlug} isOpen={detailSlug !== null} onClose={() => setDetailSlug(null)} />
      <UpstreamSearchDialog
        isOpen={showUpstream}
        onClose={() => setShowUpstream(false)}
        onAdded={() => window.location.reload()}
      />
    </section>
  );
};
