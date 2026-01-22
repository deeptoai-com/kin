/**
 * GitHub Skills Installer
 *
 * Downloads a GitHub repo archive, finds the requested Skill, and installs it
 * into the global Skills Store.
 */

import { promises as fs } from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import unzip, { type ZipEntry } from 'unzip-stream'

import { getSkillsStoreDir, normalizeSkillName } from './manager'
import { fileExists, parseSkillMetadata } from './metadata'

export interface SkillSourceInfo {
  type: 'github' | 'upload' | 'builtin'
  owner?: string
  repo?: string
  commitSha: string | null
  installedAt: string
  installedBy: string
}

export interface InstallResult {
  success: boolean
  skillName: string
  error?: string
  metadata?: {
    name: string
    description: string | null
    category?: string
  }
  source?: SkillSourceInfo
}

export interface InstallOptions {
  owner: string
  repo: string
  skillName: string
  installedBy: string
}

const SEARCH_PATHS = [
  '',
  'skills',
  'skills/.curated',
  'skills/.experimental',
  '.claude/skills',
  '.cursor/skills',
  '.agents/skills',
]

const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024
const DOWNLOAD_TIMEOUT = 30 * 1000

export async function installSkillFromGitHub(options: InstallOptions): Promise<InstallResult> {
  const normalizedSkillName = normalizeSkillName(options.skillName)

  if (!normalizedSkillName) {
    return {
      success: false,
      skillName: options.skillName,
      error: 'Skill 名称无效',
    }
  }

  const storeDir = getSkillsStoreDir()

  let tempDir: string | null = null

  try {
    await fs.mkdir(storeDir, { recursive: true })

    const downloadResult = await downloadFromGitHub(options.owner, options.repo)
    tempDir = downloadResult.tempDir

    const extractedRoot = await getExtractedRootDir(tempDir)
    const skillDir = await findSkillDirectory(extractedRoot, normalizedSkillName)

    const metadata = await parseSkillMetadata(skillDir, normalizedSkillName)
    if (!metadata) {
      return {
        success: false,
        skillName: normalizedSkillName,
        error: '无法解析 Skill 元数据',
      }
    }

    const source: SkillSourceInfo = {
      type: 'github',
      owner: options.owner,
      repo: options.repo,
      commitSha: downloadResult.commitSha,
      installedAt: new Date().toISOString(),
      installedBy: options.installedBy,
    }

    await stageInstall(skillDir, normalizedSkillName, storeDir, source)

    return {
      success: true,
      skillName: normalizedSkillName,
      metadata: {
        name: metadata.name,
        description: metadata.description,
        category: metadata.category,
      },
      source,
    }
  } catch (error) {
    return {
      success: false,
      skillName: normalizedSkillName,
      error: error instanceof Error ? error.message : '安装失败',
    }
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export async function getExtractedRootDir(tempDir: string): Promise<string> {
  const entries = await fs.readdir(tempDir, { withFileTypes: true })
  const dirs = entries.filter((entry) => entry.isDirectory())

  if (dirs.length === 1) {
    return path.join(tempDir, dirs[0].name)
  }

  return tempDir
}

export function isSafePath(basePath: string, targetPath: string): boolean {
  const normalizedBase = path.resolve(basePath)
  const normalizedTarget = path.resolve(path.join(basePath, targetPath))
  return normalizedTarget.startsWith(`${normalizedBase}${path.sep}`) || normalizedTarget === normalizedBase
}

async function stageInstall(
  sourceDir: string,
  skillName: string,
  storeDir: string,
  source: SkillSourceInfo
): Promise<void> {
  const targetDir = path.join(storeDir, skillName)
  const tempTarget = path.join(storeDir, `.${skillName}.installing`)

  await fs.rm(tempTarget, { recursive: true, force: true })
  await fs.cp(sourceDir, tempTarget, { recursive: true })

  await writeSkillSource(tempTarget, source)

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.rename(tempTarget, targetDir)
}

async function writeSkillSource(skillDir: string, source: SkillSourceInfo): Promise<void> {
  const sourcePath = path.join(skillDir, '.source.json')
  const tempPath = path.join(skillDir, '.source.json.tmp')

  await fs.writeFile(tempPath, JSON.stringify(source, null, 2))
  await fs.rename(tempPath, sourcePath)
}

async function findSkillDirectory(rootDir: string, skillName: string): Promise<string> {
  const normalizedName = normalizeSkillName(skillName)

  const directMatch = await findDirectMatch(rootDir, normalizedName)
  if (directMatch) return directMatch

  const candidates = await findSkillCandidates(rootDir)

  const matched = await matchByMetadata(candidates, normalizedName)
  if (matched) return matched

  if (candidates.length === 1) {
    return candidates[0]
  }

  throw new Error('未找到指定的 Skill')
}

async function findDirectMatch(rootDir: string, skillName: string): Promise<string | null> {
  for (const basePath of SEARCH_PATHS) {
    const baseDir = path.join(rootDir, basePath)
    const candidateDir = path.join(baseDir, skillName)
    const skillPath = path.join(candidateDir, 'SKILL.md')
    if (await fileExists(skillPath)) {
      return candidateDir
    }
  }

  return null
}

async function findSkillCandidates(rootDir: string): Promise<string[]> {
  const candidates: string[] = []

  for (const basePath of SEARCH_PATHS) {
    const baseDir = path.join(rootDir, basePath)
    if (!await fileExists(baseDir)) continue

    const entries = await fs.readdir(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidateDir = path.join(baseDir, entry.name)
      const skillPath = path.join(candidateDir, 'SKILL.md')
      if (await fileExists(skillPath)) {
        candidates.push(candidateDir)
      }
    }
  }

  // root-level SKILL.md (if any)
  const rootSkillPath = path.join(rootDir, 'SKILL.md')
  if (await fileExists(rootSkillPath)) {
    candidates.push(rootDir)
  }

  return candidates
}

async function matchByMetadata(candidates: string[], skillName: string): Promise<string | null> {
  for (const candidate of candidates) {
    const fallbackName = path.basename(candidate)
    const metadata = await parseSkillMetadata(candidate, fallbackName)
    const metadataName = metadata?.name || fallbackName

    if (normalizeSkillName(metadataName) === skillName) {
      return candidate
    }

    if (normalizeSkillName(fallbackName) === skillName) {
      return candidate
    }
  }

  return null
}

async function downloadFromGitHub(
  owner: string,
  repo: string
): Promise<{ tempDir: string; commitSha: string | null }> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'skill-install-'))

  const commitSha = await getCommitSha(owner, repo)
  const ref = commitSha || 'HEAD'
  const archiveUrl = `https://github.com/${owner}/${repo}/archive/${ref}.zip`

  const zipPath = path.join(tempDir, 'archive.zip')
  await downloadWithLimits(archiveUrl, zipPath)

  await safeExtractZip(zipPath, tempDir)
  await fs.rm(zipPath, { force: true })

  return { tempDir, commitSha }
}

