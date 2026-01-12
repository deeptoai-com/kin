/**
 * Artifact Detection Hook
 *
 * Detects artifacts in message content and creates them in the store.
 * Supports hybrid detection mode:
 * 1. Phase 1 (Heuristic): Text code blocks + Tool-call content (immediate preview, marked as temporary)
 * 2. Phase 2 (Structured Outputs): Metadata from AI (overwrites temporary with complete info)
 */

import { useEffect, useRef } from 'react'
import { detectArtifact } from '~/lib/utils/artifact-detector'
import { useArtifactsStore } from '~/lib/stores/artifacts-store'
import { useChatSessionStore } from '~/lib/chat-session-store'
import { validateArtifactMetadata, type ArtifactMetadata } from '~/lib/schemas/artifact-schema'
import {
  readWorkspaceFile,
  saveArtifactRegistryEntry,
  type ArtifactRegistryEntry,
} from '~/lib/artifacts/artifact-registry'

// Import the proper type from chat-session-store
import type { ContentPart } from '~/lib/chat-session-store'

/**
 * Detect artifact from tool-call content
 * Looks for Write tool calls with .html, .svg, .md, .jsx, or .tsx files
 */
type ArtifactType = 'html' | 'svg' | 'markdown' | 'react'

type ArtifactTarget = {
  filePath: string
  type: ArtifactType
  fileName: string
  toolCallId: string
}

const ARTIFACT_EXTENSIONS: Array<{ ext: string; type: ArtifactType }> = [
  { ext: '.html', type: 'html' },
  { ext: '.htm', type: 'html' },
  { ext: '.svg', type: 'svg' },
  { ext: '.md', type: 'markdown' },
  { ext: '.markdown', type: 'markdown' },
  { ext: '.jsx', type: 'react' },
  { ext: '.tsx', type: 'react' },
  { ext: '.js', type: 'react' },
  { ext: '.ts', type: 'react' },
]

function resolveArtifactTarget(filePath: string, toolCallId: string): ArtifactTarget | null {
  const lower = filePath.toLowerCase()
  const match = ARTIFACT_EXTENSIONS.find((entry) => lower.endsWith(entry.ext))
  if (!match) return null
  const fileName = filePath.split('/').pop() || filePath
  return {
    filePath,
    type: match.type,
    fileName,
    toolCallId,
  }
}

function extractArtifactTargets(
  content: ContentPart[],
  options: { requireResult?: boolean } = {}
): ArtifactTarget[] {
  const targets: ArtifactTarget[] = []
  const requireResult = options.requireResult ?? true

  for (const part of content) {
    if (part.type !== 'tool-call' || !part.args) continue
    if (part.toolName !== 'Write' && part.toolName !== 'Edit') continue
    if (requireResult && part.result === undefined) continue

    const filePath = (part.args.file_path || part.args.path) as string | undefined
    if (!filePath) continue

    const target = resolveArtifactTarget(filePath, part.toolCallId)
    if (target) targets.push(target)
  }

  return targets
}

/**
 * Hook to detect and create artifacts from message content
 * Implements hybrid detection mode:
 * - Phase 1: Heuristic detection (immediate preview, temporary)
 * - Phase 2: Structured Outputs (complete metadata, overrides temporary)
 *
 * @param messageId - Message ID
 * @param content - Message content array (text, tool-call, etc.)
 * @returns Artifact if detected, null otherwise
 */
