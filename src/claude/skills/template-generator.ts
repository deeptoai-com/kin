import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { promises as fs } from 'node:fs';
import type { SkillSchema } from './schema-generator';

export type GeneratedTemplateLocale = {
  template: string;
  title?: string;
  summary?: string;
};

export type GeneratedTemplateResult = {
  template: string;
  locales?: Record<string, GeneratedTemplateLocale>;
  warnings?: string[];
};

const TEMPLATE_GENERATION_TIMEOUT_MS = 2 * 60 * 1000;
const TEMPLATE_DEBUG = process.env.SCHEMA_GENERATION_DEBUG === 'true';
const TEMPLATE_TRACE = process.env.SCHEMA_GENERATION_TRACE ?? 'off';
const TRACE_ENABLED = TEMPLATE_TRACE === 'true' || TEMPLATE_TRACE === 'full';
const TRACE_FULL = TEMPLATE_TRACE === 'full';

function debugLog(...args: unknown[]) {
  if (TEMPLATE_DEBUG) {
    console.log('[Template Generator][debug]', ...args);
  }
}

function stringifyTrace(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function traceLog(label: string, value: unknown) {
  if (!TRACE_ENABLED) return;
  const payload = stringifyTrace(value);
  if (TRACE_FULL) {
    console.log(`[Template Generator][trace] ${label}:`, payload);
    return;
  }
  const truncated = payload.length > 2000 ? `${payload.slice(0, 2000)}…(truncated)` : payload;
  console.log(`[Template Generator][trace] ${label}:`, truncated);
}

async function resolveClaudeCodeExecutable(): Promise<string | undefined> {
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return process.env.CLAUDE_CODE_EXECUTABLE;
  }

  const dockerPath = '/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js';
  try {
    await fs.access(dockerPath);
    return dockerPath;
  } catch {
    return undefined;
  }
}

function resolveTemplateModelLabel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'sdk-default';
}

const TemplateOutputZod = z.object({
  template: z.string().describe('Chinese template string'),
  locales: z.record(z.string(), z.object({
    template: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
  })).optional(),
}).passthrough();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const templateOutputJsonSchema = zodToJsonSchema(TemplateOutputZod as any, {
  name: 'TemplateOutput',
  $refStrategy: 'none',
}) as Record<string, unknown>;

const TEMPLATE_SYSTEM_PROMPT = `You generate template JSON only.

Rules:
1) Output ONLY a raw JSON object. No markdown, no explanations.
2) Fields allowed: "template", optional "locales".
3) "template" must be Chinese.
4) If "locales.en.template" is provided, it must use the exact same placeholders as "template".
5) You MUST use only the allowed placeholders provided by the user prompt.
6) You MUST include every allowed placeholder at least once.
7) Do NOT invent new placeholders.
8) Use each placeholder in a meaningful sentence; avoid outputting a bare list.`;

const TEMPLATE_VAR_REGEX = /{{\s*([^}]+?)\s*}}/g;

function extractTemplateVariables(template: string): string[] {
  const variables: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_VAR_REGEX.exec(template)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    if (raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('^') || raw.startsWith('else')) {
      continue;
    }
    if (/\s/.test(raw)) {
      continue;
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      variables.push(raw);
    }
  }
  return variables;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return trimmed;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTemplateString(
  raw: string,
  allowed: Set<string>,
  language: 'zh' | 'en',
): { template: string; unknown: string[]; missing: string[] } {
  let next = stripCodeFences(raw).trim();
  const vars = extractTemplateVariables(next);
  const unknown = vars.filter((variable) => !allowed.has(variable));

  for (const variable of unknown) {
    const pattern = new RegExp(`{{\\s*${escapeRegExp(variable)}\\s*}}`, 'g');
    next = next.replace(pattern, '');
  }

  const present = extractTemplateVariables(next);
  const missing = Array.from(allowed).filter((variable) => !present.includes(variable));

  if (missing.length > 0) {
    const suffix = language === 'zh'
      ? `\n\n补充信息：${missing.map((name) => `{{${name}}}`).join(' ')}`
      : `\n\nAdditional info: ${missing.map((name) => `{{${name}}}`).join(' ')}`;
    next = `${next.trim()}${suffix}`;
  }

  if (!next.trim()) {
    next = language === 'zh'
      ? `请提供以下信息：${Array.from(allowed).map((name) => `{{${name}}}`).join(' ')}`
      : `Please provide: ${Array.from(allowed).map((name) => `{{${name}}}`).join(' ')}`;
  }

  return { template: next.trim(), unknown, missing };
}

function buildTemplatePrompt(schema: SkillSchema, inputSummary: string): string {
  const placeholders = (schema.inputs ?? []).map((field) => field.name);
  return `Generate a concise, usable template for this skill.

Skill name: ${schema.name}
Skill description: ${schema.description}

Goal:
- Produce a natural, complete instruction that uses every placeholder at least once.
- Use input labels/descriptions to make each placeholder contextually clear.
- Avoid outputting a bare list of placeholders.

Allowed placeholders (MUST use all, no extras):
${placeholders.map((name) => `- {{${name}}}`).join('\n')}

Inputs (for context only):
${inputSummary}

Output JSON:
{
  "template": "...Chinese template using ONLY allowed placeholders...",
  "locales": {
    "en": { "template": "...English version using same placeholders..." }
  }
}`;
}

function summarizeInputs(schema: SkillSchema): string {
  if (!schema.inputs || schema.inputs.length === 0) return '- (none)';
  return schema.inputs.map((field) => {
    const options = Array.isArray(field.options) && field.options.length > 0
      ? ` options=${field.options.map((opt) => (typeof opt === 'string' ? opt : opt.value)).join(',')}`
      : '';
    return `- ${field.name} (${field.type}${field.required ? ', required' : ''})${field.label ? ` label="${field.label}"` : ''}${field.description ? ` desc="${field.description}"` : ''}${options}`;
  }).join('\n');
}

