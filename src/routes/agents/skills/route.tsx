import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Legacy route — Skills moved into the unified Capability Center.
 * Redirect to /agents/capabilities with the Skills tab preselected.
 */
export const Route = createFileRoute('/agents/skills')({
  beforeLoad: () => {
    throw redirect({ to: '/agents/capabilities', search: { tab: 'skills' } });
  },
});