export function useArtifactDetection(messageId: string, content: ContentPart[] | undefined) {
  const sessionId = useChatSessionStore((state) => state.currentSessionId)
  const createArtifact = useArtifactsStore((state) => state.createArtifact)
  const updateArtifact = useArtifactsStore((state) => state.updateArtifact)
  const setActiveArtifact = useArtifactsStore((state) => state.setActiveArtifact)
  const getArtifactByFilePath = useArtifactsStore((state) => state.getArtifactByFilePath)
  const artifact = useArtifactsStore((state) => state.getArtifactByMessageId(messageId))
  const lastStructuredOutput = useChatSessionStore((state) => state.lastStructuredOutput)
  const processedToolCallsRef = useRef<Set<string>>(new Set())

  // Phase 1: Heuristic Detection (Real-time Preview)
  useEffect(() => {
    if (!content || content.length === 0) return

    // ✅ FIX: Only detect artifacts from completed tool calls (with result)
    // This prevents rendering loops caused by detecting incomplete tool-use events
    const toolTargets = extractArtifactTargets(content, { requireResult: true })

    if (toolTargets.length > 0) {
      const pending = toolTargets.filter((target) => {
        if (processedToolCallsRef.current.has(target.toolCallId)) {
          return false
        }
        processedToolCallsRef.current.add(target.toolCallId)
        return true
      })

      if (pending.length === 0) {
        return
      }

      let isCancelled = false
      const run = async () => {
        for (const target of pending) {
          try {
            const fileContent = sessionId
              ? await readWorkspaceFile(sessionId, target.filePath)
              : null

            const contentToUse = fileContent
            if (!contentToUse) {
              console.warn('[Artifact Detection] Failed to read workspace file:', target.filePath)
              continue
            }

            const existing = sessionId
              ? getArtifactByFilePath(sessionId, target.filePath)
              : undefined

            if (isCancelled) return

            let artifactId: string

            if (existing) {
              updateArtifact(existing.id, {
                content: contentToUse,
                type: target.type,
                fileName: target.fileName,
                messageId,
                isTemporary: false,
              })
              artifactId = existing.id
            } else {
              artifactId = createArtifact({
                sessionId: sessionId || 'unknown',
                sourceFilePath: target.filePath,
                messageId,
                type: target.type,
                content: contentToUse,
                fileName: target.fileName,
                isTemporary: false,
              })
            }

            setActiveArtifact(artifactId)
            console.log('[Artifact Detection] Updated artifact from tool call:', target.filePath)

            if (sessionId) {
              const registryEntry: ArtifactRegistryEntry = {
                filePath: target.filePath,
                type: target.type,
                fileName: target.fileName,
                messageId,
                updatedAt: Date.now(),
              }
              await saveArtifactRegistryEntry(sessionId, registryEntry)
            }
          } catch (error) {
            console.error('[Artifact Detection] Failed to update artifact:', error)
          }
        }
      }

      run()

      return () => {
        isCancelled = true
      }
    }

    // Map existing artifacts to this message using file path (for historical sessions)
    const linkTargets = extractArtifactTargets(content, { requireResult: false })
    if (linkTargets.length > 0 && sessionId) {
      let isCancelled = false
      const runLink = async () => {
        for (const target of linkTargets) {
          const existing = getArtifactByFilePath(sessionId, target.filePath)
          if (existing) {
            if (existing.messageId !== messageId) {
              updateArtifact(existing.id, {
                messageId,
                fileName: existing.fileName || target.fileName,
              })
            }
            continue
          }

          const fileContent = await readWorkspaceFile(sessionId, target.filePath)
          if (!fileContent || isCancelled) {
            continue
          }

          createArtifact({
            sessionId,
            sourceFilePath: target.filePath,
            messageId,
            type: target.type,
            content: fileContent,
            fileName: target.fileName,
            isTemporary: false,
          })

          await saveArtifactRegistryEntry(sessionId, {
            filePath: target.filePath,
            type: target.type,
            fileName: target.fileName,
            messageId,
            updatedAt: Date.now(),
          })
        }
      }

      runLink()

      return () => {
        isCancelled = true
      }
    }

    // Method 2: Check text content for code blocks (fallback)
    const textContent = content.find((p) => p.type === 'text')?.text
    if (!textContent) return

    const detected = detectArtifact(textContent)

    // Create artifact if detected
    if (detected && detected.type !== 'unknown') {
      const artifactContent = detected.type === 'html' ? detected.html! : detected.svg!

      if (artifact) return

      // Create new temporary artifact
      const artifactId = createArtifact({
        sessionId: sessionId || 'unknown',
        messageId,
        type: detected.type,
        content: artifactContent,
        isTemporary: true, // Mark as temporary
      })
      // Auto-open the artifact panel
      setActiveArtifact(artifactId)
    }
  }, [
    messageId,
    content,
    sessionId,
    createArtifact,
    updateArtifact,
    setActiveArtifact,
    getArtifactByFilePath,
    artifact,
  ])

  // Phase 2: Structured Outputs (Complete Metadata)
  useEffect(() => {
    // Skip if no structured output
    if (!lastStructuredOutput) return

    // Validate structured output against schema
    const metadata = validateArtifactMetadata(lastStructuredOutput)
    if (!metadata) {
      console.warn('[Artifact Detection] Invalid structured output:', lastStructuredOutput)
      return
    }

    console.log('[Artifact Detection] Received structured output:', metadata)

    // Get primary file content (first file or combined HTML)
    const primaryContent = getPrimaryContent(metadata)
    if (!primaryContent) {
      console.warn('[Artifact Detection] No primary content in structured output')
      return
    }

    const primaryFilePath = metadata.files[0]?.path

    if (!primaryFilePath || !sessionId) {
      return
    }

    const existing = getArtifactByFilePath(sessionId, primaryFilePath)
    if (!existing || existing.messageId !== messageId) {
      return
    }

    const run = async () => {
      try {
        updateArtifact(existing.id, {
          title: metadata.title,
          description: metadata.description,
          type: metadata.type,
          content: primaryContent,
          fileName: metadata.files[0]?.path,
          isTemporary: false,
        })
        console.log('[Artifact Detection] Updated artifact metadata from structured output')

        const fileName = metadata.files[0]?.path?.split('/').pop() || metadata.files[0]?.path
        await saveArtifactRegistryEntry(sessionId, {
          filePath: primaryFilePath,
          type: metadata.type,
          title: metadata.title,
          description: metadata.description,
          fileName,
          messageId,
          updatedAt: Date.now(),
        })
      } catch (error) {
        console.error('[Artifact Detection] Failed to persist metadata:', error)
      }
    }

    run()
  }, [
    lastStructuredOutput,
    messageId,
    sessionId,
    getArtifactByFilePath,
    updateArtifact,
  ])

  return artifact
}

