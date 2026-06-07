/**
 * Multi-model config parsing (PR2).
 *
 * The `.env` var OXY_MODELS_SEED holds a NON-SECRET JSON describing connections +
 * models (secrets are referenced by `tokenEnv` NAME only). This module parses +
 * validates that seed with Zod; it is the bootstrap source written into the DB on
 * first boot (see registry.seedModelsFromEnv). DB is the runtime source of truth.
 *
 * See docs/project/prd/2026-06-multi-model-switching-prd.md (rev.3) §4 +
 * docs/project/research/2026-06-multi-model-context-pack.md.
 */

import { z } from 'zod';

export const AUTH_STYLES = ['bearer', 'x-api-key'] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

const connectionSeedSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    baseUrl: z.string().url(),
    authStyle: z.enum(AUTH_STYLES).default('bearer'),
    // NAME of the env var holding the secret — never the secret itself.
    tokenEnv: z.string().min(1),
    anthropicVersion: z.string().default('2023-06-01'),
    customHeaders: z.record(z.string(), z.string()).optional(),
    // Per-connection alias / sub-agent models (gateway-only). Optional.
    aliasOpus: z.string().optional(),
    aliasSonnet: z.string().optional(),
    aliasHaiku: z.string().optional(),
    aliasSubagent: z.string().optional(),
  })
  .strict();

const modelSeedSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    connection: z.string().min(1),
    model: z.string().min(1),
    tags: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const modelSeedConfigSchema = z
  .object({
    default: z.string().optional(),
    connections: z.array(connectionSeedSchema).default([]),
    models: z.array(modelSeedSchema).default([]),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const connIds = new Set<string>();
    for (const c of cfg.connections) {
      if (connIds.has(c.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate connection id: ${c.id}`, path: ['connections'] });
      }
      connIds.add(c.id);
    }
    const modelIds = new Set<string>();
    for (const m of cfg.models) {
      if (modelIds.has(m.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate model id: ${m.id}`, path: ['models'] });
      }
      modelIds.add(m.id);
      if (!connIds.has(m.connection)) {
        ctx.addIssue({
          code: 'custom',
          message: `model "${m.id}" references unknown connection "${m.connection}"`,
          path: ['models'],
        });
      }
    }
    if (cfg.default && !modelIds.has(cfg.default)) {
      ctx.addIssue({ code: 'custom', message: `default "${cfg.default}" is not a known model id`, path: ['default'] });
    }
  });

export type ModelSeedConfig = z.infer<typeof modelSeedConfigSchema>;
export type ConnectionSeed = ModelSeedConfig['connections'][number];
export type ModelSeed = ModelSeedConfig['models'][number];

/**
 * Parse + validate OXY_MODELS_SEED. Returns null when unset/empty (no seed → the
 * single-value ANTHROPIC_* env stays as the only connection, see registry).
 * Throws on invalid JSON or schema so a misconfig fails loudly at boot.
 */
export function parseModelSeed(raw: string | undefined = process.env.OXY_MODELS_SEED): ModelSeedConfig | null {
  if (!raw || !raw.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`OXY_MODELS_SEED is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = modelSeedConfigSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`OXY_MODELS_SEED failed validation: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}
