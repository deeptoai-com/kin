/**
 * Skills Manager
 *
 * Manages Skills enable/disable operations
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SkillInfo } from './types'
import { parseSkillMetadata, fileExists } from './metadata'

/**
 * Normalize skill name to prevent path traversal attacks
 */
export function normalizeSkillName(skillName: string): string {
  return skillName.replace(/[^A-Za-z0-9-_]/g, '_')
}

/**
 * Get Skills Store directory
 * - Production: uses SKILLS_STORE_DIR env var (data volume)
 * - Development: falls back to src/skills-store (source directory)
 */
export function getSkillsStoreDir(): string {
  if (process.env.SKILLS_STORE_DIR) {
    return process.env.SKILLS_STORE_DIR
  }
  return path.join(process.cwd(), 'src', 'skills-store')
}

/**
 * Get user's CLAUDE_HOME directory
 * Uses CLAUDE_SESSIONS_ROOT to be consistent with ws-server.mjs
 */
export function getUserClaudeHome(userId: string): string {
  // Use same root as WebSocket server for consistency
  // Handle both undefined and empty string cases
  const envRoot = process.env.CLAUDE_SESSIONS_ROOT
  const sessionsRoot = (envRoot && envRoot.trim())
    ? envRoot
    : path.join(process.cwd(), 'user-data')
  return path.join(sessionsRoot, userId)
}

/**
 * Get all available Skills from the Skills Store
 */
export async function getSkillsStore(): Promise<SkillInfo[]> {
  const storeDir = getSkillsStoreDir()

  try {
    const entries = await fs.readdir(storeDir, { withFileTypes: true })

    const skills = await Promise.all(
      entries
        .filter(e => e.isDirectory())
        .map(async (entry) => {
          const skillPath = path.join(storeDir, entry.name)
          return parseSkillMetadata(skillPath, entry.name)
        })
    )

    return skills.filter((skill): skill is SkillInfo => Boolean(skill))
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      // Skills Store doesn't exist, return empty array
      console.warn('[Skills] Skills Store directory does not exist:', storeDir)
      return []
    }
    throw error
  }
}

/**
 * Get user's enabled Skills
 */
export async function getUserEnabledSkills(userId: string): Promise<string[]> {
  const skillsDir = path.join(getUserClaudeHome(userId), '.claude', 'skills')

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      // .claude/skills/ doesn't exist, return empty array
      return []
    }
    throw error
  }
}

/**
 * Enable a Skill for a user
 */
export async function enableSkill(userId: string, skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const sourceDir = path.join(getSkillsStoreDir(), normalizedName)
  const userHome = getUserClaudeHome(userId)
  const targetDir = path.join(userHome, '.claude', 'skills', normalizedName)

  // 1. Verify source exists
  if (!await fileExists(sourceDir)) {
    throw new Error(`Skill not found in store: ${normalizedName}`)
  }

  // 2. Delete old version if exists (auto-update strategy)
  await fs.rm(targetDir, { recursive: true, force: true })

  // 3. Create parent directory
  await fs.mkdir(path.dirname(targetDir), { recursive: true })

  // 4. Copy Skill directory
  await fs.cp(sourceDir, targetDir, { recursive: true })

  console.log(`[Skills] Enabled skill: ${normalizedName} for user: ${userId}`)
}

/**
 * Disable a Skill for a user
 */
export async function disableSkill(userId: string, skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const targetDir = path.join(getUserClaudeHome(userId), '.claude', 'skills', normalizedName)

  // 1. Delete directory
  await fs.rm(targetDir, { recursive: true, force: true })

  // 2. Verify deletion succeeded
  const stillExists = await fileExists(targetDir)
  if (stillExists) {
    throw new Error('Failed to disable skill: directory still exists after deletion')
  }

  console.log(`[Skills] Disabled skill: ${normalizedName} for user: ${userId}`)
}

// ============================================================================
// User-Uploaded Skills Management (Private Skills Library)
// ============================================================================

/**
 * Upload a user-created skill
 */
