/**
 * Skills Command Parser
 *
 * Parses `npx skills add` style commands and validates GitHub URLs.
 */

import { normalizeSkillName } from './manager'

export interface ParsedSkillCommand {
  valid: boolean
  url?: string
  skillName?: string
  owner?: string
  repo?: string
  error?: string
}

export interface GitHubUrlValidationResult {
  valid: boolean
  url?: string
  owner?: string
  repo?: string
  error?: string
}

export function validateGitHubUrl(input: string): GitHubUrlValidationResult {
  let normalizedInput = input.trim()

  if (!normalizedInput) {
    return { valid: false, error: 'URL 为空' }
  }

  if (!normalizedInput.startsWith('https://')) {
    if (normalizedInput.startsWith('github.com/')) {
      normalizedInput = `https://${normalizedInput}`
    } else if (/^[^/]+\/[^/]+$/.test(normalizedInput)) {
      normalizedInput = `https://github.com/${normalizedInput}`
    } else if (normalizedInput.startsWith('http://')) {
      return { valid: false, error: '必须使用 HTTPS 协议' }
    } else {
      return { valid: false, error: 'URL 格式无效' }
    }
  }

  let parsed: URL
  try {
    parsed = new URL(normalizedInput)
  } catch {
    return { valid: false, error: 'URL 格式无效' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: '必须使用 HTTPS 协议' }
  }

  if (parsed.hostname !== 'github.com') {
    return { valid: false, error: '仅支持 github.com 仓库' }
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URL 不能包含认证信息' }
  }

  if (parsed.search || parsed.hash) {
    return { valid: false, error: 'URL 不能包含查询参数或锚点' }
  }

  const trimmedPath = parsed.pathname.replace(/\.git$/, '')
  const segments = trimmedPath.split('/').filter(Boolean)

  if (segments.length < 2) {
    return { valid: false, error: '无法解析仓库路径' }
  }

  if (segments.length > 2) {
    return { valid: false, error: '仓库 URL 需为 owner/repo 形式' }
  }

  const [owner, repo] = segments

  if (!owner || !repo) {
    return { valid: false, error: '无法解析仓库路径' }
  }

  return {
    valid: true,
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  }
}

export function parseSkillsCommand(input: string): ParsedSkillCommand {
  const trimmed = input.trim()

  if (!trimmed) {
    return { valid: false, error: '命令为空' }
  }

  const patterns = [
    /^npx\s+skills\s+add\s+(\S+)\s+(?:--skill|-s)\s+(\S+)$/i,
    /^npx\s+skills\s+add\s+(\S+)\s+(?:--skill|-s)=(\S+)$/i,
    /^(\S+)\s+(?:--skill|-s)\s+(\S+)$/i,
    /^(\S+)\s+(?:--skill|-s)=(\S+)$/i,
  ]

  let source: string | null = null
  let rawSkillName: string | null = null

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match) {
      source = match[1]
      rawSkillName = match[2]
      break
    }
  }

  if (!source || !rawSkillName) {
    return {
      valid: false,
      error: '命令格式无效，请使用: npx skills add owner/repo --skill skill-name',
    }
  }

  const normalizedSkillName = normalizeSkillName(rawSkillName)
  if (!normalizedSkillName) {
    return { valid: false, error: 'Skill 名称无效' }
  }

  const validation = validateGitHubUrl(source)
  if (!validation.valid) {
    return { valid: false, error: validation.error }
  }

  return {
    valid: true,
    url: validation.url,
    owner: validation.owner,
    repo: validation.repo,
    skillName: normalizedSkillName,
  }
}