/**
 * Extract primary content from structured output
 * For single file: return first file content
 * For multi-file HTML: combine into single HTML document
 */
function getPrimaryContent(metadata: ArtifactMetadata): string | null {
  if (metadata.files.length === 0) return null

  // For single file, return content directly
  if (metadata.files.length === 1) {
    return metadata.files[0].content
  }

  // For HTML with multiple files, combine them
  if (metadata.type === 'html') {
    const htmlFile = metadata.files.find((f) => f.language === 'html')
    const cssFiles = metadata.files.filter((f) => f.language === 'css')
    const jsFiles = metadata.files.filter((f) => f.language === 'javascript')

    if (!htmlFile) return metadata.files[0].content

    let combined = htmlFile.content

    // Inject CSS
    if (cssFiles.length > 0) {
      const cssContent = cssFiles.map((f) => f.content).join('\n')
      const styleTag = `<style>\n${cssContent}\n</style>`

      // Try to inject before </head>, fallback to before </body>
      if (combined.includes('</head>')) {
        combined = combined.replace('</head>', `${styleTag}\n</head>`)
      } else if (combined.includes('</body>')) {
        combined = combined.replace('</body>', `${styleTag}\n</body>`)
      } else {
        combined = styleTag + '\n' + combined
      }
    }

    // Inject JS
    if (jsFiles.length > 0) {
      const jsContent = jsFiles.map((f) => f.content).join('\n')
      const scriptTag = `<script>\n${jsContent}\n</script>`

      // Inject before </body>, fallback to end
      if (combined.includes('</body>')) {
        combined = combined.replace('</body>', `${scriptTag}\n</body>`)
      } else {
        combined = combined + '\n' + scriptTag
      }
    }

    return combined
  }

  // For React/other types, return first file
  return metadata.files[0].content
}