export async function uploadUserSkill(
  userId: string,
  skillName: string,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const userSkillsDir = path.join(
    getUserClaudeHome(userId),
    '.claude',
    'skills',
    'user', // Subdirectory for user-uploaded skills
    normalizedName
  )

  // 1. Create directory
  await fs.mkdir(userSkillsDir, { recursive: true })

  // 2. Detect zip structure (with or without root directory)
  // Collect all first-level directory names
  const firstLevelDirs = new Set<string>()
  for (const file of files) {
    const normalizedPath = path.normalize(file.path)
    const firstPart = normalizedPath.split(path.sep)[0]
    if (firstPart && !firstPart.includes('.')) {
      // Only consider non-file paths (likely directories)
      firstLevelDirs.add(firstPart)
    }
  }

  // If all files share the same first-level directory, it's a root directory to strip
  const shouldStripRootDir = firstLevelDirs.size === 1 && files.every(f => {
    const normalizedPath = path.normalize(f.path)
    const firstPart = normalizedPath.split(path.sep)[0]
    return firstPart === [...firstLevelDirs][0]
  })

  console.log(`[Skills] Zip structure detection:`, {
    hasRootDir: shouldStripRootDir,
    rootDir: shouldStripRootDir ? [...firstLevelDirs][0] : 'none',
    fileCount: files.length
  })

  // 3. Write files
  for (const file of files) {
    // Validate file path (prevent directory traversal)
    const normalizedPath = path.normalize(file.path)
    if (normalizedPath.includes('..')) {
      throw new Error(`Invalid file path: ${file.path}`)
    }

    // Strip root directory if detected
    // e.g., "ai-market-intelligence/SKILL.md" → "SKILL.md"
    let finalPath = normalizedPath
    if (shouldStripRootDir) {
      const pathParts = normalizedPath.split(path.sep)
      finalPath = pathParts.slice(1).join(path.sep)
      // Handle edge case: file at root level
      if (!finalPath) {
        finalPath = pathParts[0]
      }
    }

    const filePath = path.join(userSkillsDir, finalPath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file.content, 'utf-8')
  }

  // 4. Auto-enable: create .enabled flag
  const enabledFlag = path.join(userSkillsDir, '.enabled')
  await fs.writeFile(enabledFlag, new Date().toISOString())

  console.log(`[Skills] Uploaded user skill: ${normalizedName} for user: ${userId}`)
}

/**
 * Get user-uploaded skills
 */
export async function getUserUploadedSkills(userId: string): Promise<Array<SkillInfo & { enabled: boolean }>> {
  const userSkillsDir = path.join(
    getUserClaudeHome(userId),
    '.claude',
    'skills',
    'user'
  )

  try {
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true })

    const skills = await Promise.all(
      entries
        .filter(e => e.isDirectory())
        .map(async (entry) => {
          const skillPath = path.join(userSkillsDir, entry.name)

          // Check if enabled
          const enabledFlag = path.join(skillPath, '.enabled')
          const isEnabled = await fileExists(enabledFlag)

          // Parse metadata (similar to official skills)
          const skillMdPath = path.join(skillPath, 'SKILL.md')
          let metadata: SkillInfo = {
            slug: entry.name,
            name: entry.name,
            description: null,
            category: 'general',
          }

          if (await fileExists(skillMdPath)) {
            try {
              const parsed = await parseSkillMetadata(skillPath, entry.name)
              if (parsed) metadata = parsed
            } catch (error) {
              console.warn(`[Skills] Failed to parse metadata for ${entry.name}:`, error)
            }
          }

          return {
            ...metadata,
            enabled: isEnabled,
          }
        })
    )

    return skills.filter((skill): skill is SkillInfo & { enabled: boolean } => Boolean(skill))
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      // User hasn't uploaded any skills yet
      return []
    }
    throw error
  }
}

/**
 * Delete a user-uploaded skill
 */
export async function deleteUserSkill(userId: string, skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(
    getUserClaudeHome(userId),
    '.claude',
    'skills',
    'user',
    normalizedName
  )

  // Delete entire skill directory
  await fs.rm(skillDir, { recursive: true, force: true })

  console.log(`[Skills] Deleted user skill: ${normalizedName} for user: ${userId}`)
}

/**
 * Enable a user-uploaded skill
 */
export async function enableUserUploadedSkill(userId: string, skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(
    getUserClaudeHome(userId),
    '.claude',
    'skills',
    'user',
    normalizedName
  )

  // Verify skill exists
  if (!await fileExists(skillDir)) {
    throw new Error(`User skill not found: ${normalizedName}`)
  }

  // Create .enabled flag
  const enabledFlag = path.join(skillDir, '.enabled')
  await fs.writeFile(enabledFlag, new Date().toISOString())

  console.log(`[Skills] Enabled user skill: ${normalizedName} for user: ${userId}`)
}

/**
 * Disable a user-uploaded skill
 */
export async function disableUserUploadedSkill(userId: string, skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(
    getUserClaudeHome(userId),
    '.claude',
    'skills',
    'user',
    normalizedName
  )

  // Remove .enabled flag
  const enabledFlag = path.join(skillDir, '.enabled')
  await fs.rm(enabledFlag, { force: true })

  console.log(`[Skills] Disabled user skill: ${normalizedName} for user: ${userId}`)
}

/**
 * Get files in a user-uploaded skill
 */
export async function getUserSkillFiles(
  userId: string,
  skillName: string
): Promise<Array<{ path: string; content: string }>> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(
    getUserClaudeHome(userId),
    '.claude',
    'skills',
    'user',
    normalizedName
  )

  // Verify skill exists
  if (!await fileExists(skillDir)) {
    throw new Error(`User skill not found: ${normalizedName}`)
  }

  // Recursively read all files
  const files: Array<{ path: string; content: string }> = []

  async function readDirectory(dirPath: string, relativePath: string = '') {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      const relativeFilePath = path.join(relativePath, entry.name)

      if (entry.isDirectory()) {
        // Skip .enabled flag
        if (entry.name === '.enabled') continue
        await readDirectory(fullPath, relativeFilePath)
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath, 'utf-8')
        files.push({
          path: relativeFilePath,
          content,
        })
      }
    }
  }

  await readDirectory(skillDir)

  return files
}
