/**
 * Skills Store Seeder
 *
 * Seeds the Skills Store data volume from built-in skills on startup.
 * Only runs in production when SKILLS_STORE_DIR is set.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Seed Skills Store from built-in skills directory
 *
 * Strategy: "Incremental sync with overwrite"
 * - Syncs all built-in skills to store directory
 * - Overwrites existing skills with same name (ensures updates)
 * - Preserves user-installed skills not in built-in directory
 *
 * Only runs in production when SKILLS_STORE_DIR is set.
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

  // Get list of built-in skills
  const builtInEntries = await fs.readdir(builtInDir, { withFileTypes: true })
  const builtInSkills = builtInEntries.filter(e => e.isDirectory() && !e.name.startsWith('.'))

  if (builtInSkills.length === 0) {
    console.log('[Skills] No built-in skills found, skipping seed')
    return
  }

  console.log('[Skills] Syncing built-in skills to store...')
  console.log(`[Skills]   Source: ${builtInDir}`)
  console.log(`[Skills]   Target: ${storeDir}`)
  console.log(`[Skills]   Skills to sync: ${builtInSkills.length}`)

  let synced = 0
  let skipped = 0

  for (const skill of builtInSkills) {
    const sourcePath = path.join(builtInDir, skill.name)
    const targetPath = path.join(storeDir, skill.name)

    try {
      // Check if target exists
      let targetExists = false
      try {
        await fs.access(targetPath)
        targetExists = true
      } catch {
        // Target doesn't exist, will be created
      }

      // Remove existing and copy fresh (overwrite strategy)
      if (targetExists) {
        await fs.rm(targetPath, { recursive: true, force: true })
      }

      await fs.cp(sourcePath, targetPath, { recursive: true })
      synced++

      if (targetExists) {
        console.log(`[Skills]   ✓ Updated: ${skill.name}`)
      } else {
        console.log(`[Skills]   ✓ Added: ${skill.name}`)
      }
    } catch (err) {
      console.error(`[Skills]   ✗ Failed: ${skill.name}`, err instanceof Error ? err.message : err)
      skipped++
    }
  }

  console.log(`[Skills] Sync complete: ${synced} synced, ${skipped} failed`)
}
