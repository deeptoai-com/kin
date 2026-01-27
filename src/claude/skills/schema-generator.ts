/**
 * Skill Schema Generator
 *
 * Uses Claude Agent SDK to analyze SKILL.md and generate JSON Schema
 * for composer-form inputs.
 *
 * IMPORTANT: This is an INDEPENDENT call chain, completely isolated from
 * the WS chat session (ws-server.mjs / ws-query-worker.mjs).
 *
 * - No WebSocket dependencies
 * - No session state
 * - No MCP tools / file operations
 * - Pure text generation with Structured Outputs
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSkillsStoreDir, getUserClaudeHome, normalizeSkillName } from './manager';

// ============================================================================
// Version Information
// ============================================================================

/**
 * Schema generator version - increment when generation logic changes
 */
export const SCHEMA_GENERATOR_VERSION = '1.1.0';

// ============================================================================
// Schema Definition (inputs/fields focused)
// ============================================================================

/**
 * Individual input field definition
 */
const SkillInputOptionSchema = z.union([
  z.string(),
  z.object({
    value: z.string(),
    label: z.string().optional(),
  }),
]);

const SkillInputFieldSchema = z.object({
  name: z.string().describe('Field identifier (e.g., "topic", "style")'),
  label: z.string().optional().describe('Human-readable label for the field'),
  type: z.enum(['text', 'textarea', 'number', 'select', 'multiselect', 'boolean', 'file'])
    .describe('Input field type'),
  required: z.boolean().describe('Whether this field is required'),
  description: z.string().optional().describe('Help text or placeholder'),
  placeholder: z.string().optional().describe('Input placeholder text'),
  // P2 fix: Support array default value for multiselect
  defaultValue: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),  // For multiselect default values
  ]).optional().describe('Default value (array for multiselect)'),
  options: z.array(SkillInputOptionSchema)
    .optional()
    .describe('Options for select/multiselect types (string or {value,label})'),
  validation: z.object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
  }).optional().describe('Validation rules'),
});

const SkillExampleSchema = z.object({
  title: z.string().optional().describe('Short label for the example'),
  prompt: z.string().describe('A complete example prompt a user can send'),
});

/**
 * Complete Skill Schema for form generation
 */
const SkillSchemaZod = z.object({
  version: z.literal('1.0').describe('Schema version'),
  name: z.string().describe('Skill display name'),
  description: z.string().describe('Brief description of what this skill does'),
  inputs: z.array(SkillInputFieldSchema).optional().describe('Input fields for the skill form'),
  examples: z.array(SkillExampleSchema).optional().describe('Example prompts for this skill'),
  // Phase 2: New fields for A2Composer template auto-fill
  tags: z.array(z.string()).optional().describe('Category tags for the skill (e.g., ["development", "productivity"])'),
  hint: z.string().optional().describe('Usage hint or tip for the skill'),
  outputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
  })).optional().describe('Expected output types (optional, for documentation)'),
});

export type SkillSchema = z.infer<typeof SkillSchemaZod>;
export type SkillInputField = z.infer<typeof SkillInputFieldSchema>;

/**
 * Validate and normalize a skill schema payload.
 */
export function validateSkillSchema(data: unknown): SkillSchema {
  return SkillSchemaZod.parse(data);
}

// Convert to JSON Schema for SDK
// Use 'none' strategy to inline definitions instead of $ref
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const skillSchemaJsonSchema = zodToJsonSchema(SkillSchemaZod as any, {
  name: 'SkillSchema',
  $refStrategy: 'none',
}) as Record<string, unknown>;

// Looser schema for SDK Structured Outputs (avoid strict validation failures)
// P1 fix: Allow wrapper structures (skill_schema, schema, output) and make core fields optional
// The normalizeStructuredOutput function will handle all variants
const SkillSchemaOutputZod = z.object({
  // Core fields - all optional to allow wrapper structures
  version: z.string().optional().describe('Schema version, should be "1.0"'),
  name: z.string().optional().describe('Skill display name'),
  description: z.string().optional().describe('Brief description of the skill'),
  // Accept inputs as array or string (will be normalized)
  inputs: z.union([
    z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      required: z.boolean().optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      placeholder: z.string().optional(),
      defaultValue: z.unknown().optional(),
      options: z.array(z.unknown()).optional(),
      validation: z.object({}).passthrough().optional(),
    }).passthrough()),
    z.string(),  // Allow string (will be JSON.parsed in normalize)
  ]).optional().describe('Array of input field objects or JSON string'),
  // Examples can be array or JSON string (will be normalized)
  examples: z.union([z.array(z.unknown()), z.string()]).optional(),
  example_prompts: z.union([z.array(z.unknown()), z.string()]).optional(),
  // Phase 2: New fields for A2Composer template auto-fill
  tags: z.union([z.array(z.string()), z.string()]).optional().describe('Category tags'),
  hint: z.string().optional().describe('Usage hint'),
  skill_tags: z.union([z.array(z.string()), z.string()]).optional().describe('Variant: skill_tags'),
  skill_hint: z.string().optional().describe('Variant: skill_hint'),
  usage_hint: z.string().optional().describe('Variant: usage_hint'),
  // Variant field names (normalize to inputs)
  input_fields: z.union([z.array(z.unknown()), z.string()]).optional(),
  fields: z.union([z.array(z.unknown()), z.string()]).optional(),
  // Wrapper structures - model sometimes wraps the whole response
  skill_schema: z.unknown().optional().describe('Wrapper: nested schema object or string'),
  schema: z.unknown().optional().describe('Wrapper: nested schema object or string'),
  output: z.unknown().optional().describe('Wrapper: nested output object or string'),
  // Variant name fields
  skill_name: z.string().optional(),
  skill_description: z.string().optional(),
  // JSON Schema format (will be converted to inputs)
  input_schema: z.object({}).passthrough().optional(),
  // Accept output definitions
  outputs: z.array(z.unknown()).optional(),
}).passthrough();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const skillSchemaOutputJsonSchema = zodToJsonSchema(SkillSchemaOutputZod as any, {
  name: 'SkillSchemaOutput',
  $refStrategy: 'none',
}) as Record<string, unknown>;

// Draft schema for partial/fallback saves (looser than final schema)
const SkillSchemaDraftZod = z.object({
  version: z.string().default('1.0'),
  name: z.string(),
  description: z.string(),
  inputs: z.array(SkillInputFieldSchema).optional(),
  examples: z.array(SkillExampleSchema).optional(),
  // Phase 2: New fields
  tags: z.array(z.string()).optional(),
  hint: z.string().optional(),
  outputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
  })).optional(),
}).passthrough();

type SkillSchemaDraft = z.infer<typeof SkillSchemaDraftZod>;

// ============================================================================
// Schema Generator
// ============================================================================

// Timeout for schema generation (2 minutes)
const SCHEMA_GENERATION_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_SCHEMA_INPUTS = 6;
const MAX_SCHEMA_EXAMPLES = 3;
const SCHEMA_GENERATION_DEBUG = process.env.SCHEMA_GENERATION_DEBUG === 'true';
const SCHEMA_GENERATION_TRACE = process.env.SCHEMA_GENERATION_TRACE ?? 'off';
const TRACE_ENABLED = SCHEMA_GENERATION_TRACE === 'true' || SCHEMA_GENERATION_TRACE === 'full';
const TRACE_FULL = SCHEMA_GENERATION_TRACE === 'full';

