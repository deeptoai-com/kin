/**
 * Artifact Button Component
 *
 * Displays a prominent callout to view an artifact.
 * Shows in assistant messages when an artifact is detected.
 */

import { Eye, FileCode, FileImage, FileText, Braces, Table } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '~/components/ui/button'

export interface ArtifactButtonProps {
  onClick: () => void
  type: 'html' | 'svg' | 'markdown' | 'react' | 'image' | 'json' | 'csv'
  title?: string
  fileName?: string
  filePath?: string
  isTemporary?: boolean
}

const labelMap = {
  html: 'HTML',
  svg: 'SVG',
  markdown: 'Markdown',
  react: 'React',
  image: 'Image',
  json: 'JSON',
  csv: 'CSV',
} as const

const iconMap = {
  html: FileCode,
  svg: FileImage,
  markdown: FileText,
  react: FileCode,
  image: FileImage,
  json: Braces,
  csv: Table,
} as const

export const ArtifactButton: FC<ArtifactButtonProps> = ({
  onClick,
  type,
  title,
  fileName,
  filePath,
  isTemporary,
}) => {
  const label = labelMap[type]
  const Icon = iconMap[type]
  const displayName = title || fileName || filePath?.split('/').pop() || `${label} Artifact`
  const meta = fileName || filePath?.split('/').pop()

  return (
    <div className="mt-4 rounded-xl border bg-card/70 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{displayName}</div>
          <div className="text-xs text-muted-foreground">
            {label}
            {meta ? ` · ${meta}` : ''}
            {isTemporary ? ' · preview' : ''}
          </div>
        </div>

        <div className="ml-auto">
          <Button size="sm" onClick={onClick} className="gap-2">
            <Eye className="h-4 w-4" />
            Open Artifact
          </Button>
        </div>
      </div>
    </div>
  )
}
