import { createFileRoute } from '@tanstack/react-router';
import { AdminLayout } from '~/components/admin/AdminLayout';
import { requireSystemAdmin } from '~/server/admin.server';

export const Route = createFileRoute('/admin')({
  loader: async () => {
    // Verify admin access
    const admin = await requireSystemAdmin();

    return { admin };
  },
  component: AdminLayoutWrapper,
});

function AdminLayoutWrapper() {
  return <AdminLayout />;
}