function debugLog(...args: unknown[]) {
  if (SCHEMA_GENERATION_DEBUG) {
    console.log('[Schema Generator][debug]', ...args);
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
    console.log(`[Schema Generator][trace] ${label}:`, payload);
    return;
  }
  const truncated = payload.length > 2000 ? `${payload.slice(0, 2000)}…(truncated)` : payload;
  console.log(`[Schema Generator][trace] ${label}:`, truncated);
}

/**
 * Resolve Claude Code executable path for SDK (Docker-friendly).
 */
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

function resolveSchemaModelLabel(): string {
  // Use dedicated env var for generators, fallback to Claude Sonnet
  // Do NOT use ANTHROPIC_MODEL as it may be set to non-Claude models (e.g., GLM)
  return process.env.SCHEMA_GENERATOR_MODEL ?? 'claude-sonnet-4-20250514';
}

// ============================================================================
// System Prompt for Format Enforcement
// ============================================================================

/**
 * System prompt to strictly enforce output format
 *
 * This prompt is critical for Structured Output stability:
 * - Mandates JSON object output only (no markdown, no explanation)
 * - Prohibits JSON-as-string (e.g., inputs: "[...]")
 * - Enforces fixed field names (version, name, description, inputs)
 * - Provides minimal example for format reference
 */
const SCHEMA_GENERATION_SYSTEM_PROMPT = `You are a JSON schema generator. Your ONLY job is to output valid JSON objects.

## OUTPUT FORMAT REQUIREMENTS (CRITICAL)

1. Output ONLY a raw JSON object. No markdown code fences, no explanations, no text.
2. NEVER return fields as JSON strings. For example:
   - WRONG: "inputs": "[{...}]"  (string containing JSON)
   - CORRECT: "inputs": [{...}]  (actual array)

3. Use EXACTLY these field names:
   - "version": must be exactly "1.0" (string)
   - "name": skill display name (string, use Chinese if possible)
   - "description": brief description (string, use Chinese if possible)
   - "inputs": array of input field objects (MUST be an array, even if empty)
   - "examples": array of example prompts (optional)
   - "tags": array of category tags (optional, 1-3 tags)
   - "hint": usage hint or tip (optional, one sentence)

4. Input field rules:
   - MAX 6 input fields. It is OK to output 0 fields.
   - If there are no clear user inputs, return "inputs": [].

5. Each input field object must have:
   - "name": field identifier (string, required)
   - "type": one of "text", "textarea", "number", "select", "multiselect", "boolean", "file"
   - "required": boolean
   - Optional: "label", "description", "placeholder", "defaultValue", "options", "validation"

6. Examples rules:
   - Provide 1-3 concrete example prompts.
   - Do NOT use placeholders like {topic} or <topic>.
   - Each prompt must be usable as-is.

7. Tags rules:
   - Provide 1-3 category tags that describe this skill.
   - Use lowercase English words (e.g., "development", "productivity", "design", "writing", "analysis").
   - Common tags: "development", "productivity", "design", "writing", "analysis", "research", "automation", "code-review", "documentation", "testing".

8. Hint rules:
   - Provide a short usage hint (one sentence, in Chinese).
   - Describe the best use case or a tip for using this skill effectively.

## MINIMAL EXAMPLE

{
  "version": "1.0",
  "name": "示例技能",
  "description": "根据用户输入生成内容",
  "inputs": [
    {
      "name": "topic",
      "type": "text",
      "required": true,
      "description": "主题"
    }
  ],
  "examples": [
    {
      "title": "基础示例",
      "prompt": "请根据 Claude 上手指南，写一段 100 字的中文简介。"
    }
  ],
  "tags": ["writing", "productivity"],
  "hint": "适合需要快速生成内容概要的场景。"
}

## VALIDATION

Before outputting, verify:
- version is "1.0" (not 1.0 as number, not "1" or "v1.0")
- inputs is an array (not a string, not null)
- inputs.length <= 6
- examples.length <= 3
- tags is an array of strings, length <= 5
- All field names are exactly as specified above`;

/**
 * Build the user prompt for schema generation
 */
function buildSchemaPrompt(skillMdContent: string): string {
  return `Analyze the SKILL.md content below and generate a minimal form schema (inputs).

## Guidelines
- Maximum 6 input fields. It is OK to output 0 fields.
- If there are no clear user inputs, output inputs: [].
- Prefer consolidating optional details into one field (e.g., "additional_context").
- Only use select/multiselect when the SKILL.md explicitly lists choices.
- Provide 1-3 concrete example prompts in examples (no placeholders; usable as-is).
- Provide 1-3 category tags that describe this skill (lowercase English).
- Provide a short usage hint (one sentence, in Chinese).

## SKILL.md Content

${skillMdContent}

Generate the JSON object now. Output ONLY the JSON object.`;
}

