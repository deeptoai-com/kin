/**
 * Artifacts Store
 *
 * Manages artifact state for the application.
 * Stores artifacts by message ID for easy retrieval and display.
 */

import { create } from 'zustand'

export interface Artifact {
  id: string
  sessionId: string
  messageId?: string
  sourceFilePath?: string
  type: 'html' | 'svg' | 'markdown' | 'react'
  title?: string
  description?: string // Description of what the artifact does
  fileName?: string // File name for React artifacts (e.g., "App.jsx")
  content: string // Complete HTML, SVG, Markdown, or React code
  isTemporary?: boolean // True if created by heuristic detection, false if from Structured Outputs
  createdAt: number
  updatedAt: number
}

export interface ArtifactsState {
  // Map of artifactId -> Artifact
  artifacts: Map<string, Artifact>

  // Currently active artifact ID (for display in panel)
  activeArtifactId: string | null

  // Actions
  createArtifact: (artifact: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateArtifact: (id: string, updates: Partial<Omit<Artifact, 'id'>>) => void
  deleteArtifact: (id: string) => void
  setActiveArtifact: (id: string | null) => void
  getArtifactByMessageId: (messageId: string) => Artifact | undefined
  getArtifactByFilePath: (sessionId: string, filePath: string) => Artifact | undefined
  getArtifactById: (id: string) => Artifact | undefined
  clearAll: () => void
}

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  artifacts: new Map(),
  activeArtifactId: null,

  /**
   * Create a new artifact
   *
   * @param artifact - Artifact data (without id, createdAt, updatedAt)
   * @returns Created artifact ID
   */
  createArtifact: (artifact) => {
    const id = crypto.randomUUID()
    const now = Date.now()

    const newArtifact: Artifact = {
      ...artifact,
      id,
      createdAt: now,
      updatedAt: now,
    }

    set((state) => {
      const newArtifacts = new Map(state.artifacts)
      newArtifacts.set(newArtifact.id, newArtifact)
      return { artifacts: newArtifacts }
    })

    return id
  },

  /**
   * Update an existing artifact
   *
   * @param id - Artifact ID
   * @param updates - Partial artifact data to update
   */
  updateArtifact: (id, updates) => {
    set((state) => {
      const artifact = Array.from(state.artifacts.values()).find((a) => a.id === id)

      if (!artifact) {
        console.warn(`Artifact with id ${id} not found`)
        return state
      }

      const updated: Artifact = {
        ...artifact,
        ...updates,
        id: artifact.id, // Prevent id change
        updatedAt: Date.now(),
      }

      const newArtifacts = new Map(state.artifacts)
      newArtifacts.set(artifact.id, updated)

      return { artifacts: newArtifacts }
    })
  },

  /**
   * Delete an artifact
   *
   * @param id - Artifact ID to delete
   */
  deleteArtifact: (id) => {
    set((state) => {
      if (!state.artifacts.has(id)) {
        console.warn(`Artifact with id ${id} not found`)
        return state
      }

      const newArtifacts = new Map(state.artifacts)
      newArtifacts.delete(id)

      return {
        artifacts: newArtifacts,
        activeArtifactId: state.activeArtifactId === id ? null : state.activeArtifactId,
      }
    })
  },

  /**
   * Set the currently active artifact for display
   *
   * @param id - Artifact ID to set as active, or null to clear
   */
  setActiveArtifact: (id) => {
    set({ activeArtifactId: id })
  },

  /**
   * Get artifact by message ID
   *
   * @param messageId - Message ID
   * @returns Artifact or undefined if not found
   */
  getArtifactByMessageId: (messageId) => {
    return Array.from(get().artifacts.values()).find((artifact) => artifact.messageId === messageId)
  },

  /**
   * Get artifact by session + file path
   *
   * @param sessionId - Session ID
   * @param filePath - Artifact source file path
   * @returns Artifact or undefined if not found
   */
  getArtifactByFilePath: (sessionId, filePath) => {
    return Array.from(get().artifacts.values()).find(
      (artifact) => artifact.sessionId === sessionId && artifact.sourceFilePath === filePath
    )
  },

  /**
   * Get artifact by artifact ID
   *
   * @param id - Artifact ID
   * @returns Artifact or undefined if not found
   */
  getArtifactById: (id) => {
    return get().artifacts.get(id)
  },

  /**
   * Clear all artifacts
   */
  clearAll: () => {
    set({
      artifacts: new Map(),
      activeArtifactId: null,
    })
  },
}))
