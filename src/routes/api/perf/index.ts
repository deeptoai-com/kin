/**
 * Perf API (P2 observability)
 *
 * POST /api/perf — record runtime performance samples (internal use by the WS
 * server, mirroring /api/usage and /api/audit). Fire-and-forget on the caller
 * side; the acting user is taken from the cookie, not the body.
 *
 * Body: { samples: PerfSampleInput[] }. Values are numeric + low-cardinality
 * dimensions only — never conversation content.
 */

import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { recordPerfSamples, type PerfSampleInput } from '~/server/perf';

export const Route = createFileRoute('/api/perf/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser(request);

        let body: { samples?: PerfSampleInput[] };
        try {
          body = (await request.json()) as { samples?: PerfSampleInput[] };
        } catch {
          return Response.json({ recorded: 0, error: 'invalid json' }, { status: 400 });
        }

        const samples = Array.isArray(body.samples) ? body.samples : [];
        // Force the server-trusted actor; ignore any userId in the body.
        const stamped = samples.map((s) => ({ ...s, userId: user.id }));
        const recorded = await recordPerfSamples(stamped);

        return Response.json({ recorded });
      },
    },
  },
});
