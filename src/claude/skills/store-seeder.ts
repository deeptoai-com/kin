/**
 * Skills Store Seeder
 *
 * Seeds the Skills Store data volume from built-in skills on first startup.
 * Only runs in production when SKILLS_STORE_DIR is set.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Seed Skills Store from built-in skills directory
 *
 * Strategy: "First-time initialization only"
 * - Empty directory: copy all built-in skills
 * - Non-empty directory: skip (preserve user modifications)
 *
 * For upgrades with new built-in skills, admins should:
 * - Use GitHub install feature to add new skills
 * - Or manually sync specific skills
 */
export async function seedSkillsStore(): Promise<void> {
  const storeDir = process.env.SKILLS_STORE_DIR

  // Only seed in production (when SKILLS_STORE_DIR is set)
  if (!storeDir) {
    console.log('[Skills] Development mode, skipping seed')
    return
  }

  const builtInDir = path.join(process.cwd(), 'src', 'skills-store')

  // Check if built-in directory exists
  try {
    await fs.access(builtInDir)
  } catch {
    console.warn('[Skills] Built-in skills directory not found:', builtInDir)
    return
  }

  // Ensure store directory exists
  await fs.mkdir(storeDir, { recursive: true })

  // Check if store is empty (exclude hidden files like .source.json)
  const entries = await fs.readdir(storeDir)
  const visibleEntries = entries.filter(name => !name.startsWith('.'))

  if (visibleEntries.length === 0) {
    // Copy from built-in directory
    console.log('[Skills] Seeding skills store from built-in directory...')
    console.log(`[Skills]   Source: ${builtInDir}`)
    console.log(`[Skills]   Target: ${storeDir}`)

    await fs.cp(builtInDir, storeDir, { recursive: true })

    // Count copied skills
    const copiedEntries = await fs.readdir(storeDir, { withFileTypes: true })
    const copiedSkills = copiedEntries.filter(e => e.isDirectory())
    console.log(`[Skills] Seeded ${copiedSkills.length} skills successfully`)
  } else {
    console.log(`[Skills] Skills store already initialized (${visibleEntries.length} skills), skipping seed`)
  }
}
