export type A2Category = {
  id: string;
  label: string;
  description: string;
  icon?: string;
  hidden?: boolean;
};

export type A2TemplateLocale = {
  title?: string;
  summary?: string;
  template: string;
};

export type A2Template = {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
  template: string;
  skillId?: string;
  skillHint?: string;
  skillTags?: string[];
  locales?: Record<string, A2TemplateLocale>;
  hidden?: boolean;
};

export type A2ComposerStore = {
  version: number;
  categories: A2Category[];
  templates: A2Template[];
  updatedAt?: string;
};

/**
 * Composer view of a curated skill (derived from skill_catalog + per-user
 * enablement). This is the new single source for the composer shortcuts —
 * see docs/project/prd/2026-06-a2composer-prd.md.
 */
export type ComposerSkill = {
  slug: string;
  name: string;
  titleZh: string | null;
  summaryZh: string | null;
  category: string | null;
  level: string | null;
  suitableForZh: string | null;
  firstTaskZh: string | null;
  riskNotesZh: string | null;
  sortWeight: number;
  enabled: boolean;
};
