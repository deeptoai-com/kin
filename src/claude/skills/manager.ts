/**
 * Skills Manager
 *
 * Manages Skills enable/disable operations
 */

import { existsSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
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
let hasLoggedSkillsStoreDir = false
export function getSkillsStoreDir(): string {
  const envDir = process.env.SKILLS_STORE_DIR
  let resolvedDir = envDir ? envDir : path.join(process.cwd(), 'src', 'skills-store')
  if (!envDir) {
    const dataDir = path.join(path.sep, 'data', 'skills-store')
    if (existsSync(dataDir)) {
      resolvedDir = dataDir
    }
  }

  if (!hasLoggedSkillsStoreDir) {
    hasLoggedSkillsStoreDir = true
    console.info('[Skills] getSkillsStoreDir resolved:', {
      env: envDir || null,
      resolved: resolvedDir,
    })
  }

  return resolvedDir
}

/**
 * Get user's CLAUDE_HOME directory
 * Uses CLAUDE_SESSIONS_ROOT to be consistent with ws-server.mjs
 * Resolution order:
 * 1. CLAUDE_SESSIONS_ROOT env var (if set and non-empty)
 * 2. /data/users (Docker production, if exists)
 * 3. process.cwd()/user-data (development fallback)
 */
export function getUserClaudeHome(userId: string): string {
  const envRoot = process.env.CLAUDE_SESSIONS_ROOT
  let sessionsRoot: string

  if (envRoot && envRoot.trim()) {
    sessionsRoot = envRoot
  } else {
    // Check for Docker production path
    const dockerPath = path.join(path.sep, 'data', 'users')
    if (existsSync(dockerPath)) {
      sessionsRoot = dockerPath
    } else {
      // Development fallback
      sessionsRoot = path.join(process.cwd(), 'user-data')
    }
  }

  return path.join(sessionsRoot, userId)
}

/**
 * Get all available Skills from the Skills Store
 */
export async function getSkillsStore(): Promise<SkillInfo[]> {
  const storeDir = getSkillsStoreDir()

  try {
    const entries = await fsp.readdir(storeDir, { withFileTypes: true })

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
    const entries = await fsp.readdir(skillsDir, { withFileTypes: true })
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
 * Also removes the skill from user's disabled list if present
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
  await fsp.rm(targetDir, { recursive: true, force: true })

  // 3. Create parent directory
  await fsp.mkdir(path.dirname(targetDir), { recursive: true })

  // 4. Copy Skill directory
  await fsp.cp(sourceDir, targetDir, { recursive: true })

  // 5. Verify runtime sync
  try {
    await fsp.access(targetDir)
  } catch {
    throw new Error(`SKILL_NOT_SYNCED: ${normalizedName}`)
  }

  // 6. Remove from disabled list if present (user explicitly enabled)
  await removeFromUserDisabledSkills(userId, normalizedName)

  console.log(`[Skills] Enabled skill: ${normalizedName} for user: ${userId}`)
}

/**
 * Disable a Skill for a user
 * Records the skill in user's disabled list to prevent auto-sync from global settings
 */
export async function disableSkill(userId: string, skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const targetDir = path.join(getUserClaudeHome(userId), '.claude', 'skills', normalizedName)

  // 1. Delete directory
  await fsp.rm(targetDir, { recursive: true, force: true })

  // 2. Verify deletion succeeded
  const stillExists = await fileExists(targetDir)
  if (stillExists) {
    throw new Error('Failed to disable skill: directory still exists after deletion')
  }

  // 3. Add to user's disabled list (to prevent global auto-sync)
  await addToUserDisabledSkills(userId, normalizedName)

  console.log(`[Skills] Disabled skill: ${normalizedName} for user: ${userId}`)
}

// ============================================================================
// User Disabled Skills (Prevents auto-sync from global settings)
// ============================================================================

const USER_DISABLED_SKILLS_FILENAME = '.disabled-skills.json'

type UserDisabledSkillsFile = {
  version: number
  skills: string[]
  updatedAt?: string
}

async function getUserDisabledSkillsPath(userId: string): Promise<string> {
  const userHome = getUserClaudeHome(userId)
  return path.join(userHome, '.claude', USER_DISABLED_SKILLS_FILENAME)
}

export async function readUserDisabledSkills(userId: string): Promise<string[]> {
  const filePath = await getUserDisabledSkillsPath(userId)

  try {
    const raw = await fsp.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as UserDisabledSkillsFile
    if (!parsed || !Array.isArray(parsed.skills)) {
      return []
    }
    return normalizeSkillList(parsed.skills)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return []
    }
    console.warn('[Skills] Failed to read user disabled skills file:', error)
    return []
  }
}

async function writeUserDisabledSkills(userId: string, skills: string[]): Promise<void> {
  const filePath = await getUserDisabledSkillsPath(userId)
  const normalized = normalizeSkillList(skills)
  const payload: UserDisabledSkillsFile = {
    version: 1,
    skills: normalized,
    updatedAt: new Date().toISOString(),
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

async function addToUserDisabledSkills(userId: string, skillName: string): Promise<void> {
  const current = await readUserDisabledSkills(userId)
  const set = new Set(current)
  set.add(normalizeSkillName(skillName))
  await writeUserDisabledSkills(userId, Array.from(set))
}

async function removeFromUserDisabledSkills(userId: string, skillName: string): Promise<void> {
  const current = await readUserDisabledSkills(userId)
  const set = new Set(current)
  set.delete(normalizeSkillName(skillName))
  await writeUserDisabledSkills(userId, Array.from(set))
}

// ============================================================================
// Global Skills (Admin-managed, enabled for all users)
// ============================================================================

const GLOBAL_SKILLS_FILENAME = '.global-skills.json'

type GlobalSkillsFile = {
  version: number
  skills: string[]
  updatedAt?: string
}

function normalizeSkillList(skills: string[]): string[] {
  const normalized = skills.map((s) => normalizeSkillName(s))
  return Array.from(new Set(normalized)).filter(Boolean)
}

export async function readGlobalSkills(): Promise<string[]> {
  const storeDir = getSkillsStoreDir()
  const filePath = path.join(storeDir, GLOBAL_SKILLS_FILENAME)

  console.log(`[Skills] Reading global skills from: ${filePath}`)

  try {
    const raw = await fsp.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as GlobalSkillsFile
    if (!parsed || !Array.isArray(parsed.skills)) {
      console.log(`[Skills] Global skills file exists but invalid format`)
      return []
    }
    const skills = normalizeSkillList(parsed.skills)
    console.log(`[Skills] Global skills found: ${skills.length}`, skills)
    return skills
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      console.log(`[Skills] Global skills file not found at: ${filePath}`)
      return []
    }
    console.warn('[Skills] Failed to read global skills file:', error)
    return []
  }
}

export async function writeGlobalSkills(skills: string[]): Promise<void> {
  const storeDir = getSkillsStoreDir()
  const filePath = path.join(storeDir, GLOBAL_SKILLS_FILENAME)
  const normalized = normalizeSkillList(skills)
  const payload: GlobalSkillsFile = {
    version: 1,
    skills: normalized,
    updatedAt: new Date().toISOString(),
  }

  console.log(`[Skills] Writing global skills to: ${filePath}`, normalized)

  try {
    await fsp.mkdir(storeDir, { recursive: true })
    await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    console.log(`[Skills] ✓ Global skills saved successfully`)
  } catch (error) {
    console.error(`[Skills] ✗ Failed to write global skills:`, error)
    throw error
  }
}

export async function setGlobalSkillEnabled(skillName: string, enabled: boolean): Promise<string[]> {
  const normalized = normalizeSkillName(skillName)
  const current = await readGlobalSkills()
  const set = new Set(current)
  if (enabled) {
    set.add(normalized)
  } else {
    set.delete(normalized)
  }
  const next = Array.from(set)
  await writeGlobalSkills(next)
  return next
}

/**
 * Sync user's skills based on global settings and user preferences
 *
 * Logic:
 * - Target skills = (global enabled) ∪ (user enabled) - (user disabled)
 * - Add: skills in target but not in current user directory
 * - Remove: skills in current user directory but not in target
 *
 * This should be called on conversation initialization.
 */
export async function syncUserSkills(userId: string): Promise<{
  added: string[]
  removed: string[]
  unchanged: string[]
}> {
  console.log(`[Skills] Syncing skills for user: ${userId}`)

  // 1. Read all lists
  const globalEnabled = await readGlobalSkills()
  const userDisabled = await readUserDisabledSkills(userId)
  const currentUserSkills = await getUserEnabledSkills(userId)

  // 2. Calculate target skills
  // Target = (global enabled - user disabled) ∪ (current user skills - user disabled)
  // But we need to be careful: user disabled takes priority
  const disabledSet = new Set(userDisabled)

  // Skills that should be enabled = global enabled (minus disabled) + currently enabled (minus disabled)
  const targetSet = new Set<string>()

  // Add global skills (unless user disabled them)
  for (const skill of globalEnabled) {
    if (!disabledSet.has(skill)) {
      targetSet.add(skill)
    }
  }

  // Keep user-enabled skills that are not disabled
  // (These are skills user explicitly enabled, even if not in global list)
  for (const skill of currentUserSkills) {
    if (!disabledSet.has(skill)) {
      targetSet.add(skill)
    }
  }

  // 3. Calculate diff
  const currentSet = new Set(currentUserSkills)
  const toAdd = Array.from(targetSet).filter(s => !currentSet.has(s))
  const toRemove = Array.from(currentSet).filter(s => !targetSet.has(s))
  const unchanged = Array.from(currentSet).filter(s => targetSet.has(s))

  console.log(`[Skills] Sync plan:`, {
    globalEnabled: globalEnabled.length,
    userDisabled: userDisabled.length,
    current: currentUserSkills.length,
    target: targetSet.size,
    toAdd: toAdd.length,
    toRemove: toRemove.length,
  })

  // 4. Add new skills
  const added: string[] = []
  for (const skillName of toAdd) {
    try {
      // Use internal copy logic (don't call enableSkill to avoid removing from disabled list)
      const sourceDir = path.join(getSkillsStoreDir(), skillName)
      const targetDir = path.join(getUserClaudeHome(userId), '.claude', 'skills', skillName)

      if (!await fileExists(sourceDir)) {
        console.warn(`[Skills] Skill not found in store, skipping: ${skillName}`)
        continue
      }

      await fsp.mkdir(path.dirname(targetDir), { recursive: true })
      await fsp.cp(sourceDir, targetDir, { recursive: true })
      added.push(skillName)
      console.log(`[Skills]   ✓ Added: ${skillName}`)
    } catch (error) {
      console.error(`[Skills]   ✗ Failed to add: ${skillName}`, error)
    }
  }

  // 5. Remove skills
  const removed: string[] = []
  for (const skillName of toRemove) {
    try {
      const targetDir = path.join(getUserClaudeHome(userId), '.claude', 'skills', skillName)
      await fsp.rm(targetDir, { recursive: true, force: true })
      removed.push(skillName)
      console.log(`[Skills]   ✓ Removed: ${skillName}`)
    } catch (error) {
      console.error(`[Skills]   ✗ Failed to remove: ${skillName}`, error)
    }
  }

  console.log(`[Skills] Sync complete: ${added.length} added, ${removed.length} removed, ${unchanged.length} unchanged`)

  return { added, removed, unchanged }
}

/**
 * @deprecated Use syncUserSkills instead
 */
export async function ensureGlobalSkillsForUser(userId: string): Promise<string[]> {
  const result = await syncUserSkills(userId)
  return [...result.added, ...result.unchanged]
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
  await fsp.mkdir(userSkillsDir, { recursive: true })

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
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.writeFile(filePath, file.content, 'utf-8')
  }

  // 4. Auto-enable: create .enabled flag
  const enabledFlag = path.join(userSkillsDir, '.enabled')
  await fsp.writeFile(enabledFlag, new Date().toISOString())

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
    const entries = await fsp.readdir(userSkillsDir, { withFileTypes: true })

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
  await fsp.rm(skillDir, { recursive: true, force: true })

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

  // Ensure runtime directory exists; otherwise enabling won't take effect
  const runtimeDir = path.join(getUserClaudeHome(userId), '.claude', 'skills', normalizedName)
  try {
    await fsp.access(runtimeDir)
  } catch {
    throw new Error(`SKILL_NOT_SYNCED: ${normalizedName}`)
  }

  // Create .enabled flag
  const enabledFlag = path.join(skillDir, '.enabled')
  await fsp.writeFile(enabledFlag, new Date().toISOString())

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
  await fsp.rm(enabledFlag, { force: true })

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
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      const relativeFilePath = path.join(relativePath, entry.name)

      if (entry.isDirectory()) {
        // Skip .enabled flag
        if (entry.name === '.enabled') continue
        await readDirectory(fullPath, relativeFilePath)
      } else if (entry.isFile()) {
        const content = await fsp.readFile(fullPath, 'utf-8')
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

// ============================================================================
// GitHub-Installed Skills Management (Admin Only)
// ============================================================================

/**
 * Check if a skill is GitHub-installed (has .source.json)
 */
export async function isGitHubInstalledSkill(skillName: string): Promise<boolean> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(getSkillsStoreDir(), normalizedName)
  const sourceJsonPath = path.join(skillDir, '.source.json')
  return await fileExists(sourceJsonPath)
}

/**
 * Get extended skill info including deletable flag
 * Returns info with additional properties for UI decisions
 */
export async function getExtendedSkillInfo(skillName: string): Promise<{
  isGitHubInstalled: boolean
  sourceInfo?: {
    type: 'github' | 'upload' | 'builtin'
    owner?: string
    repo?: string
    commitSha: string | null
    installedAt: string
    installedBy: string
  }
}> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(getSkillsStoreDir(), normalizedName)
  const sourceJsonPath = path.join(skillDir, '.source.json')

  const isGitHubInstalled = await fileExists(sourceJsonPath)

  if (isGitHubInstalled) {
    try {
      const content = await fsp.readFile(sourceJsonPath, 'utf-8')
      const sourceInfo = JSON.parse(content)
      return {
        isGitHubInstalled: true,
        sourceInfo,
      }
    } catch {
      // .source.json exists but couldn't be read
      return { isGitHubInstalled: true }
    }
  }

  return { isGitHubInstalled: false }
}

/**
 * Delete a GitHub-installed skill from the global Skills Store
 * Admin only - used for managing GitHub-installed skills
 */
export async function deleteGitHubSkill(skillName: string): Promise<void> {
  const normalizedName = normalizeSkillName(skillName)
  const skillDir = path.join(getSkillsStoreDir(), normalizedName)

  // Verify skill exists
  if (!await fileExists(skillDir)) {
    throw new Error(`Skill not found: ${normalizedName}`)
  }

  // Verify it's a GitHub-installed skill (has .source.json)
  const isGitHubInstalled = await isGitHubInstalledSkill(skillName)
  if (!isGitHubInstalled) {
    throw new Error(`Cannot delete built-in skill: ${normalizedName}. Only GitHub-installed skills can be deleted.`)
  }

  // Delete entire skill directory
  await fsp.rm(skillDir, { recursive: true, force: true })

  console.log(`[Skills] Deleted GitHub-installed skill: ${normalizedName}`)
}
