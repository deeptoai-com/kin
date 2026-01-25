import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { auth } from '~/server/auth.server';
import { requireSystemAdmin } from '~/server/admin.server';
import type { A2ComposerStore, A2TemplateLocale } from '~/lib/a2composer/types';
import { A2_CATEGORIES, A2_TEMPLATES } from '~/lib/a2composer/config';
import { generateTemplateFromSchema, readExistingSchema } from '~/claude/skills';

const DEFAULT_STORE_VERSION = 1;

const getA2StoreDir = () => {
  if (process.env.A2COMPOSER_STORE_DIR) {
    return process.env.A2COMPOSER_STORE_DIR;
  }
  const skillsDir = process.env.SKILLS_STORE_DIR;
  if (skillsDir) {
    return path.join(skillsDir, '.a2composer');
  }
  return path.join(process.cwd(), 'data', 'a2composer');
};

const getStorePath = () => path.join(getA2StoreDir(), 'templates.json');

const categorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().optional(),
  hidden: z.boolean().optional(),
});

const localeSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  template: z.string().min(1),
});

const templateSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  template: z.string().min(1),
  skillId: z.string().min(1).optional(),
  skillHint: z.string().min(1).optional(),
  skillTags: z.array(z.string().min(1)).optional(),
  locales: z.record(z.string(), localeSchema).optional(),
  hidden: z.boolean().optional(),
});

const templateGenerateSchema = z.object({
  templateId: z.string().min(1),
  skillId: z.string().min(1).optional(),
});

const storeSchema = z.object({
  version: z.number().int().optional().default(DEFAULT_STORE_VERSION),
  categories: z.array(categorySchema),
  templates: z.array(templateSchema),
  updatedAt: z.string().optional(),
});

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }
  return session.user;
};

const readStoreFile = async (): Promise<A2ComposerStore | null> => {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf-8');
    return JSON.parse(raw) as A2ComposerStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const writeStoreFile = async (store: A2ComposerStore) => {
  const dir = getA2StoreDir();
  await fs.mkdir(dir, { recursive: true });
  const target = getStorePath();
  const tempPath = `${target}.tmp.${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2));
  await fs.rename(tempPath, target);
};

const mergeLocales = (
  existing: Record<string, A2TemplateLocale> | undefined,
  incoming: Record<string, A2TemplateLocale> | undefined,
): Record<string, A2TemplateLocale> | undefined => {
  if (!incoming || Object.keys(incoming).length === 0) {
    return existing;
  }
  const merged: Record<string, A2TemplateLocale> = {
    ...(existing ?? {}),
  };
  for (const [locale, localeData] of Object.entries(incoming)) {
    const previous = merged[locale] ?? {};
    merged[locale] = {
      ...previous,
      ...localeData,
    };
  }
  return merged;
};

const seedStore = (): A2ComposerStore => ({
  version: DEFAULT_STORE_VERSION,
  categories: A2_CATEGORIES,
  templates: A2_TEMPLATES,
  updatedAt: new Date().toISOString(),
});

const ensureStore = async (): Promise<A2ComposerStore> => {
  const existing = await readStoreFile();
  if (existing) {
    return storeSchema.parse(existing);
  }
  const seeded = seedStore();
  await writeStoreFile(seeded);
  return seeded;
};

export const getA2ComposerStoreFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    await requireUser();
    return ensureStore();
  });

export const updateA2ComposerStoreFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return storeSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireSystemAdmin();
    const store = {
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await writeStoreFile(store);
    return store;
  });

export const generateA2ComposerTemplateFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    if (!payload) {
      throw new Error('MISSING_INPUT');
    }
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return templateGenerateSchema.parse(data);
  })
  .handler(async ({ data }) => {
    await requireSystemAdmin();
    const store = await ensureStore();
    const template = store.templates.find((item) => item.id === data.templateId);
    const resolvedSkillId = data.skillId ?? template?.skillId;
    if (!resolvedSkillId) {
      throw new Error('SKILL_ID_REQUIRED');
    }
    const schema = await readExistingSchema(resolvedSkillId);
    if (!schema) {
      throw new Error('SCHEMA_MISSING');
    }

    const generated = await generateTemplateFromSchema(schema);
    if (!template) {
      return {
        template: {
          id: data.templateId,
          skillId: resolvedSkillId,
          template: generated.template,
          locales: generated.locales,
        },
        warnings: ['TEMPLATE_NOT_FOUND_IN_STORE', ...(generated.warnings ?? [])],
      };
    }

    const mergedLocales = mergeLocales(template.locales, generated.locales);
    const updatedTemplate = {
      ...template,
      skillId: resolvedSkillId,
      template: generated.template,
      locales: mergedLocales,
    };

    const nextStore: A2ComposerStore = {
      ...store,
      templates: store.templates.map((item) =>
        item.id === template.id ? updatedTemplate : item
      ),
      updatedAt: new Date().toISOString(),
    };

    await writeStoreFile(nextStore);
    return {
      template: updatedTemplate,
      warnings: generated.warnings ?? [],
    };
  });

export const validateA2ComposerStore = (data: unknown): A2ComposerStore => {
  return storeSchema.parse(data);
};

export const ensureA2ComposerStore = async (): Promise<A2ComposerStore> => {
  return ensureStore();
};

export const writeA2ComposerStore = async (store: A2ComposerStore) => {
  return writeStoreFile(store);
};
