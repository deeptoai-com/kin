// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseSkillsCommand, validateGitHubUrl } from '../src/claude/skills/command-parser'
import { getExtractedRootDir, isSafePath } from '../src/claude/skills/github-installer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

describe('parseSkillsCommand', () => {
  it('parses full command format', () => {
    const result = parseSkillsCommand('npx skills add owner/repo --skill skill-name')
    expect(result.valid).toBe(true)
    expect(result.owner).toBe('owner')
    expect(result.repo).toBe('repo')
    expect(result.skillName).toBe('skill-name')
  })

  it('parses simplified format', () => {
    const result = parseSkillsCommand('owner/repo --skill test')
    expect(result.valid).toBe(true)
    expect(result.url).toBe('https://github.com/owner/repo')
  })

  it('rejects missing skill argument', () => {
    const result = parseSkillsCommand('npx skills add owner/repo')
    expect(result.valid).toBe(false)
  })
})

describe('validateGitHubUrl', () => {
  it('accepts valid GitHub URL', () => {
    const result = validateGitHubUrl('https://github.com/owner/repo')
    expect(result.valid).toBe(true)
    expect(result.owner).toBe('owner')
    expect(result.repo).toBe('repo')
  })

  it('rejects http protocol', () => {
    const result = validateGitHubUrl('http://github.com/owner/repo')
    expect(result.valid).toBe(false)
  })

  it('rejects mixed hostnames', () => {
    const result = validateGitHubUrl('https://github.com.evil.com/a/b')
    expect(result.valid).toBe(false)
  })

  it('rejects credentialed URLs', () => {
    const result = validateGitHubUrl('https://user:pass@github.com/a/b')
    expect(result.valid).toBe(false)
  })
})

describe('getExtractedRootDir', () => {
  it('returns the only top-level directory', async () => {
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'skills-test-'))
    try {
      const childDir = path.join(tempDir, 'repo-abc123')
      await fs.mkdir(childDir, { recursive: true })
      const resolved = await getExtractedRootDir(tempDir)
      expect(resolved).toBe(childDir)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('isSafePath', () => {
  it('detects path traversal attempts', () => {
    const base = '/tmp/base'
    expect(isSafePath(base, '../etc/passwd')).toBe(false)
    expect(isSafePath(base, 'subdir/file.txt')).toBe(true)
  })
})
