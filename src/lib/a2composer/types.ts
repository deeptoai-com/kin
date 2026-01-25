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