async function getCommitSha(owner: string, repo: string): Promise<string | null> {
  try {
    const repoInfo = await fetchGitHubApi(`/repos/${owner}/${repo}`)
    if (!repoInfo.ok) {
      console.warn(`[GitHub] Failed to get repo info: ${repoInfo.status}`)
      return null
    }
    const { default_branch } = await repoInfo.json()

    const refInfo = await fetchGitHubApi(`/repos/${owner}/${repo}/commits/${default_branch}`)
    if (!refInfo.ok) {
      console.warn(`[GitHub] Failed to get commit info: ${refInfo.status}`)
      return null
    }
    const { sha } = await refInfo.json()

    return sha || null
  } catch (error) {
    console.warn('[GitHub] API error, proceeding without commit SHA:', error)
    return null
  }
}

async function fetchGitHubApi(endpoint: string): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': 'Constructa-Skills-Installer/1.0',
    Accept: 'application/vnd.github.v3+json',
  }

  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `token ${token}`
  }

  const response = await fetch(`https://api.github.com${endpoint}`, { headers })

  const remaining = response.headers.get('X-RateLimit-Remaining')
  if (remaining && Number.parseInt(remaining, 10) < 10) {
    console.warn(`[GitHub] Rate limit low: ${remaining} remaining`)
  }

  if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
    const resetTime = response.headers.get('X-RateLimit-Reset')
    const resetDate = resetTime
      ? new Date(Number.parseInt(resetTime, 10) * 1000).toISOString()
      : 'unknown'
    throw new Error(`GitHub API rate limit exceeded. Resets at: ${resetDate}`)
  }

  return response
}

async function downloadWithLimits(url: string, destPath: string): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_ARCHIVE_SIZE) {
      throw new Error(`Archive too large: ${contentLength} bytes (max: ${MAX_ARCHIVE_SIZE})`)
    }

    if (!response.body) {
      throw new Error('Download failed: empty response body')
    }

    const limitStream = createSizeLimitStream(MAX_ARCHIVE_SIZE)
    const nodeStream = Readable.fromWeb(response.body)

    await pipeline(nodeStream, limitStream, createWriteStream(destPath))
  } finally {
    clearTimeout(timeoutId)
  }
}

function createSizeLimitStream(maxBytes: number): Transform {
  let totalSize = 0

  return new Transform({
    transform(chunk, _encoding, callback) {
      totalSize += chunk.length
      if (totalSize > maxBytes) {
        callback(new Error(`Archive too large: exceeded ${maxBytes} bytes`))
        return
      }
      callback(null, chunk)
    },
  })
}

async function safeExtractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const pending: Array<Promise<void>> = []
    const parser = unzip.Parse()

    parser.on('entry', (entry: ZipEntry) => {
      const entryPath = entry.path.replace(/\\/g, '/')

      const task = (async () => {
        if (!isSafePath(destDir, entryPath)) {
          entry.autodrain()
          throw new Error(`ZipSlip detected: ${entryPath}`)
        }

        const targetPath = path.join(destDir, entryPath)

        if (entry.type === 'Directory') {
          await fs.mkdir(targetPath, { recursive: true })
          entry.autodrain()
          return
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await pipeline(entry, createWriteStream(targetPath))
      })()

      pending.push(task)
    })

    parser.once('error', (error: Error) => {
      reject(error)
    })

    parser.once('close', () => {
      Promise.all(pending).then(() => resolve()).catch(reject)
    })

    createReadStream(zipPath).pipe(parser)
  })
}