function extractSkillMetadataFromMarkdown(skillMdContent: string): { name: string; description: string } {
  const lines = skillMdContent.split('\n').map((line) => line.trim());
  const heading = lines.find((line) => line.startsWith('# '));
  const name = heading ? heading.replace(/^#\s+/, '').trim() : 'Unknown Skill';

  let description = '';
  if (heading) {
    const headingIndex = lines.indexOf(heading);
    // Skip empty lines and HTML comments when looking for description
    const nextLine = lines.slice(headingIndex + 1).find((line) =>
      line.length > 0 &&
      !line.startsWith('#') &&
      !line.startsWith('<!--') &&
      !line.startsWith('```') &&
      !line.startsWith('---')
    );
    if (nextLine) {
      description = nextLine;
    }
  } else {
    // Skip HTML comments and code blocks
    const firstLine = lines.find((line) =>
      line.length > 0 &&
      !line.startsWith('<!--') &&
      !line.startsWith('```') &&
      !line.startsWith('---')
    );
    if (firstLine) {
      description = firstLine;
    }
  }

  return { name, description };
}

/**
 * Result of normalizeStructuredOutput with parse status
 */
interface NormalizeResult {
  data: unknown;
  parseFailed: boolean;  // True if any JSON.parse failed during normalization
  parseErrors: string[]; // Details of parse failures
}

function normalizeStructuredOutput(raw: unknown, skillMdContent: string): NormalizeResult {
  let data = raw;
  let parseFailed = false;
  const parseErrors: string[] = [];

  debugLog('normalizeStructuredOutput: input type', typeof data);

  // Step 1: Parse string to object if needed
  if (typeof data === 'string') {
    debugLog('normalizeStructuredOutput: parsing string input');
    try {
      data = JSON.parse(data);
      debugLog('normalizeStructuredOutput: parsed string to', typeof data);
    } catch (e) {
      debugLog('normalizeStructuredOutput: failed to parse string', e);
      parseFailed = true;
      parseErrors.push(`Top-level string parse failed: ${e instanceof Error ? e.message : String(e)}`);
      return { data, parseFailed, parseErrors };
    }
  }

  // Step 2: Unwrap nested schema variants (skill_schema, schema, output)
  // P1 fix: Also handle string-wrapped values (e.g., output: "{...}")
  if (data && typeof data === 'object') {
    const wrapper = data as Record<string, unknown>;

    // Helper to unwrap a value that might be string JSON
    // Records parse failures to parseFailed/parseErrors
    const unwrapValue = (value: unknown, fieldName: string): unknown => {
      if (typeof value === 'string') {
        try {
          debugLog('normalizeStructuredOutput: parsing string wrapper value for', fieldName);
          return JSON.parse(value);
        } catch (e) {
          debugLog('normalizeStructuredOutput: failed to parse string wrapper for', fieldName);
          parseFailed = true;
          parseErrors.push(`Wrapper ${fieldName} string parse failed: ${e instanceof Error ? e.message : String(e)}`);
          return value;
        }
      }
      return value;
    };

    // Check for payload wrapper (object or string)
    if ('payload' in wrapper && wrapper.payload) {
      debugLog('normalizeStructuredOutput: unwrapping payload');
      data = unwrapValue(wrapper.payload, 'payload');
    }
    // Check for json_string wrapper (object or string)
    else if ('json_string' in wrapper && wrapper.json_string) {
      debugLog('normalizeStructuredOutput: unwrapping json_string');
      data = unwrapValue(wrapper.json_string, 'json_string');
    }
    else if ('jsonString' in wrapper && wrapper.jsonString) {
      debugLog('normalizeStructuredOutput: unwrapping jsonString');
      data = unwrapValue(wrapper.jsonString, 'jsonString');
    }
    // Check for skill_schema wrapper (object or string)
    else if ('skill_schema' in wrapper && wrapper.skill_schema) {
      debugLog('normalizeStructuredOutput: unwrapping skill_schema');
      data = unwrapValue(wrapper.skill_schema, 'skill_schema');
    }
    // Check for schema wrapper (object or string)
    else if ('schema' in wrapper && wrapper.schema) {
      debugLog('normalizeStructuredOutput: unwrapping schema');
      data = unwrapValue(wrapper.schema, 'schema');
    }
    // Check for output wrapper (sometimes model wraps in output.skill_schema or output: "{...}")
    else if ('output' in wrapper && wrapper.output) {
      debugLog('normalizeStructuredOutput: unwrapping output');
      const output = unwrapValue(wrapper.output, 'output');
      if (output && typeof output === 'object') {
        const outputObj = output as Record<string, unknown>;
        if ('payload' in outputObj && outputObj.payload) {
          data = unwrapValue(outputObj.payload, 'output.payload');
        } else if ('skill_schema' in outputObj && outputObj.skill_schema) {
          data = unwrapValue(outputObj.skill_schema, 'output.skill_schema');
        } else {
          data = output;
        }
      } else {
        data = output;
      }
    }
  }

  // Step 3: Parse again if wrapped value was string
  if (typeof data === 'string') {
    debugLog('normalizeStructuredOutput: parsing unwrapped string');
    try {
      data = JSON.parse(data);
    } catch (e) {
      parseFailed = true;
      parseErrors.push(`Unwrapped string parse failed: ${e instanceof Error ? e.message : String(e)}`);
      return { data, parseFailed, parseErrors };
    }
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // Step 4: Fix version if missing or incorrect
    if (!obj.version || obj.version !== '1.0') {
      debugLog('normalizeStructuredOutput: fixing version from', obj.version, 'to 1.0');
      obj.version = '1.0';
    }

    // Step 5: Handle variant field names for name/description FIRST
    // (Check SDK output variants before falling back to markdown extraction)
    if ((!obj.name || typeof obj.name !== 'string') && typeof obj.skill_name === 'string') {
      debugLog('normalizeStructuredOutput: using skill_name as name');
      obj.name = obj.skill_name;
    }
    if ((!obj.description || typeof obj.description !== 'string') && typeof obj.skill_description === 'string') {
      debugLog('normalizeStructuredOutput: using skill_description as description');
      obj.description = obj.skill_description;
    }

    // Step 6: Fall back to markdown extraction if still missing
    if (!obj.name || typeof obj.name !== 'string' || !obj.description || typeof obj.description !== 'string') {
      const fallback = extractSkillMetadataFromMarkdown(skillMdContent);
      if (!obj.name || typeof obj.name !== 'string') {
        debugLog('normalizeStructuredOutput: using fallback name from markdown');
        obj.name = fallback.name;
      }
      if (!obj.description || typeof obj.description !== 'string') {
        debugLog('normalizeStructuredOutput: using fallback description from markdown');
        obj.description = fallback.description;
      }
    }

    // Step 7: Parse nested skill object if present
    if ((obj.name === undefined || obj.description === undefined) && typeof obj.skill === 'string') {
      debugLog('normalizeStructuredOutput: parsing nested skill string');
      try {
        const parsedSkill = JSON.parse(obj.skill);
        if (parsedSkill && typeof parsedSkill === 'object') {
          if (!obj.name && typeof (parsedSkill as Record<string, unknown>).name === 'string') {
            obj.name = (parsedSkill as Record<string, unknown>).name;
          }
          if (!obj.description && typeof (parsedSkill as Record<string, unknown>).description === 'string') {
            obj.description = (parsedSkill as Record<string, unknown>).description;
          }
        }
      } catch {
        // ignore parse failures
      }
    }

    // Step 7.5: Parse input_schema if it's a JSON string
    // Some models wrap the full schema payload inside input_schema as a string.
    if (typeof obj.input_schema === 'string') {
      debugLog('normalizeStructuredOutput: parsing input_schema string');
      try {
        const parsed = JSON.parse(obj.input_schema);
        if (parsed && typeof parsed === 'object') {
          obj.input_schema = parsed;

          // If parsed looks like a full schema (has inputs/name/description/version), merge into obj.
          const parsedObj = parsed as Record<string, unknown>;
          const looksLikeFullSchema =
            'inputs' in parsedObj
            || 'name' in parsedObj
            || 'description' in parsedObj
            || 'version' in parsedObj;

          if (looksLikeFullSchema) {
            for (const key of [
              'version',
              'name',
              'description',
              'inputs',
            ]) {
              if (obj[key] === undefined && parsedObj[key] !== undefined) {
                obj[key] = parsedObj[key];
              }
            }
          }
        }
      } catch (e) {
        debugLog('normalizeStructuredOutput: failed to parse input_schema string, marking parseFailed');
        parseFailed = true;
        parseErrors.push(`input_schema parse failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Step 8: Normalize inputs from various field names
    // Priority: inputs > input_fields > fields
    if (!obj.inputs && Array.isArray(obj.input_fields)) {
      debugLog('normalizeStructuredOutput: using input_fields as inputs (array)');
      obj.inputs = obj.input_fields;
    }

    if (!obj.inputs && typeof obj.input_fields === 'string') {
      debugLog('normalizeStructuredOutput: parsing input_fields string');
      try {
        const parsed = JSON.parse(obj.input_fields);
        if (Array.isArray(parsed)) {
          obj.inputs = parsed;
        } else {
          debugLog('normalizeStructuredOutput: parsed input_fields is not array, marking parseFailed');
          parseFailed = true;
          parseErrors.push('input_fields parsed but not an array');
          // Don't set to [] yet - let input_schema fallback try first
        }
      } catch (e) {
        debugLog('normalizeStructuredOutput: failed to parse input_fields string, marking parseFailed');
        parseFailed = true;
        parseErrors.push(`input_fields parse failed: ${e instanceof Error ? e.message : String(e)}`);
        // Don't set to [] yet - let input_schema fallback try first
      }
    }

    // Parse inputs if it's a string (common LLM mistake)
    // P1 fix: Record parseFailed but don't force to [] yet - let input_schema fallback try first
    if (typeof obj.inputs === 'string') {
      debugLog('normalizeStructuredOutput: parsing inputs string (LLM returned JSON string)');
      try {
        const parsed = JSON.parse(obj.inputs);
        if (Array.isArray(parsed)) {
          obj.inputs = parsed;
          debugLog('normalizeStructuredOutput: successfully parsed inputs string to array');
        } else {
          debugLog('normalizeStructuredOutput: parsed inputs is not array, marking parseFailed');
          parseFailed = true;
          parseErrors.push('inputs parsed but not an array');
          obj.inputs = undefined; // Clear so input_schema can try
        }
      } catch (e) {
        debugLog('normalizeStructuredOutput: failed to parse inputs string, marking parseFailed');
        parseFailed = true;
        parseErrors.push(`inputs parse failed: ${e instanceof Error ? e.message : String(e)}`);
        obj.inputs = undefined; // Clear so input_schema can try
      }
    }

    if (!obj.inputs && Array.isArray(obj.fields)) {
      debugLog('normalizeStructuredOutput: using fields as inputs');
      obj.inputs = obj.fields;
    }

    // Step 9: Normalize defaultValue from default
    if (Array.isArray(obj.inputs)) {
      obj.inputs = obj.inputs.map((input: Record<string, unknown>) => {
        if (input.default !== undefined && input.defaultValue === undefined) {
          input.defaultValue = input.default;
        }
        return input;
      });
    }

    // Step 10: Convert JSON Schema (input_schema) to inputs array
    // P1 fix: Also try when inputs is empty array (from parse failure)
    const inputsEmpty = !obj.inputs || (Array.isArray(obj.inputs) && obj.inputs.length === 0);
    if (inputsEmpty && obj.input_schema && typeof obj.input_schema === 'object') {
      debugLog('normalizeStructuredOutput: converting input_schema (JSON Schema) to inputs');
      const inputSchema = obj.input_schema as Record<string, unknown>;
      const properties = inputSchema.properties;
      const required = Array.isArray(inputSchema.required)
        ? new Set(inputSchema.required.filter((item) => typeof item === 'string'))
        : new Set<string>();

      if (properties && typeof properties === 'object') {
        const mappedInputs = Object.entries(properties).map(([key, value]) => {
          if (!value || typeof value !== 'object') return null;
          const field = value as Record<string, unknown>;
          const enumValues = Array.isArray(field.enum)
            ? field.enum.filter((item) => typeof item === 'string')
            : [];

          let type = 'text';
          if (field.type === 'array') {
            type = 'multiselect';
          } else if (field.type === 'number' || field.type === 'integer') {
            type = 'number';
          } else if (field.type === 'boolean') {
            type = 'boolean';
          } else if (enumValues.length > 0) {
            type = 'select';
          } else if (field.type === 'string') {
            // Check for format hints
            if (field.format === 'textarea' || (field.maxLength && (field.maxLength as number) > 200)) {
              type = 'textarea';
            } else {
              type = 'text';
            }
          }

          return {
            name: key,
            label: typeof field.title === 'string' ? field.title : undefined,
            description: typeof field.description === 'string' ? field.description : undefined,
            required: required.has(key),
            type,
            options: enumValues.length > 0 ? enumValues : undefined,
            defaultValue: field.default,
          };
        }).filter(Boolean);

        if (mappedInputs.length > 0) {
          debugLog('normalizeStructuredOutput: converted', mappedInputs.length, 'fields from input_schema');
          obj.inputs = mappedInputs;
        }
      }
    }

    // Step 11: Ensure inputs is at least an empty array if undefined
    if (obj.inputs === undefined) {
      debugLog('normalizeStructuredOutput: setting inputs to empty array');
      obj.inputs = [];
    }

    // Step 12: Normalize examples
    if (obj.examples === undefined && obj.example_prompts !== undefined) {
      obj.examples = obj.example_prompts;
    }

    if (typeof obj.examples === 'string') {
      debugLog('normalizeStructuredOutput: parsing examples string');
      try {
        obj.examples = JSON.parse(obj.examples);
      } catch (e) {
        debugLog('normalizeStructuredOutput: failed to parse examples string', e);
        parseFailed = true;
        parseErrors.push(`examples parse failed: ${e instanceof Error ? e.message : String(e)}`);
        obj.examples = [];
      }
    }

    if (Array.isArray(obj.examples)) {
      const normalizedExamples = obj.examples
        .map((item) => coerceExample(item))
        .filter(Boolean)
        .slice(0, MAX_SCHEMA_EXAMPLES);
      obj.examples = normalizedExamples;
    } else if (obj.examples && typeof obj.examples === 'object') {
      const single = coerceExample(obj.examples);
      obj.examples = single ? [single] : [];
    }

    // Step 13: Normalize tags (Phase 2)
    // Accept: tags, skill_tags as array or comma-separated string
    if (obj.tags === undefined && obj.skill_tags !== undefined) {
      obj.tags = obj.skill_tags;
    }
    if (typeof obj.tags === 'string') {
      // Parse comma-separated string or JSON array
      const tagsStr = obj.tags.trim();
      if (tagsStr.startsWith('[')) {
        try {
          obj.tags = JSON.parse(tagsStr);
        } catch {
          obj.tags = tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
      } else {
        obj.tags = tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
      }
    }
    if (Array.isArray(obj.tags)) {
      obj.tags = (obj.tags as unknown[]).filter((t: unknown) => typeof t === 'string' && t.trim()).slice(0, 5);
      if ((obj.tags as unknown[]).length === 0) {
        delete obj.tags;
      }
    }

    // Step 14: Normalize hint (Phase 2)
    // Accept: hint, skill_hint, usage_hint
    if (obj.hint === undefined) {
      if (typeof obj.skill_hint === 'string') {
        obj.hint = obj.skill_hint;
      } else if (typeof obj.usage_hint === 'string') {
        obj.hint = obj.usage_hint;
      }
    }
    if (typeof obj.hint === 'string') {
      obj.hint = obj.hint.trim();
      if (!obj.hint) {
        delete obj.hint;
      }
    }

    debugLog('normalizeStructuredOutput: final inputs count', Array.isArray(obj.inputs) ? obj.inputs.length : 'not-array');
    debugLog('normalizeStructuredOutput: tags', obj.tags, 'hint', obj.hint);
    debugLog('normalizeStructuredOutput: parseFailed', parseFailed, 'parseErrors', parseErrors);
  }

  return { data, parseFailed, parseErrors };
}

const ALLOWED_INPUT_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'file',
]);

function coerceInputField(raw: Record<string, unknown>): Record<string, unknown> | null {
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!name) return null;

  const type = typeof raw.type === 'string' && ALLOWED_INPUT_TYPES.has(raw.type)
    ? raw.type
    : 'text';

  const required = typeof raw.required === 'boolean' ? raw.required : false;

  const output: Record<string, unknown> = {
    name,
    type,
    required,
  };

  if (typeof raw.label === 'string') output.label = raw.label;
  if (typeof raw.description === 'string') output.description = raw.description;
  if (typeof raw.placeholder === 'string') output.placeholder = raw.placeholder;

  if (
    typeof raw.defaultValue === 'string'
    || typeof raw.defaultValue === 'number'
    || typeof raw.defaultValue === 'boolean'
    || (Array.isArray(raw.defaultValue) && raw.defaultValue.every((item) => typeof item === 'string'))
  ) {
    output.defaultValue = raw.defaultValue;
  }

  if (Array.isArray(raw.options)) {
    const options = raw.options
      .map((option) => {
        if (typeof option === 'string') return option;
        if (option && typeof option === 'object' && typeof (option as { value?: unknown }).value === 'string') {
          const label = (option as { label?: unknown }).label;
          return {
            value: (option as { value: string }).value,
            ...(typeof label === 'string' ? { label } : {}),
          };
        }
        return null;
      })
      .filter(Boolean);

    if (options.length > 0) {
      output.options = options;
    }
  }

  if (raw.validation && typeof raw.validation === 'object') {
    const validation = raw.validation as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const key of ['minLength', 'maxLength', 'min', 'max', 'pattern']) {
      const value = validation[key];
      if (typeof value === 'number' || typeof value === 'string') {
        sanitized[key] = value;
      }
    }
    if (Object.keys(sanitized).length > 0) {
      output.validation = sanitized;
    }
  }

  return output;
}

function coerceExample(raw: unknown): { title?: string; prompt: string } | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? { prompt: trimmed } : null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title : undefined;
  const prompt =
    (typeof obj.prompt === 'string' && obj.prompt) ||
    (typeof obj.text === 'string' && obj.text) ||
    (typeof obj.example === 'string' && obj.example) ||
    (typeof obj.template === 'string' && obj.template) ||
    (typeof obj.content === 'string' && obj.content) ||
    '';

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return null;

  return {
    ...(title ? { title } : {}),
    prompt: trimmedPrompt,
  };
}

function truncateInputsIfNeeded(obj: Record<string, unknown>): string | null {
  if (Array.isArray(obj.inputs) && obj.inputs.length > MAX_SCHEMA_INPUTS) {
    obj.inputs = obj.inputs.slice(0, MAX_SCHEMA_INPUTS);
    return `Inputs truncated to ${MAX_SCHEMA_INPUTS}`;
  }
  return null;
}

function buildDraftSchema(normalizedData: unknown, skillMdContent: string): SkillSchemaDraft {
  const fallback = extractSkillMetadataFromMarkdown(skillMdContent);
  const obj = normalizedData && typeof normalizedData === 'object'
    ? (normalizedData as Record<string, unknown>)
    : {};

  const name = typeof obj.name === 'string' ? obj.name : fallback.name;
  const description = typeof obj.description === 'string' ? obj.description : fallback.description;

  let inputsRaw: unknown = obj.inputs;
  if (inputsRaw === undefined && typeof obj.input_fields === 'string') {
    inputsRaw = obj.input_fields;
  }

  if (typeof inputsRaw === 'string') {
    try {
      inputsRaw = JSON.parse(inputsRaw);
    } catch {
      inputsRaw = undefined;
    }
  }

  let inputs: Array<Record<string, unknown>> | undefined;
  if (Array.isArray(inputsRaw)) {
    const coerced = inputsRaw
      .filter((item) => item && typeof item === 'object')
      .map((item) => coerceInputField(item as Record<string, unknown>))
      .filter(Boolean) as Array<Record<string, unknown>>;
    if (coerced.length > 0) {
      inputs = coerced;
    }
  }

  let examples: Array<{ title?: string; prompt: string }> | undefined;
  let examplesRaw: unknown = obj.examples ?? obj.example_prompts;
  if (typeof examplesRaw === 'string') {
    try {
      examplesRaw = JSON.parse(examplesRaw);
    } catch {
      examplesRaw = undefined;
    }
  }
  if (Array.isArray(examplesRaw)) {
    const coerced = examplesRaw
      .map((item) => coerceExample(item))
      .filter(Boolean) as Array<{ title?: string; prompt: string }>;
    if (coerced.length > 0) {
      examples = coerced.slice(0, MAX_SCHEMA_EXAMPLES);
    }
  } else if (examplesRaw && typeof examplesRaw === 'object') {
    const single = coerceExample(examplesRaw);
    if (single) {
      examples = [single];
    }
  }

  return SkillSchemaDraftZod.parse({
    version: '1.0',
    name,
    description,
    inputs,
    examples,
  });
}

/**
 * Generate schema for a skill using Claude Agent SDK
 *
 * This function uses a completely INDEPENDENT call chain:
 * - Direct SDK query() call (not through WS worker)
 * - No MCP tools enabled
 * - No file operations
 * - Pure text generation with Structured Outputs
 *
 * @param skillMdContent - The SKILL.md content to analyze
 * @param timeoutMs - Optional timeout in milliseconds (default: 2 minutes)
 */
export interface GenerateSchemaFromContentResult {
  schema: SkillSchema;
  needsReview: boolean;
  errorMessage?: string;
}

export async function generateSchemaFromContent(
  skillMdContent: string,
  timeoutMs: number = SCHEMA_GENERATION_TIMEOUT_MS,
): Promise<GenerateSchemaFromContentResult> {
  const prompt = buildSchemaPrompt(skillMdContent);

  console.log('[Schema Generator] Starting independent SDK call...');
  console.log('[Schema Generator] Prompt length:', prompt.length);
  console.log('[Schema Generator] Timeout:', timeoutMs, 'ms');
  const resolvedModel = process.env.ANTHROPIC_MODEL;
  console.log('[Schema Generator] Model:', resolvedModel ?? 'sdk-default');
  traceLog('Prompt', prompt);

  const claudeCodeExecutable = await resolveClaudeCodeExecutable();
  if (claudeCodeExecutable) {
    console.log('[Schema Generator] Using Claude Code executable:', claudeCodeExecutable);
  } else {
    console.warn('[Schema Generator] Claude Code executable not resolved; using SDK default');
  }

  // P3 fix: Enhanced trace logging for debugging
  traceLog('System Prompt', SCHEMA_GENERATION_SYSTEM_PROMPT);
  traceLog('User Prompt', prompt);
  traceLog('Options.tools', []);
  traceLog('Options.outputFormat.schema', skillSchemaOutputJsonSchema);

  // P2 fix: Create AbortController for timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    // Create the query stream - INDEPENDENT from WS session
    // Use empty array [] to disable ALL built-in tools (pure text generation)
    const stream = query({
      prompt,
      options: {
        // No cwd needed - pure text generation
        model: resolvedModel,
        // Disable ALL tools by passing empty array
        // SDK type: tools?: string[] | { type: 'preset'; preset: 'claude_code' }
        tools: [],
        // No MCP servers
        // No permission mode concerns (no file access)
        // P3 fix: Add system prompt for format enforcement
        systemPrompt: SCHEMA_GENERATION_SYSTEM_PROMPT,
        // Use Structured Outputs for reliable JSON format
        outputFormat: {
          type: 'json_schema',
          schema: skillSchemaOutputJsonSchema,
        },
        // P0 fix: Pin Claude Code executable path for Docker builds
        pathToClaudeCodeExecutable: claudeCodeExecutable,
        // P2 fix: Pass abort controller for timeout
        abortController,
        // Production fix: Set permission mode to bypass (no tools used anyway)
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    console.log('[Schema Generator] Query stream created, consuming events...');

    let resultData: unknown = null;
    let errorDetails: string[] = [];
    let errorSubtype: string | null = null;
    let lastStructuredOutputInput: unknown = null;
    let eventCount = 0;

    // Consume the stream to get the final result
    for await (const event of stream) {
      eventCount++;

      // Check for result event
      if (event.type === 'result') {
        const resultEvent = event as SDKResultMessage;
        traceLog('Result event raw', resultEvent);

        if ('subtype' in resultEvent) {
          if (resultEvent.subtype === 'success') {
            // The SDK returns structured output in structured_output field
            resultData = resultEvent.structured_output ?? resultEvent.result;
            console.log('[Schema Generator] Received success result');
            debugLog('Structured output:', JSON.stringify(resultEvent.structured_output).slice(0, 2000));
            traceLog('Structured output raw', resultEvent.structured_output ?? resultEvent.result);
          } else {
            // P1 fix: Handle error subtypes with detailed information
            // Possible error subtypes: 'error_during_execution', 'error_max_turns',
            // 'error_max_budget_usd', 'error_max_structured_output_retries'
            console.error(`[Schema Generator] SDK returned error subtype: ${resultEvent.subtype}`);

            // Extract error details if available
            if ('errors' in resultEvent && Array.isArray(resultEvent.errors)) {
              errorDetails = resultEvent.errors;
            }

            debugLog('Result event (error subtype):', JSON.stringify(resultEvent).slice(0, 2000));
            errorSubtype = resultEvent.subtype;
          }
        }
      }

      // Log progress for assistant messages
      if (event.type === 'assistant') {
        console.log('[Schema Generator] Received assistant message');
        debugLog('Assistant event:', JSON.stringify(event).slice(0, 2000));
        traceLog('Assistant event raw', event);

        const content = (event as { message?: { content?: Array<Record<string, unknown>> } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            // Check for StructuredOutput tool_use
            if (block?.type === 'tool_use' && block?.name === 'StructuredOutput' && 'input' in block) {
              const input = (block as { input?: unknown }).input;
              let inputValue = input;

              // P5 fix: Handle payload-wrapped JSON in StructuredOutput input
              if (input && typeof input === 'object' && 'payload' in (input as Record<string, unknown>)) {
                const payload = (input as Record<string, unknown>).payload;
                if (typeof payload === 'string') {
                  try {
                    const parsed = JSON.parse(payload);
                    if (parsed && typeof parsed === 'object') {
                      inputValue = parsed;
                      debugLog('Parsed StructuredOutput.payload JSON');
                    }
                  } catch {
                    debugLog('StructuredOutput.payload parse failed');
                  }
                }
              }

              // Only use if input is not empty object
              if (inputValue && typeof inputValue === 'object' && Object.keys(inputValue as object).length > 0) {
                lastStructuredOutputInput = inputValue;
                debugLog('Captured StructuredOutput.input with', Object.keys(inputValue as object).length, 'keys');
              }
            }
            // P4 fix: Also extract JSON from text blocks (model sometimes outputs JSON as text)
            if (block?.type === 'text' && typeof block?.text === 'string') {
              const text = block.text as string;
              // Try to parse as JSON if it looks like a schema
              if (text.includes('"version"') && text.includes('"inputs"')) {
                try {
                  const parsed = JSON.parse(text);
                  if (parsed && typeof parsed === 'object' && 'version' in parsed) {
                    debugLog('Extracted JSON from text block');
                    // Prefer text block JSON over empty StructuredOutput.input
                    if (!lastStructuredOutputInput ||
                        (typeof lastStructuredOutputInput === 'object' &&
                         Object.keys(lastStructuredOutputInput as object).length === 0)) {
                      lastStructuredOutputInput = parsed;
                      debugLog('Using text block JSON as fallback (', Object.keys(parsed).length, 'keys)');
                    }
                  }
                } catch {
                  // Not valid JSON, ignore
                  debugLog('Text block looks like JSON but failed to parse');
                }
              }
            }
          }
        }
      }

      if (event.type === 'system') {
        traceLog('System event raw', event);
      }

      // Note: SDK types don't include 'error' event type - errors are handled via result.subtype
    }

    console.log(`[Schema Generator] Processed ${eventCount} events`);

    const isEmptyObject = (value: unknown): boolean => (
      !!value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value as object).length === 0
    );

    // P4 safety: If SDK returns an empty structured output but we have a parsed JSON fallback, prefer it.
    if (isEmptyObject(resultData) && lastStructuredOutputInput && !isEmptyObject(lastStructuredOutputInput)) {
      debugLog('Structured output empty; using text/tool fallback');
      resultData = lastStructuredOutputInput;
    }

    if (!resultData && lastStructuredOutputInput) {
      debugLog('Falling back to last StructuredOutput input after SDK error');
      resultData = lastStructuredOutputInput;
    }

    if (!resultData) {
      if (errorSubtype) {
        throw new Error(
          `Schema generation failed (${errorSubtype}): ${
            errorDetails.length > 0
              ? errorDetails.join('; ')
              : 'No additional error details'
          }`
        );
      }
      throw new Error('Schema generation failed: no result received from SDK');
    }

    const normalizeResult = normalizeStructuredOutput(resultData, skillMdContent);
    const normalizedData = normalizeResult.data;
    traceLog('Normalized output', normalizedData);
    traceLog('Normalize parseFailed', normalizeResult.parseFailed);
    traceLog('Normalize parseErrors', normalizeResult.parseErrors);

    let truncationWarning: string | null = null;
    if (normalizedData && typeof normalizedData === 'object') {
      const obj = normalizedData as Record<string, unknown>;
      truncationWarning = truncateInputsIfNeeded(obj);
    }

    // Determine if we should mark needsReview due to parse issues or truncation
    const shouldMarkReview = normalizeResult.parseFailed || Boolean(truncationWarning);

    // Validate the result with Zod
    try {
      const validated = SkillSchemaZod.parse(normalizedData);
      console.log('[Schema Generator] Schema validated successfully');

      // P1/P2 fix: Even if Zod passes, mark needsReview if parse failed or inputs empty
      if (shouldMarkReview) {
        const reasons: string[] = [];
        if (normalizeResult.parseFailed) {
          reasons.push('Parse errors during normalization');
        }
        if (truncationWarning) {
          reasons.push(truncationWarning);
        }
        console.warn('[Schema Generator] Schema valid but needs review:', reasons.join('; '));
        return {
          schema: validated,
          needsReview: true,
          errorMessage: `${reasons.join('; ')}. ${normalizeResult.parseErrors.join('; ')}`.trim(),
        };
      }

      return {
        schema: validated,
        needsReview: false,
      };
    } catch (error) {
      traceLog('Zod parse error', error);
      traceLog('Zod parse input', normalizedData);

      const fallbackSchema = buildDraftSchema(normalizedData, skillMdContent);
      const errorMessage = error instanceof Error
        ? error.message
        : 'Schema validation failed';

      console.warn('[Schema Generator] Falling back to draft schema (needs review)');
      return {
        schema: SkillSchemaZod.parse(fallbackSchema),
        needsReview: true,
        errorMessage: errorSubtype
          ? `SDK error (${errorSubtype}): ${errorDetails.join('; ') || 'Structured output validation failed'}; ${errorMessage}`
          : `${errorMessage}${normalizeResult.parseErrors.length > 0 ? '; ' + normalizeResult.parseErrors.join('; ') : ''}`,
      };
    }
  } catch (error) {
    // P2 fix: Handle timeout/abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Schema generation timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  } finally {
    // P2 fix: Clean up timeout
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read SKILL.md content from a skill directory
 */
export async function readSkillMd(skillSlug: string): Promise<string> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const skillDir = path.join(getSkillsStoreDir(), normalizedSlug);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`SKILL.md not found for skill: ${skillSlug}`);
    }
    throw error;
  }
}

/**
 * Check if schema already exists for a skill
 */
export async function schemaExists(skillSlug: string): Promise<boolean> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const schemaPath = path.join(getSkillsStoreDir(), normalizedSlug, '.schema.json');

  try {
    await fs.access(schemaPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read existing schema from a skill directory (skills store)
 */
export async function readExistingSchema(skillSlug: string): Promise<SkillSchema | null> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const storeDir = getSkillsStoreDir();
  const schemaPath = path.join(storeDir, normalizedSlug, '.schema.json');

  console.info('[Skills] readExistingSchema called:', {
    skillSlug,
    normalizedSlug,
    storeDir,
    schemaPath,
  });

  try {
    const content = await fs.readFile(schemaPath, 'utf-8');
    const parsed = JSON.parse(content);
    console.info('[Skills] readExistingSchema success:', {
      skillSlug: normalizedSlug,
      schemaPath,
      inputsCount: Array.isArray(parsed?.inputs) ? parsed.inputs.length : 0,
    });
    return SkillSchemaZod.parse(parsed);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.info('[Skills] readExistingSchema failed:', {
      skillSlug: normalizedSlug,
      schemaPath,
      code: err?.code ?? null,
      message: err?.message ?? String(error),
    });
    return null;
  }
}

/**
 * Read schema from user-uploaded skill directory
 * Path: ~/.claude/skills/user/<skill-slug>/.schema.json
 *
 * @param userId - User ID for resolving CLAUDE_HOME
 * @param skillSlug - Skill identifier
 * @returns Parsed schema or null if not found/invalid
 */
export async function readUserSkillSchema(userId: string, skillSlug: string): Promise<SkillSchema | null> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const userHome = getUserClaudeHome(userId);
  const candidatePaths = [
    path.join(userHome, '.claude', 'skills', 'user', normalizedSlug, '.schema.json'),
    path.join(userHome, '.claude', 'skills', normalizedSlug, '.schema.json'),
  ];

  for (const schemaPath of candidatePaths) {
    try {
      const content = await fs.readFile(schemaPath, 'utf-8');
      const parsed = JSON.parse(content);
      return SkillSchemaZod.parse(parsed);
    } catch {
      // Try next path
    }
  }

  return null;
}

/**
 * Atomic write schema to skill directory
 *
 * Uses temp file + rename to ensure atomicity.
 * Failure will NOT affect the skill itself.
 */
export async function atomicWriteSchema(
  skillSlug: string,
  schema: SkillSchema,
): Promise<void> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const skillDir = path.join(getSkillsStoreDir(), normalizedSlug);
  const targetPath = path.join(skillDir, '.schema.json');
  const tempPath = `${targetPath}.tmp.${Date.now()}`;

  // Verify skill directory exists
  try {
    await fs.access(skillDir);
  } catch {
    throw new Error(`Skill directory not found: ${skillSlug}`);
  }

  try {
    // 1. Write to temp file
    const content = JSON.stringify(schema, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');

    // 2. Atomic rename
    await fs.rename(tempPath, targetPath);

    console.log(`[Schema Generator] Schema written to: ${targetPath}`);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export interface GenerateSchemaOptions {
  skillSlug: string;
  force?: boolean;  // If true, regenerate even if schema exists
}

export interface GenerateSchemaResult {
  schema: SkillSchema;
  cached: boolean;  // True if returned from cache, false if newly generated
  needsReview?: boolean;
  errorMessage?: string;
}

/**
 * Generate (or return cached) schema for a skill
 *
 * This is the main entry point for schema generation.
 * - If schema exists and force=false, returns cached schema
 * - If schema doesn't exist or force=true, generates new schema
 */
export async function generateSkillSchema(
  options: GenerateSchemaOptions,
): Promise<GenerateSchemaResult> {
  const { skillSlug, force = false } = options;

  console.log(`[Schema Generator] Request for skill: ${skillSlug}, force: ${force}`);

  // Check cache first (unless force=true)
  if (!force) {
    const existing = await readExistingSchema(skillSlug);
    if (existing) {
      console.log(`[Schema Generator] Returning cached schema for: ${skillSlug}`);
      return { schema: existing, cached: true };
    }
  }

  // Read SKILL.md
  const skillMdContent = await readSkillMd(skillSlug);
  console.log(`[Schema Generator] Read SKILL.md (${skillMdContent.length} chars)`);

  // Generate schema using SDK
  const result = await generateSchemaFromContent(skillMdContent);

  // Write schema atomically
  await atomicWriteSchema(skillSlug, result.schema);

  return {
    schema: result.schema,
    cached: false,
    needsReview: result.needsReview,
    errorMessage: result.errorMessage,
  };
}

// ============================================================================
// Schema Meta Types and Functions
// ============================================================================

/**
 * Schema meta information stored in .schema.meta.json
 *
 * Time field semantics:
 * - generatedAt: Only set on successful generation (undefined if never succeeded)
 * - lastAttemptAt: Set on every attempt (success or failure)
 */
const SchemaMetaZod = z.object({
  generatedAt: z.string().optional().describe('ISO timestamp of last successful generation (undefined if never succeeded)'),
  generatedBy: z.string().describe('User ID who triggered the last attempt'),
  model: z.string().describe('Model used for generation'),
  skillMdHash: z.string().describe('SHA-256 hash of SKILL.md content'),
  generatorVersion: z.string().describe('Schema generator version'),
  lastError: z.string().optional().describe('Last generation error message'),
  lastAttemptAt: z.string().optional().describe('ISO timestamp of last generation attempt (success or failure)'),
  needsReview: z.boolean().optional().describe('Schema saved with warnings; manual review recommended'),
});

export type SchemaMeta = z.infer<typeof SchemaMetaZod>;

/**
 * Schema status values
 */
export type SchemaStatus =
  | 'missing'     // .schema.json does not exist
  | 'valid'       // exists and parses successfully
  | 'invalid'     // exists but parse failed
  | 'stale'       // skillMdHash mismatch with current SKILL.md
  | 'generating'  // generation in progress (optional, for future use)
  | 'failed';     // last generation failed (meta.lastError present)

/**
 * Complete schema status information
 */
export interface SchemaStatusInfo {
  status: SchemaStatus;
  schema: SkillSchema | null;
  meta: SchemaMeta | null;
  skillSlug: string;
}

/**
 * Compute SHA-256 hash of SKILL.md content
 */
export function hashSkillMd(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Read schema meta from a skill directory
 */
export async function readSchemaMeta(skillSlug: string): Promise<SchemaMeta | null> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const metaPath = path.join(getSkillsStoreDir(), normalizedSlug, '.schema.meta.json');

  try {
    const content = await fs.readFile(metaPath, 'utf-8');
    const parsed = JSON.parse(content);
    return SchemaMetaZod.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Atomic write schema meta to skill directory
 */
export async function atomicWriteSchemaMeta(
  skillSlug: string,
  meta: SchemaMeta,
): Promise<void> {
  const normalizedSlug = normalizeSkillName(skillSlug);
  const skillDir = path.join(getSkillsStoreDir(), normalizedSlug);
  const targetPath = path.join(skillDir, '.schema.meta.json');
  const tempPath = `${targetPath}.tmp.${Date.now()}`;

  try {
    const content = JSON.stringify(meta, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, targetPath);
    console.log(`[Schema Generator] Meta written to: ${targetPath}`);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Update meta with error information (on generation failure)
 *
 * P2 fix: Uses lastAttemptAt to record failure time separately from generatedAt
 * - generatedAt: preserved from last successful generation
 * - lastAttemptAt: always updated to current time on any attempt
 */
export async function updateSchemaMetaError(
  skillSlug: string,
  errorMessage: string,
  userId: string,
): Promise<void> {
  const existingMeta = await readSchemaMeta(skillSlug);
  const now = new Date().toISOString();

  // Try to get current SKILL.md hash
  let skillMdHash = existingMeta?.skillMdHash ?? '';
  try {
    const content = await readSkillMd(skillSlug);
    skillMdHash = hashSkillMd(content);
  } catch {
    // Keep existing hash if can't read SKILL.md
  }

  const meta: SchemaMeta = {
    // Preserve last successful generation time (undefined if never succeeded)
    generatedAt: existingMeta?.generatedAt,  // Don't set default - leave undefined if never succeeded
    generatedBy: userId,
    model: resolveSchemaModelLabel(),
    skillMdHash,
    generatorVersion: SCHEMA_GENERATOR_VERSION,
    lastError: errorMessage,
    // Record the failure attempt time
    lastAttemptAt: now,
  };

  await atomicWriteSchemaMeta(skillSlug, meta);
}

/**
 * Compute schema status for a skill
 */
export async function computeSchemaStatus(skillSlug: string): Promise<SchemaStatusInfo> {
  const normalizedSlug = normalizeSkillName(skillSlug);

  // Read all relevant files
  const [schemaResult, meta] = await Promise.all([
    readExistingSchema(skillSlug),
    readSchemaMeta(skillSlug),
  ]);

  // Check if .schema.json file exists on disk
  const schemaFileExists = await schemaExists(skillSlug);

  // Case 1: Schema file doesn't exist
  if (!schemaFileExists) {
    // Check if there was a previous failed attempt
    if (meta?.lastError) {
      return {
        status: 'failed',
        schema: null,
        meta,
        skillSlug: normalizedSlug,
      };
    }
    return {
      status: 'missing',
      schema: null,
      meta,
      skillSlug: normalizedSlug,
    };
  }

  // Case 2: Schema file exists but parse failed
  if (schemaResult === null) {
    return {
      status: 'invalid',
      schema: null,
      meta,
      skillSlug: normalizedSlug,
    };
  }

  // Case 3: Check if schema is stale (SKILL.md changed)
  if (meta?.skillMdHash) {
    try {
      const currentContent = await readSkillMd(skillSlug);
      const currentHash = hashSkillMd(currentContent);

      if (currentHash !== meta.skillMdHash) {
        return {
          status: 'stale',
          schema: schemaResult,
          meta,
          skillSlug: normalizedSlug,
        };
      }
    } catch {
      // Can't read SKILL.md, consider stale
      return {
        status: 'stale',
        schema: schemaResult,
        meta,
        skillSlug: normalizedSlug,
      };
    }
  }

  // Case 4: Check for last error (failed status even if schema exists)
  if (meta?.lastError) {
    return {
      status: 'failed',
      schema: schemaResult,
      meta,
      skillSlug: normalizedSlug,
    };
  }

  // Case 5: Valid schema
  return {
    status: 'valid',
    schema: schemaResult,
    meta,
    skillSlug: normalizedSlug,
  };
}

// ============================================================================
// Enhanced Generation with Meta
// ============================================================================

export interface GenerateSchemaWithMetaOptions {
  skillSlug: string;
  userId: string;
  force?: boolean;
}

export interface GenerateSchemaWithMetaResult {
  schema: SkillSchema;
  meta: SchemaMeta;
  cached: boolean;
}

/**
 * Generate schema with meta information
 *
 * This is the enhanced entry point that also writes .schema.meta.json
 */
export async function generateSkillSchemaWithMeta(
  options: GenerateSchemaWithMetaOptions,
): Promise<GenerateSchemaWithMetaResult> {
  const { skillSlug, userId, force = false } = options;

  console.log(`[Schema Generator] Request with meta for skill: ${skillSlug}, force: ${force}`);

  // Read SKILL.md first (needed for hash)
  const skillMdContent = await readSkillMd(skillSlug);
  const skillMdHash = hashSkillMd(skillMdContent);

  const [existingSchema, existingMeta] = await Promise.all([
    readExistingSchema(skillSlug),
    readSchemaMeta(skillSlug),
  ]);

  // Check cache (unless force=true)
  if (!force) {
    // Return cached if schema exists, is valid, and hash matches
    if (existingSchema && existingMeta && existingMeta.skillMdHash === skillMdHash && !existingMeta.lastError) {
      console.log(`[Schema Generator] Returning cached schema with meta for: ${skillSlug}`);
      return {
        schema: existingSchema,
        meta: existingMeta,
        cached: true,
      };
    }
  }

  console.log(`[Schema Generator] Generating new schema for: ${skillSlug}`);

  // Generate schema using SDK
  const result = await generateSchemaFromContent(skillMdContent);

  // Build meta
  const now = new Date().toISOString();
  const meta: SchemaMeta = {
    generatedAt: result.needsReview ? existingMeta?.generatedAt : now,
    generatedBy: userId,
    model: resolveSchemaModelLabel(),
    skillMdHash,
    generatorVersion: SCHEMA_GENERATOR_VERSION,
    lastAttemptAt: now,  // P2 fix: Record attempt time on success too
    ...(result.needsReview
      ? {
          lastError: result.errorMessage ?? 'Schema saved with warnings; manual review required',
          needsReview: true,
        }
      : {}),
  };

  // Write both atomically (schema first, then meta)
  await atomicWriteSchema(skillSlug, result.schema);
  await atomicWriteSchemaMeta(skillSlug, meta);

  return { schema: result.schema, meta, cached: false };
}
