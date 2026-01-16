/**
 * Artifacts Panel
 *
 * Main panel component for displaying and interacting with artifacts.
 */

import JSZip from 'jszip'
import { Download, Package, Upload, X } from 'lucide-react'
import { useMemo, useState, type FC } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { useArtifactsStore } from '~/lib/stores/artifacts-store'
import { uploadUserSkillFn } from '~/server/function/skills.server'
import { HTMLArtifact } from './artifact-html'
import { SVGArtifact } from './artifact-svg'
import { MarkdownArtifact } from './artifact-markdown'
import { ReactArtifact } from './artifact-react'

export interface ArtifactsPanelProps {
  artifactId: string | null
  onClose: () => void
}

type SkillInfo = {
  root: string
  skillName: string
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
}

function parseSkillName(content: string): string | null {
  const match = content.match(/^name:\s*(.+)$/m)
  if (!match) return null
  return match[1].trim().replace(/^["']|["']$/g, '')
}

function getSkillRoot(path: string): string | null {
  const normalized = normalizeWorkspacePath(path)
  if (!/skill\.md$/i.test(normalized)) return null
  return normalized.replace(/skill\.md$/i, '').replace(/\/$/, '')
}

export const ArtifactsPanel: FC<ArtifactsPanelProps> = ({ artifactId, onClose }) => {
  const artifact = useArtifactsStore((state) => {
    if (!artifactId) return null
    return state.getArtifactById(artifactId)
  })
  const [isSkillBusy, setIsSkillBusy] = useState(false)
  const uploadSkill = useServerFn(uploadUserSkillFn)

  const skillInfo = useMemo<SkillInfo | null>(() => {
    if (!artifact) return null
    const filePath = artifact.sourceFilePath || artifact.fileName
    if (!filePath) return null
    const root = getSkillRoot(filePath)
    if (root === null) return null
    const skillName =
      parseSkillName(artifact.content) ||
      root.split('/').pop() ||
      artifact.title ||
      'skill'
    return { root, skillName }
  }, [artifact])

  const getFallbackSkillFile = () => {
    if (!artifact || !skillInfo) return null
    if (!artifact.content) return null
    const rawPath =
      artifact.sourceFilePath ||
      artifact.fileName ||
      (skillInfo.root ? `${skillInfo.root}/SKILL.md` : 'SKILL.md')
    return {
      path: normalizeWorkspacePath(rawPath),
      content: artifact.content,
    }
  }

  const loadSkillFiles = async () => {
    if (!artifact || !skillInfo) return []
    if (!artifact.sessionId || artifact.sessionId === 'unknown') {
      toast.error('当前会话不可用，无法读取技能文件')
      return []
    }

    const fallbackFile = getFallbackSkillFile()
    const listResponse = await fetch(`/api/workspace/${artifact.sessionId}/files`)
    if (!listResponse.ok) {
      if (fallbackFile) {
        toast.message('工作区不可用，已仅打包 SKILL.md')
        return [fallbackFile]
      }
      throw new Error('Failed to list workspace files')
    }
    const { files } = await listResponse.json()
    const prefix = skillInfo.root ? `${skillInfo.root.replace(/\/$/, '')}/` : ''
    const candidates = (files as string[])
      .map((path) => normalizeWorkspacePath(path))
      .filter((path) => (prefix ? path.startsWith(prefix) : true))

    if (candidates.length === 0 && fallbackFile) {
      toast.message('未找到工作区文件，已仅打包 SKILL.md')
      return [fallbackFile]
    }

    const resolved = await Promise.all(
      candidates.map(async (path) => {
        const contentResponse = await fetch(`/api/workspace/${artifact.sessionId}/file/${path}`)
        if (!contentResponse.ok) {
          console.warn('Failed to load workspace file:', path)
          return null
        }
        const { content } = await contentResponse.json()
        return { path, content }
      })
    )

    return resolved.filter(
      (entry): entry is { path: string; content: string } => Boolean(entry)
    )
  }

  const validateSkillFiles = (files: Array<{ path: string; content: string }>) => {
    if (files.length === 0) {
      toast.error('未找到可打包的技能文件')
      return false
    }
    if (files.length > 100) {
      toast.error('文件数量超过限制（最多 100 个文件）')
      return false
    }
    const totalSize = files.reduce((sum, file) => sum + file.content.length, 0)
    if (totalSize > 10 * 1024 * 1024) {
      toast.error('技能包大小超过 10 MB 限制')
      return false
    }
    return true
  }

  const handleDownloadSkill = async () => {
    if (!skillInfo || isSkillBusy) return
    setIsSkillBusy(true)
    try {
      const files = await loadSkillFiles()
      if (!validateSkillFiles(files)) return
      const zip = new JSZip()
      for (const file of files) {
        zip.file(file.path, file.content)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${skillInfo.skillName}.skill`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${skillInfo.skillName}.skill`)
    } catch (error) {
      console.error('Failed to package skill:', error)
      toast.error('技能打包失败')
    } finally {
      setIsSkillBusy(false)
    }
  }

  const handleImportSkill = async () => {
    if (!skillInfo || isSkillBusy) return
    setIsSkillBusy(true)
    try {
      const files = await loadSkillFiles()
      if (!validateSkillFiles(files)) return
      await uploadSkill({
        data: {
          name: skillInfo.skillName,
          files,
        },
      })
      toast.success(`已导入技能：${skillInfo.skillName}`)
    } catch (error) {
      console.error('Failed to import skill:', error)
      toast.error('技能导入失败')
    } finally {
      setIsSkillBusy(false)
    }
  }

  const downloadArtifact = () => {
    if (!artifact) return

    // Determine MIME type and file extension based on artifact type
    const mimeTypeMap = {
      html: 'text/html;charset=utf-8',
      svg: 'image/svg+xml;charset=utf-8',
      markdown: 'text/markdown;charset=utf-8',
      react: 'text/javascript;charset=utf-8',
    } as const

    const extensionMap = {
      html: 'html',
      svg: 'svg',
      markdown: 'md',
      react: artifact.fileName?.split('.').pop() || 'jsx',
    } as const

    const blob = new Blob([artifact.content], {
      type: mimeTypeMap[artifact.type],
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = artifact.title
      ? `${artifact.title}.${extensionMap[artifact.type]}`
      : `artifact-${artifact.id.slice(0, 8)}.${extensionMap[artifact.type]}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!artifact) return null

  return (
    <div className="artifacts-panel h-full w-full flex flex-col border-l bg-background">
      {/* Header */}
      <div className="artifacts-header flex flex-col border-b bg-muted/30">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-muted-foreground">Artifact</span>
            {artifact.title && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-sm font-medium truncate">{artifact.title}</span>
              </>
            )}
            {artifact.isTemporary && (
              <span className="text-xs text-muted-foreground italic">(preview)</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {skillInfo && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Skill actions"
                    className="h-8 w-8"
                    disabled={isSkillBusy}
                  >
                    <Package className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{skillInfo.skillName}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleDownloadSkill} disabled={isSkillBusy}>
                    <Download className="h-4 w-4" />
                    Download .skill
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleImportSkill} disabled={isSkillBusy}>
                    <Upload className="h-4 w-4" />
                    Import to Skills
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={downloadArtifact}
              title="Download artifact"
              className="h-8 w-8"
            >
              <Download className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close"
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Description (if available) */}
        {artifact.description && (
          <div className="px-4 pb-3">
            <p className="text-sm text-muted-foreground">{artifact.description}</p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="artifacts-content flex-1 overflow-hidden">
        {artifact.type === 'html' && (
          <HTMLArtifact content={artifact.content} title={artifact.title} />
        )}
        {artifact.type === 'svg' && (
          <SVGArtifact content={artifact.content} title={artifact.title} />
        )}
        {artifact.type === 'markdown' && (
          <MarkdownArtifact content={artifact.content} title={artifact.title} />
        )}
        {artifact.type === 'react' && (
          <ReactArtifact
            content={artifact.content}
            title={artifact.title}
            fileName={artifact.fileName}
          />
        )}
      </div>
    </div>
  )
}
