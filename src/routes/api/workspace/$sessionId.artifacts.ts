/**
 * Workspace Artifacts Registry API
 *
 * GET /api/workspace/:sessionId/artifacts - Read artifact registry
 * POST /api/workspace/:sessionId/artifacts - Upsert artifact registry entry
 */

import { createFileRoute } from '@tanstack/react-router';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '~/server/require-user';
import { getWorkspaceSession } from '~/server/workspace-session';

type RegistryEntry = {
  filePath: string;
  type: 'html' | 'svg' | 'markdown' | 'react';
  title?: string;
  description?: string;
  fileName?: string;
  messageId?: string;
  updatedAt?: number;
};

type RegistryPayload = {
  artifacts: RegistryEntry[];
};

const REGISTRY_FILENAME = '.artifacts.json';

function validateFilePath(filePath: string): boolean {
  if (filePath.includes('..') || filePath.includes('~') || path.isAbsolute(filePath)) {
    return false;
  }

  const normalized = path.normalize(filePath);
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
    return false;
  }

  return true;
}

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
        const payload = (await request.json()) as RegistryEntry | null;

        if (!payload || !payload.filePath) {
          return new Response(
            JSON.stringify({ error: 'Missing artifact entry' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }

        if (!validateFilePath(payload.filePath)) {
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

        const nextEntry: RegistryEntry = {
          filePath: payload.filePath,
          type: payload.type,
          title: payload.title,
          description: payload.description,
          fileName: payload.fileName,
          messageId: payload.messageId,
          updatedAt,
        };

        const existingIndex = registry.artifacts.findIndex(
          (entry) => entry.filePath === payload.filePath
        );
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
