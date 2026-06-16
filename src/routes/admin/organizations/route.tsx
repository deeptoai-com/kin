/**
 * Admin Organizations — removed.
 *
 * Kin serves a single organization; multi-tenant organization management was
 * removed (Admin observability PRD §13 D1). This route now redirects any stale
 * link or bookmark to the admin overview.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/organizations')({
  beforeLoad: () => {
    throw redirect({ to: '/admin' });
  },
});