function unwrapStructuredOutput(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const wrapper = data as Record<string, unknown>;
  const candidates = ['payload', 'json_string', 'jsonString', 'output'];
  for (const key of candidates) {
    if (wrapper[key]) {
      return wrapper[key];
    }
  }
  return data;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = stripCodeFences(value);
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export async function generateTemplateFromSchema(
  schema: SkillSchema,
  timeoutMs: number = TEMPLATE_GENERATION_TIMEOUT_MS,
): Promise<GeneratedTemplateResult> {
  const inputs = schema.inputs ?? [];
  if (inputs.length === 0) {
    return {
      template: `请根据${schema.name}完成用户需求。`,
    };
  }

  const prompt = buildTemplatePrompt(schema, summarizeInputs(schema));
  console.log('[Template Generator] Starting independent SDK call...');
  console.log('[Template Generator] Prompt length:', prompt.length);
  console.log('[Template Generator] Timeout:', timeoutMs, 'ms');
  const resolvedModel = resolveTemplateModelLabel();
  console.log('[Template Generator] Model:', resolvedModel);
  traceLog('System Prompt', TEMPLATE_SYSTEM_PROMPT);
  traceLog('User Prompt', prompt);
  traceLog('Options.outputFormat.schema', templateOutputJsonSchema);

  const claudeCodeExecutable = await resolveClaudeCodeExecutable();
  if (claudeCodeExecutable) {
    console.log('[Template Generator] Using Claude Code executable:', claudeCodeExecutable);
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    console.log('[Template Generator] Creating query stream...');
    const stream = query({
      prompt,
      options: {
        model: resolvedModel,
        tools: [],
        systemPrompt: TEMPLATE_SYSTEM_PROMPT,
        outputFormat: {
          type: 'json_schema',
          schema: templateOutputJsonSchema,
        },
        pathToClaudeCodeExecutable: claudeCodeExecutable,
        abortController,
      },
    });

    console.log('[Template Generator] Query stream created, consuming events...');
    let resultData: unknown = null;
    let lastTextJson: unknown = null;
    let eventCount = 0;

    for await (const event of stream) {
      eventCount++;
      console.log(`[Template Generator] Event #${eventCount}: ${event.type}${(event as { subtype?: string }).subtype ? '.' + (event as { subtype?: string }).subtype : ''}`);

      if (event.type === 'result') {
        const resultEvent = event as SDKResultMessage;
        traceLog('Result event raw', resultEvent);
        if ('subtype' in resultEvent && resultEvent.subtype === 'success') {
          resultData = resultEvent.structured_output ?? resultEvent.result;
          traceLog('Structured output', resultEvent.structured_output ?? resultEvent.result);
        }
      }

      if (event.type === 'assistant') {
        const content = (event as unknown as { message?: { content?: Array<Record<string, unknown>> } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              const parsed = parseMaybeJson(block.text);
              if (parsed && typeof parsed === 'object' && 'template' in (parsed as Record<string, unknown>)) {
                lastTextJson = parsed;
              }
            }
          }
        }
      }
    }

    console.log(`[Template Generator] Finished processing ${eventCount} events`);

    if (!resultData && lastTextJson) {
      resultData = lastTextJson;
    }

    if (!resultData) {
      throw new Error('Template generation failed: no result received from SDK');
    }

    let normalized = unwrapStructuredOutput(resultData);
    normalized = parseMaybeJson(normalized);
    if (normalized && typeof normalized === 'object' && 'output' in (normalized as Record<string, unknown>)) {
      normalized = unwrapStructuredOutput(normalized);
      normalized = parseMaybeJson(normalized);
    }

    if (!normalized || typeof normalized !== 'object') {
      throw new Error('Template generation failed: invalid structured output');
    }

    const normalizedObj = normalized as Record<string, unknown>;
    if (typeof normalizedObj.locales === 'string') {
      const parsedLocales = parseMaybeJson(normalizedObj.locales);
      if (parsedLocales && typeof parsedLocales === 'object') {
        normalizedObj.locales = parsedLocales;
      } else {
        delete normalizedObj.locales;
      }
    }

    const parsed = TemplateOutputZod.parse(normalizedObj);
    const allowed = new Set(inputs.map((field) => field.name));

    const warnings: string[] = [];
    const zhResult = normalizeTemplateString(parsed.template, allowed, 'zh');
    if (zhResult.unknown.length > 0) {
      warnings.push(`Removed unknown placeholders: ${zhResult.unknown.join(', ')}`);
    }
    if (zhResult.missing.length > 0) {
      warnings.push(`Added missing placeholders: ${zhResult.missing.join(', ')}`);
    }

    let locales: Record<string, GeneratedTemplateLocale> | undefined;
    const rawLocales = parsed.locales ?? {};
    if (rawLocales && typeof rawLocales === 'object') {
      const en = rawLocales.en as { template?: string } | undefined;
      if (en?.template) {
        const enResult = normalizeTemplateString(en.template, allowed, 'en');
        if (enResult.unknown.length > 0) {
          warnings.push(`Removed unknown placeholders in en template: ${enResult.unknown.join(', ')}`);
        }
        if (enResult.missing.length > 0) {
          warnings.push(`Added missing placeholders in en template: ${enResult.missing.join(', ')}`);
        }
        locales = {
          en: {
            template: enResult.template,
          },
        };
      }
    }

    return {
      template: zhResult.template,
      locales,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Template generation timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
