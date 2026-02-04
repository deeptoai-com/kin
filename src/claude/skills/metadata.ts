/**
 * Skills Metadata Parser
 *
 * Extracts metadata from Skills packages (SKILL.md with YAML frontmatter)
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { SkillInfo } from './types'
import { getSkillIconUrl } from './icon-generator'

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Parse Skills metadata from a Skills directory
 * Only supports SKILL.md with YAML frontmatter (official format)
 */
export async function parseSkillMetadata(
  skillPath: string,
  fallbackName: string
): Promise<SkillInfo | null> {
  // Official format: SKILL.md with YAML frontmatter
  const manifestPath = path.join(skillPath, 'SKILL.md')
  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    const { name, description, category } = extractSkillMetadataFromMarkdown(content, fallbackName)
    const iconUrl = getSkillIconUrl(fallbackName)
    return { slug: fallbackName, name, description, category, iconUrl }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[Skills] Failed to read SKILL.md:`, error)
    }
    return null
  }
}

/**
 * Extract metadata from SKILL.md content with YAML frontmatter
 *
 * Expected format:
 * ---
 * name: skill-name
 * description: Skill description
 * category: development
 * license: ...
 * ---
 *
 * # Skill Title
 * ...
 */
function extractSkillMetadataFromMarkdown(
  content: string,
  fallbackName: string
): { name: string; description: string | null; category: string } {
  // Check for YAML frontmatter
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/
  const match = content.match(frontmatterRegex)

  if (match) {
    try {
      const frontmatter = yaml.load(match[1]) as {
        name?: string
        description?: string
        category?: string
      }
      if (frontmatter && typeof frontmatter === 'object') {
        return {
          name: frontmatter.name || fallbackName,
          description: frontmatter.description || null,
          category: frontmatter.category || 'general',
        }
      }
    } catch (error) {
      console.warn('[Skills] Failed to parse YAML frontmatter:', error)
    }
  }

  // Fallback: parse from markdown structure (for legacy support)
  const lines = content.split(/\r?\n/)
  const headingLineIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()))
  const name = headingLineIndex >= 0
    ? lines[headingLineIndex].replace(/^#\s+/, '').trim() || fallbackName
    : fallbackName

  let description: string | null = null
  for (let index = headingLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    if (line.startsWith('#')) break
    description = line
    break
  }

  return { name, description, category: 'general' }
}
