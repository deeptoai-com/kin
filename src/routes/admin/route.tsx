import { createFileRoute, useRouterState } from '@tanstack/react-router';
import { AdminLayout } from '~/components/admin/AdminLayout';
import { requireSystemAdmin } from '~/server/admin.server';
import { defaultAdminSection, isAdminSection } from '~/components/admin/admin-nav';

export const Route = createFileRoute('/admin')({
  loader: async () => {
    // Verify admin access
    const admin = await requireSystemAdmin();

    return { admin };
  },
  component: AdminLayoutWrapper,
});

function AdminLayoutWrapper() {
  const location = useRouterState({ select: (state) => state.location });
  const search = location.search as Record<string, unknown>;
  const rawSection = (search as { section?: unknown }).section;

  const activeSection = isAdminSection(rawSection)
    ? rawSection
    : defaultAdminSection;

  return <AdminLayout activeSection={activeSection} />;
}
