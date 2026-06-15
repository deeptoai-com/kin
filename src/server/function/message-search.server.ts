/**
 * Conversation search — message full-text search server function (Kin, FR4/FR5).
 *
 * Ordinary-user feature: requireUser() + server-side access isolation. Results are scoped to
 * (userId = me) OR (projectId IN my accessible projects), using the SAME source as
 * visibleSessionsWhere (accessibleProjectIds) so the isolation can't drift. The frontend is
 * NOT trusted to filter. Meili failure degrades gracefully (degraded:true, empty results).
 *
 * Spec §3.4 / §4.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireUser } from '~/server/require-user';
import { accessibleProjectIds } from '~/server/projects/access';
import { searchMessages } from '~/search/meilisearch';

const inputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  projectId: z.string().optional(),
  role: z.enum(['user', 'assistant']).optional(),
});

export interface MessageSearchResult {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  snippet: string;
  createdAt: number;
  title: string;
  projectId: string | null;
}

export const searchMessagesFn = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => {
    // Match the repo's {data}-envelope-unwrapping validator convention.
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data =
      payload && typeof payload === 'object' && 'data' in payload ? (payload as { data?: unknown }).data : payload;
    return inputSchema.parse(data);
  })
  .handler(async ({ data }): Promise<{ degraded: boolean; results: MessageSearchResult[] }> => {
    const user = await requireUser(getRequest() as Request);
    const projectIds = await accessibleProjectIds(user.id);

    try {
      const hits = await searchMessages(
        data.query,
        { userId: user.id, projectIds, projectId: data.projectId, role: data.role },
        data.limit ?? 20,
      );
      const results: MessageSearchResult[] = hits.map((h) => ({
        sessionId: h.sessionId,
        messageId: h.messageId,
        role: h.role,
        snippet: h._formatted?.text ?? h.text ?? '',
        createdAt: h.createdAt,
        title: h.title,
        projectId: h.projectId ?? null,
      }));
      return { degraded: false, results };
    } catch {
      // Meili down / index missing — keep the app usable (title search still works client-side).
      return { degraded: true, results: [] };
    }
  });
