/**
 * Artifacts Panel
 *
 * Main panel component for displaying and interacting with artifacts.
 */

import JSZip from 'jszip'
import { Download, Package, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState, type FC } from 'react'
import { useIntlayer } from 'react-intlayer'
import { toLocalizedString } from '~/lib/utils'
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
import { ImageArtifact } from './artifact-image'
import { JSONArtifact } from './artifact-json'
import { CSVArtifact } from './artifact-csv'

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
  const content = useIntlayer('claude-chat')
  const artifact = useArtifactsStore((state) => {
    if (!artifactId) return null
    return state.getArtifactById(artifactId)
  })
  const [isSkillBusy, setIsSkillBusy] = useState(false)
  const [isExportingPng, setIsExportingPng] = useState(false)
  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null)
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
      toast.error(toLocalizedString(content.artifactsPanel.toast.sessionUnavailable))
      return []
    }

    const fallbackFile = getFallbackSkillFile()
    const listResponse = await fetch(`/api/workspace/${artifact.sessionId}/files`)
    if (!listResponse.ok) {
      if (fallbackFile) {
        toast.message(toLocalizedString(content.artifactsPanel.toast.workspaceUnavailable))
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
      toast.message(toLocalizedString(content.artifactsPanel.toast.noFilesFound))
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
      toast.error(toLocalizedString(content.artifactsPanel.toast.noSkillFiles))
      return false
    }
    if (files.length > 100) {
      toast.error(toLocalizedString(content.artifactsPanel.toast.tooManyFiles))
      return false
    }
    const totalSize = files.reduce((sum, file) => sum + file.content.length, 0)
    if (totalSize > 10 * 1024 * 1024) {
      toast.error(toLocalizedString(content.artifactsPanel.toast.sizeLimitExceeded))
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
      toast.success(toLocalizedString(content.artifactsPanel.toast.exportSuccess).replace('{name}', skillInfo.skillName))
    } catch (error) {
      console.error('Failed to package skill:', error)
      toast.error(toLocalizedString(content.artifactsPanel.toast.exportFailed))
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
      toast.success(toLocalizedString(content.artifactsPanel.toast.importSuccess).replace('{name}', skillInfo.skillName))
    } catch (error) {
      console.error('Failed to import skill:', error)
      toast.error(toLocalizedString(content.artifactsPanel.toast.importFailed))
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
      image: artifact.mimeType || 'image/png',
      json: 'application/json;charset=utf-8',
      csv: 'text/csv;charset=utf-8',
    } as const

    const extensionMap = {
      html: 'html',
      svg: 'svg',
      markdown: 'md',
      react: artifact.fileName?.split('.').pop() || 'jsx',
      image: artifact.mimeType?.split('/')[1] || 'png',
      json: 'json',
      csv: 'csv',
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

  const fileName =
    artifact.fileName ||
    (artifact.sourceFilePath ? artifact.sourceFilePath.split('/').pop() : undefined)
  const fileStem = fileName ? fileName.replace(/\.[^.]+$/, '') : undefined
  const typeTitleMap = content.artifactsPanel.typeTitle as Record<string, unknown>
  const typeTitleEntry = typeTitleMap?.[artifact.type]
  const typeTitle = typeTitleEntry ? toLocalizedString(typeTitleEntry) : artifact.type.toUpperCase()
  const headerTitle = fileStem ? `${typeTitle} (${fileStem})` : typeTitle
  const updatedAt = new Date(artifact.updatedAt)
  const formattedUpdatedAt = `${updatedAt.getFullYear()}/${String(
    updatedAt.getMonth() + 1
  ).padStart(2, '0')}/${String(updatedAt.getDate()).padStart(2, '0')} ${String(
    updatedAt.getHours()
  ).padStart(2, '0')}:${String(updatedAt.getMinutes()).padStart(2, '0')}`
  const updatedLabel = toLocalizedString(content.artifactsPanel.updated)
  const updatedText = updatedLabel
    .replace('{time}', formattedUpdatedAt)
    .replace(/:\s+/, ':')
  const isHtmlArtifact = artifact.type === 'html'

  const exportHtmlAsPng = async () => {
    if (!isHtmlArtifact || isExportingPng) return
    setIsExportingPng(true)
    try {
      const iframe = htmlIframeRef.current
      const width = Math.round(iframe?.clientWidth || 1280)
      const height = Math.round(iframe?.clientHeight || 720)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : undefined

      const response = await fetch('/api/artifacts/render-png', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          html: artifact.content,
          width,
          height,
          baseUrl,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Failed to export PNG')
      }

      const pngBlob = await response.blob()
      const baseName =
        fileStem || artifact.title || `artifact-${artifact.id.slice(0, 8)}`
      const url = URL.createObjectURL(pngBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(toLocalizedString(content.artifactsPanel.toast.pngExportSuccess))
    } catch (error) {
      console.error('Failed to export HTML to PNG:', error)
      toast.error(toLocalizedString(content.artifactsPanel.toast.pngExportFailed))
    } finally {
      setIsExportingPng(false)
    }
  }

  return (
    <div className="artifacts-panel h-full w-full flex flex-col border-l bg-background">
      {/* Header */}
      <div className="artifacts-header flex flex-col border-b bg-muted/30">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2 gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
            <span className="text-sm font-medium truncate">{headerTitle}</span>
            {artifact.isTemporary && (
              <span className="text-xs text-muted-foreground italic">{content.artifactsPanel.preview}</span>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {updatedText}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {skillInfo && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={toLocalizedString(content.artifactsPanel.skillActions)}
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
                    {content.artifactsPanel.downloadSkill}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleImportSkill} disabled={isSkillBusy}>
                    <Upload className="h-4 w-4" />
                    {content.artifactsPanel.importToSkills}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isHtmlArtifact ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={toLocalizedString(content.artifactsPanel.downloadArtifact)}
                    className="h-8 w-8"
                    disabled={isExportingPng}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={downloadArtifact} disabled={isExportingPng}>
                    <Download className="h-4 w-4" />
                    {content.artifactsPanel.downloadHtml}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={exportHtmlAsPng} disabled={isExportingPng}>
                    <Download className="h-4 w-4" />
                    {content.artifactsPanel.exportPng}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={downloadArtifact}
                title={toLocalizedString(content.artifactsPanel.downloadArtifact)}
                className="h-8 w-8"
              >
                <Download className="h-4 w-4" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title={toLocalizedString(content.artifactsPanel.close)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="artifacts-content flex-1 overflow-hidden">
        {artifact.type === 'html' && (
          <HTMLArtifact
            content={artifact.content}
            title={artifact.title}
            iframeRef={htmlIframeRef}
          />
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
        {artifact.type === 'image' && (
          <ImageArtifact
            content={artifact.content}
            title={artifact.title}
            mimeType={artifact.mimeType}
          />
        )}
        {artifact.type === 'json' && (
          <JSONArtifact content={artifact.content} title={artifact.title} />
        )}
        {artifact.type === 'csv' && (
          <CSVArtifact content={artifact.content} title={artifact.title} />
        )}
      </div>
    </div>
  )
}
