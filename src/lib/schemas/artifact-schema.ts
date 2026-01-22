/**
 * Artifact Schema for Structured Outputs
 *
 * Defines the schema for AI-generated artifacts with metadata.
 * Used with Claude Agent SDK's Structured Outputs feature.
 */

import { z } from 'zod'

/**
 * Single file in an artifact
 */
export const ArtifactFileSchema = z.object({
  path: z.string().describe('File path (e.g., "App.jsx", "styles.css")'),
  content: z.string().describe('Complete file content'),
  language: z
    .enum(['html', 'css', 'javascript', 'typescript', 'jsx', 'tsx', 'svg', 'markdown', 'json', 'csv'])
    .describe('Programming language or file type'),
})

export type ArtifactFile = z.infer<typeof ArtifactFileSchema>

/**
 * Complete artifact metadata from Structured Outputs
 */
export const ArtifactMetadataSchema = z.object({
  title: z.string().describe('Descriptive title for the artifact (e.g., "Pomodoro Timer")'),
  description: z
    .string()
    .optional()
    .describe('Detailed description of what the artifact does and how it works'),
  type: z
    .enum(['html', 'svg', 'markdown', 'react', 'image', 'json', 'csv'])
    .describe('Type of artifact: html, svg, markdown, react component, image, json, or csv'),
  files: z
    .array(ArtifactFileSchema)
    .min(1)
    .describe('Array of files that make up this artifact'),
})

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>

/**
 * Convert Zod schema to JSON Schema for SDK
 */
export function getArtifactJsonSchema() {
  // Use zod-to-json-schema to convert
  const { zodToJsonSchema } = require('zod-to-json-schema')
  return zodToJsonSchema(ArtifactMetadataSchema, {
    name: 'ArtifactMetadata',
    $refStrategy: 'none', // Inline all schemas
  })
}

/**
 * Validate artifact metadata against schema
 */
export function validateArtifactMetadata(data: unknown): ArtifactMetadata | null {
  const result = ArtifactMetadataSchema.safeParse(data)
  if (result.success) {
    return result.data
  }

  console.error('[Artifact Schema] Validation failed:', result.error)
  return null
}

/**
 * Example usage for SDK integration:
 *
 * ```typescript
 * import { query } from '@anthropic-ai/claude-agent-sdk'
 * import { getArtifactJsonSchema, validateArtifactMetadata } from './artifact-schema'
 *
 * for await (const message of query({
 *   prompt: 'Create a React counter component',
 *   options: {
 *     outputFormat: {
 *       type: 'json_schema',
 *       schema: getArtifactJsonSchema()
 *     }
 *   }
 * })) {
 *   if (message.type === 'result' && message.structured_output) {
 *     const metadata = validateArtifactMetadata(message.structured_output)
 *     if (metadata) {
 *       // Use validated metadata
 *       console.log(`Title: ${metadata.title}`)
 *       console.log(`Type: ${metadata.type}`)
 *       console.log(`Files: ${metadata.files.length}`)
 *     }
 *   }
 * }
 * ```
 */
