/**
 * P16: Lightweight version recording
 * Stores last N versions with content hash for basic version tracking
 */
export type ArtifactVersion = {
  hash: string // Content hash (first 8 chars of SHA-256)
  messageId?: string // Associated message ID
  timestamp: number // When this version was created
  size: number // Content size in bytes
}

export type ArtifactRegistryEntry = {
  filePath: string
  type: 'html' | 'svg' | 'markdown' | 'react' | 'image' | 'json' | 'csv'
  title?: string
  description?: string
  fileName?: string
  messageId?: string
  updatedAt: number
  // P14: Tool-to-Artifact Lineage (persisted)
  toolCallId?: string
  toolName?: string
  // P16: Version tracking
  currentHash?: string // Hash of current content
  versions?: ArtifactVersion[] // Last N versions (max 10)
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

/**
 * P16: Compute short content hash using Web Crypto API
 * Returns first 8 characters of SHA-256 hash
 */
async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex.slice(0, 8) // First 8 chars for brevity
}

const MAX_VERSIONS = 10 // P16: Maximum versions to keep per artifact

/**
 * P16: Feature flag for version recording (EXPERIMENTAL - PAUSED)
 * Set to true to enable artifact version tracking
 * Default: false (disabled until further notice)
 */
const ENABLE_VERSION_RECORDING = false

export async function readWorkspaceFile(
  sessionId: string,
  filePath: string
): Promise<string | null> {
  try {
    // P12 fix: Use workspace API for artifact files (stored in workspace/ subdirectory)
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

/**
 * P15: Read binary file as base64 (for images)
 * Uses workspace API with ?raw=1 and converts buffer to base64 data URL
 * Returns base64-encoded data URL or null
 */
export async function readWorkspaceBinaryFile(
  sessionId: string,
  filePath: string,
  mimeType: string = 'image/png'
): Promise<string | null> {
  try {
    // Use workspace API (artifacts are in workspace/ subdirectory)
    const response = await fetch(
      `/api/workspace/${sessionId}/file/${encodeFilePath(filePath)}?raw=1`
    )
    if (!response.ok) {
      return null
    }
    // Get raw buffer and convert to base64 data URL
    const buffer = await response.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    return `data:${mimeType};base64,${base64}`
  } catch {
    return null
  }
}

/**
 * P15: Detect if a file path indicates a binary image
 */
function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop()
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']
  return imageExts.includes(ext || '')
}

/**
 * P15: Get MIME type from file extension
 */
export function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    json: 'application/json',
    csv: 'text/csv',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
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

/**
 * Save artifact registry entry with optional version tracking
 * @param sessionId - Session ID
 * @param entry - Registry entry metadata
 * @param content - Optional content for computing hash and version tracking (P16 - PAUSED)
 */
export async function saveArtifactRegistryEntry(
  sessionId: string,
  entry: ArtifactRegistryEntry,
  content?: string
): Promise<void> {
  try {
    // P16: Version recording is PAUSED - skip hash computation unless enabled
    let entryWithHash = { ...entry }
    if (content && ENABLE_VERSION_RECORDING) {
      const hash = await computeContentHash(content)
      entryWithHash = {
        ...entry,
        currentHash: hash,
        // Version info will be added server-side to avoid race conditions
        _contentSize: content.length, // Pass size for version record
      } as ArtifactRegistryEntry & { _contentSize?: number }
    }

    await fetch(`/api/workspace/${sessionId}/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entryWithHash),
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
