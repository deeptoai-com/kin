/**
 * Admin Organizations Page
 *
 * System admin organization management interface
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import {
  getAllOrganizations,
  createOrganizationAsAdmin,
  deleteOrganization,
  getOrganizationDetails,
} from '~/server/admin.server';
import { getAllUsers } from '~/server/admin.server';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Badge } from '~/components/ui/badge';
import RiAddLine from '~icons/ri/add-line';
import RiBuilding4Line from '~icons/ri/building-4-line';
import RiDeleteBinLine from '~icons/ri/delete-bin-line';
import RiEyeLine from '~icons/ri/eye-line';
import RiUserLine from '~icons/ri/user-line';

export const Route = createFileRoute('/admin/organizations')({
  loader: async () => {
    const organizations = await getAllOrganizations();
    return { organizations };
  },
  component: AdminOrganizationsPage,
});

function AdminOrganizationsPage() {
  const { organizations } = Route.useLoaderData();
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = React.useState(false);
  const [selectedOrg, setSelectedOrg] = React.useState<typeof organizations[0] | null>(null);

  const createOrg = useServerFn(createOrganizationAsAdmin);
  const deleteOrg = useServerFn(deleteOrganization);
  const getOrgDetails = useServerFn(getOrganizationDetails);
  const [orgDetails, setOrgDetails] = React.useState<any>(null);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const slug = formData.get('slug') as string;
    const ownerId = formData.get('ownerId') as string;
    const permissionMode = formData.get('permissionMode') as string;
    const allowBash = formData.get('allowBash') === 'true';

    try {
      await createOrg({ data: { name, slug, ownerId, permissionMode, allowBash } });
      setCreateDialogOpen(false);
      alert('Organization created successfully!');
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create organization');
    }
  };

  const handleDelete = async (orgId: string) => {
    if (!confirm('Are you sure you want to delete this organization?')) return;

    try {
      await deleteOrg({ data: { organizationId: orgId } });
      alert('Organization deleted successfully!');
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete organization');
    }
  };

  const handleViewDetails = async (org: typeof organizations[0]) => {
    setSelectedOrg(org);
    try {
      const details = await getOrgDetails({ data: { organizationId: org.id } });
      setOrgDetails(details);
      setDetailsDialogOpen(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to load organization details');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Organization Management</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Create and manage all organizations
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <RiAddLine className="h-4 w-4 mr-2" />
              Create Organization
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Organization</DialogTitle>
              <DialogDescription>
                Create a new organization and assign an owner
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Organization Name *</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="My Organization"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug *</Label>
                <Input
                  id="slug"
                  name="slug"
                  required
                  placeholder="my-org"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerId">Owner *</Label>
                <OrgOwnerSelect name="ownerId" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="permissionMode">Permission Mode</Label>
                <Select name="permissionMode" defaultValue="default">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Standard</SelectItem>
                    <SelectItem value="bypassPermissions">Bypass</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="allowBash">Allow Bash Tool</Label>
                <Select name="allowBash" defaultValue="false">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Organizations Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Permission Mode</TableHead>
              <TableHead>Bash</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((org) => (
              <TableRow key={org.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <RiBuilding4Line className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{org.name}</div>
                      {org.slug && (
                        <div className="text-sm text-gray-500">/{org.slug}</div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {org.owner ? (
                    <div className="flex items-center gap-2">
                      <RiUserLine className="h-4 w-4 text-gray-400" />
                      <span>{org.owner.name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">No owner</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{org.memberCount} members</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={org.metadata?.permissionMode === 'bypassPermissions' ? 'default' : 'secondary'}
                  >
                    {org.metadata?.permissionMode || 'default'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {org.metadata?.allowBash ? (
                    <Badge className="bg-green-500">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(org.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleViewDetails(org)}
                    >
                      <RiEyeLine className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(org.id)}
                    >
                      <RiDeleteBinLine className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Organization Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Organization Details</DialogTitle>
            <DialogDescription>
              {selectedOrg?.name}
            </DialogDescription>
          </DialogHeader>
          {orgDetails && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Members ({orgDetails.members.length})</h3>
                <div className="space-y-2">
                  {orgDetails.members.map((member: any) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <RiUserLine className="h-4 w-4 text-gray-400" />
                        <div>
                          <div className="font-medium">{member.user.name}</div>
                          <div className="text-sm text-gray-500">{member.user.email}</div>
                        </div>
                      </div>
                      <Badge>{member.role}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Organizations</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{organizations.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Members</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {organizations.reduce((sum, org) => sum + org.memberCount, 0)}
          </p>
        </div>
      </div>
    </div>
  );
}

// Helper component for owner selection
function OrgOwnerSelect({ name }: { name: string }) {
  const [users, setUsers] = React.useState<Array<{ id: string; name: string; email: string }>>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getAllUsers().then(data => {
      setUsers(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <Select disabled><SelectTrigger><SelectValue placeholder="Loading users..." /></SelectTrigger></Select>;
  }

  return (
    <Select name={name} required>
      <SelectTrigger>
        <SelectValue placeholder="Select owner" />
      </SelectTrigger>
      <SelectContent>
        {users.map(user => (
          <SelectItem key={user.id} value={user.id}>
            {user.name} ({user.email})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
