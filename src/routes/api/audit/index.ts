/**
 * Audit API (P2-2)
 *
 * POST /api/audit - Append a security-relevant audit event (internal use by the
 * WS server, which authenticates as the acting user via cookie).
 *
 * The userId is taken from the authenticated session, NOT from the body, so a
 * caller cannot forge another user's audit trail. action/target/meta come from
 * the body; ip is derived from x-forwarded-for.
 */

import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '~/server/require-user';
import { recordAudit } from '~/server/audit';
import { clientIpFromForwardedFor } from '~/server/audit/build-audit-row';

type AuditBody = {
  action?: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
};

export const Route = createFileRoute('/api/audit/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser(request);

        const body = (await request.json()) as AuditBody;
        if (!body.action || typeof body.action !== 'string') {
          return Response.json({ error: 'action is required' }, { status: 400 });
        }

        await recordAudit({
          userId: user.id,
          action: body.action,
          target: body.target ?? null,
          meta: body.meta ?? {},
          ip: clientIpFromForwardedFor(request.headers.get('x-forwarded-for')),
        });

        return Response.json({ ok: true });
      },
    },
  },
});
