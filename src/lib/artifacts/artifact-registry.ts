export type ArtifactRegistryEntry = {
  filePath: string
  type: 'html' | 'svg' | 'markdown' | 'react'
  title?: string
  description?: string
  fileName?: string
  messageId?: string
  updatedAt: number
}

type RegistryResponse = {
  artifacts: ArtifactRegistryEntry[]
}

function encodeFilePath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export async function readWorkspaceFile(
  sessionId: string,
  filePath: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/workspace/${sessionId}/file/${encodeFilePath(filePath)}`
    )
    if (!response.ok) {
      return null
    }
    const data = await response.json()
    return typeof data.content === 'string' ? data.content : null
  } catch {
    return null
  }
}

export async function fetchArtifactRegistry(
  sessionId: string
): Promise<ArtifactRegistryEntry[]> {
  try {
    const response = await fetch(`/api/workspace/${sessionId}/artifacts`)
    if (!response.ok) {
      return []
    }
    const data = (await response.json()) as RegistryResponse
    return Array.isArray(data.artifacts) ? data.artifacts : []
  } catch {
    return []
  }
}

export async function saveArtifactRegistryEntry(
  sessionId: string,
  entry: ArtifactRegistryEntry
): Promise<void> {
  try {
    await fetch(`/api/workspace/${sessionId}/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    })
  } catch {
    // Best-effort persistence only.
  }
}

export async function writeWorkspaceFile(
  sessionId: string,
  filePath: string,
  content: string
): Promise<boolean> {
  try {
    const formData = new FormData()
    const fileName = filePath.split('/').pop() || 'artifact'
    const blob = new Blob([content], { type: 'text/plain' })
    formData.append('file', blob, fileName)
    formData.append('filePath', filePath)

    const response = await fetch(`/api/workspace/${sessionId}/files`, {
      method: 'POST',
      body: formData,
    })

    return response.ok
  } catch {
    return false
  }
}
