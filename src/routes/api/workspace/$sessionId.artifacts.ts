/**
 * Workspace Artifacts Registry API
 *
 * GET /api/workspace/:sessionId/artifacts - Read artifact registry
 * POST /api/workspace/:sessionId/artifacts - Upsert artifact registry entry
 *
 * P16: Lightweight version recording
 * - Tracks last N versions per artifact with content hash
 * - Maximum 10 versions per artifact
 */

import { createFileRoute } from '@tanstack/react-router';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';
import { validateRelativePath } from '~/server/security/validate-relative-path';

// P16: Version tracking types
type ArtifactVersion = {
  hash: string;
  messageId?: string;
  timestamp: number;
  size: number;
};

type RegistryEntry = {
  filePath: string;
  type: 'html' | 'svg' | 'markdown' | 'react' | 'image' | 'json' | 'csv';
  title?: string;
  description?: string;
  fileName?: string;
  messageId?: string;
  updatedAt?: number;
  // P14: Tool-to-Artifact Lineage (persisted)
  toolCallId?: string;
  toolName?: string;
  // P16: Version tracking fields
  currentHash?: string;
  versions?: ArtifactVersion[];
};

// Extended entry with content size for version recording
type RegistryEntryWithMeta = RegistryEntry & {
  _contentSize?: number;
};

type RegistryPayload = {
  artifacts: RegistryEntry[];
};

const REGISTRY_FILENAME = '.artifacts.json';
const MAX_VERSIONS = 10; // P16: Maximum versions to keep per artifact

/**
 * P16: Feature flag for version recording (EXPERIMENTAL - PAUSED)
 * Set to true to enable artifact version tracking
 * Default: false (disabled until further notice)
 * Keep in sync with frontend flag in artifact-registry.ts
 */
const ENABLE_VERSION_RECORDING = false;

async function readRegistry(workspacePath: string): Promise<RegistryPayload> {
  const registryPath = path.join(workspacePath, REGISTRY_FILENAME);
  try {
    const raw = await readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as RegistryPayload;
    if (!parsed || !Array.isArray(parsed.artifacts)) {
      return { artifacts: [] };
    }
    return parsed;
  } catch {
    return { artifacts: [] };
  }
}

async function writeRegistry(workspacePath: string, payload: RegistryPayload): Promise<void> {
  const registryPath = path.join(workspacePath, REGISTRY_FILENAME);
  await mkdir(workspacePath, { recursive: true });
  await writeFile(registryPath, JSON.stringify(payload, null, 2), 'utf8');
}

export const Route = createFileRoute('/api/workspace/$sessionId/artifacts')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId } = params;

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );

        const registry = await readRegistry(workspacePath);

        return Response.json({
          sessionId: session.id,
          artifacts: registry.artifacts,
        });
      },
      POST: async ({ request, params }) => {
        const user = await requireUser(request);
        const { sessionId } = params;
        const payload = (await request.json()) as RegistryEntryWithMeta | null;

        if (!payload || !payload.filePath) {
          return new Response(
            JSON.stringify({ error: 'Missing artifact entry' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        if (!validateRelativePath(payload.filePath)) {
          return new Response(
            JSON.stringify({ error: 'Invalid file path' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        const session = await getWorkspaceSession(user.id, sessionId);

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          );
        }

        const workspacePath = path.join(
          session.claudeHomePath,
          'sessions',
          session.sdkSessionId,
          'workspace'
        );

        const registry = await readRegistry(workspacePath);
        const updatedAt = payload.updatedAt ?? Date.now();

        // P16: Extract metadata fields (not persisted)
        const { _contentSize, currentHash, ...cleanPayload } = payload;

        const nextEntry: RegistryEntry = {
          filePath: cleanPayload.filePath,
          type: cleanPayload.type,
          title: cleanPayload.title,
          description: cleanPayload.description,
          fileName: cleanPayload.fileName,
          messageId: cleanPayload.messageId,
          updatedAt,
          // P14: Persist lineage
          toolCallId: cleanPayload.toolCallId,
          toolName: cleanPayload.toolName,
          // P16: Store current hash only if version recording is enabled
          ...(ENABLE_VERSION_RECORDING && { currentHash }),
        };

        const existingIndex = registry.artifacts.findIndex(
          (entry) => entry.filePath === payload.filePath
        );

        // P16: Version tracking (PAUSED - only runs if ENABLE_VERSION_RECORDING is true)
        if (ENABLE_VERSION_RECORDING && currentHash) {
          const existingEntry = existingIndex >= 0 ? registry.artifacts[existingIndex] : null;
          const existingVersions = existingEntry?.versions || [];

          // Only add version if hash changed
          if (!existingEntry || existingEntry.currentHash !== currentHash) {
            const newVersion: ArtifactVersion = {
              hash: currentHash,
              messageId: payload.messageId,
              timestamp: updatedAt,
              size: _contentSize || 0,
            };

            // Prepend new version and keep only MAX_VERSIONS
            nextEntry.versions = [newVersion, ...existingVersions].slice(0, MAX_VERSIONS);
          } else {
            // Hash unchanged, preserve existing versions
            nextEntry.versions = existingVersions;
          }
        }

        if (existingIndex >= 0) {
          registry.artifacts[existingIndex] = {
            ...registry.artifacts[existingIndex],
            ...nextEntry,
          };
        } else {
          registry.artifacts.push(nextEntry);
        }

        await writeRegistry(workspacePath, registry);

        return Response.json({ ok: true });
      },
    },
  },
});
