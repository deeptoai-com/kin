/**
 * Skills Detail Module
 *
 * Provides functions to retrieve full Skill details including all files
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SkillFile, SkillDetail } from './detail-types'
import { parseSkillMetadata } from './metadata'
import { getUserClaudeHome } from './manager'

// Re-export types for frontend use
export type { SkillFile, SkillDetail } from './detail-types'

/** Maximum file size to load (1MB) */
const MAX_FILE_SIZE = 1024 * 1024

/** Binary file extensions to skip loading content */
const BINARY_EXTENSIONS = new Set([
  '.tar.gz',
  '.tar',
  '.gz',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
])

/**
 * Check if a file is binary based on extension
 */
function isBinaryFile(filePath: string): boolean {
  const ext = filePath.toLowerCase()
  for (const binaryExt of BINARY_EXTENSIONS) {
    if (ext.endsWith(binaryExt)) {
      return true
    }
  }
  return false
}

/**
 * Recursively build file tree for a skill directory
 */
async function buildFileTree(
  dirPath: string,
  relativePath: string = ''
): Promise<SkillFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  const files: SkillFile[] = []

  // Sort: directories first, then files, both alphabetically
  const sortedEntries = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sortedEntries) {
    // Skip hidden files and .DS_Store
    if (entry.name.startsWith('.') || entry.name === '.DS_Store') {
      continue
    }

    const fullPath = path.join(dirPath, entry.name)
    const fileRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      // Recursively process directory
      const children = await buildFileTree(fullPath, fileRelativePath)
      files.push({
        path: fileRelativePath,
        name: entry.name,
        type: 'dir',
        children,
      })
    } else {
      // Process file
      const stats = await fs.stat(fullPath)
      const isBinary = isBinaryFile(entry.name)
      const isTooLarge = stats.size > MAX_FILE_SIZE

      let content: string | undefined
      if (!isBinary && !isTooLarge) {
        try {
          content = await fs.readFile(fullPath, 'utf-8')
        } catch (error) {
          // Skip files that can't be read as text
          console.warn(`[Skills] Failed to read file: ${fileRelativePath}`, error)
        }
      }

      files.push({
        path: fileRelativePath,
        name: entry.name,
        type: 'file',
        content,
        size: stats.size,
        isBinary,
        isTooLarge,
      })
    }
  }

  return files
}

/**
 * Get full Skill detail including all files
 *
 * This function tries to find the skill in the following order:
 * 1. Official skills store (src/skills-store/)
 * 2. User-uploaded skills (.claude/skills/user/)
 */
export async function getSkillDetail(skillSlug: string, userId?: string): Promise<SkillDetail> {
  // Try official skills first
  const officialSkillDir = path.join(process.cwd(), 'src', 'skills-store', skillSlug)
  const officialInfo = await parseSkillMetadata(officialSkillDir, skillSlug)

  if (officialInfo) {
    // Found in official skills
    const files = await buildFileTree(officialSkillDir)
    return {
      slug: skillSlug,
      name: officialInfo.name,
      description: officialInfo.description,
      category: officialInfo.category,
      files,
    }
  }

  // If userId provided, try user skills
  if (userId) {
    const userSkillDir = path.join(
      getUserClaudeHome(userId),
      '.claude',
      'skills',
      'user',
      skillSlug
    )

    // Check if directory exists
    try {
      await fs.access(userSkillDir)
      const userInfo = await parseSkillMetadata(userSkillDir, skillSlug)

      if (userInfo) {
        // Found in user skills
        const files = await buildFileTree(userSkillDir)
        return {
          slug: skillSlug,
          name: userInfo.name,
          description: userInfo.description,
          category: userInfo.category,
          files,
        }
      }
    } catch (error) {
      // Directory doesn't exist, continue to throw error
    }
  }

  // Skill not found in either location
  throw new Error(`Skill not found: ${skillSlug}`)
}
