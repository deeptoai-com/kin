/**
 * Admin Users Page
 *
 * System admin user management interface
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { getAllUsers, addUserCredits, updateUserSystemRole } from '~/server/admin.server';
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
import RiCoinsLine from '~icons/ri/coins-line';
import RiShieldLine from '~icons/ri/shield-line';
import RiUserLine from '~icons/ri/user-line';

export const Route = createFileRoute('/admin/users')({
  loader: async () => {
    const users = await getAllUsers();
    return { users };
  },
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const { users } = Route.useLoaderData();
  const [selectedUser, setSelectedUser] = React.useState<typeof users[0] | null>(null);
  const [creditsDialogOpen, setCreditsDialogOpen] = React.useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false);

  const addCredits = useServerFn(addUserCredits);
  const updateRole = useServerFn(updateUserSystemRole);

  const handleAddCredits = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUser) return;

    const formData = new FormData(e.currentTarget);
    const amount = Number(formData.get('amount'));
    const kind = formData.get('kind') as string;
    const note = formData.get('note') as string;

    try {
      await addCredits({ data: { userId: selectedUser.id, amount, kind, note } });
      setCreditsDialogOpen(false);
      alert('Credits added successfully!');
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add credits');
    }
  };

  const handleUpdateRole = async (role: string) => {
    if (!selectedUser) return;

    try {
      await updateRole({ data: { userId: selectedUser.id, role } });
      setRoleDialogOpen(false);
      alert('Role updated successfully!');
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update role');
    }
  };

  const getTotalCredits = (user: typeof users[0]) => {
    const balance = user.creditBalances[0];
    if (!balance) return 0;
    return (balance.monthlyAllotment || 0) + (balance.extraCredits || 0) - (balance.allotmentUsed || 0);
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">User Management</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Manage all users and their credits
        </p>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>System Role</TableHead>
              <TableHead>Credits Balance</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <RiUserLine className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{user.name}</div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {user.systemRole === 'admin' ? (
                    <Badge className="bg-yellow-500 hover:bg-yellow-600">
                      <RiShieldLine className="h-3 w-3 mr-1" />
                      Admin
                    </Badge>
                  ) : (
                    <Badge variant="secondary">User</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <RiCoinsLine className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium">{getTotalCredits(user)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {user.subscriptions[0] ? (
                    <Badge variant="outline">{user.subscriptions[0].plan.name}</Badge>
                  ) : (
                    <span className="text-sm text-gray-500">No subscription</span>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(user.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Dialog open={creditsDialogOpen && selectedUser?.id === user.id} onOpenChange={(open) => {
                      setCreditsDialogOpen(open);
                      if (open) setSelectedUser(user);
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <RiAddLine className="h-4 w-4 mr-1" />
                          Add Credits
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add Credits</DialogTitle>
                          <DialogDescription>
                            Add credits to {user.name}'s account
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleAddCredits} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="amount">Amount</Label>
                            <Input
                              id="amount"
                              name="amount"
                              type="number"
                              min="1"
                              required
                              placeholder="100"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="kind">Type</Label>
                            <Select name="kind" defaultValue="gift">
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="purchase">Purchase</SelectItem>
                                <SelectItem value="gift">Gift</SelectItem>
                                <SelectItem value="compensation">Compensation</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="note">Note</Label>
                            <Input
                              id="note"
                              name="note"
                              required
                              placeholder="Reason for adding credits"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setCreditsDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button type="submit">Add Credits</Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={roleDialogOpen && selectedUser?.id === user.id} onOpenChange={(open) => {
                      setRoleDialogOpen(open);
                      if (open) setSelectedUser(user);
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="ghost">
                          <RiShieldLine className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Update System Role</DialogTitle>
                          <DialogDescription>
                            Change {user.name}'s system role
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Role</Label>
                            <Select
                              defaultValue={user.systemRole}
                              onValueChange={(value) => handleUpdateRole(value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-sm text-gray-500">
                            ⚠️ Admins have full access to the system admin panel.
                          </p>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Users</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{users.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">Admins</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {users.filter(u => u.systemRole === 'admin').length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Credits</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {users.reduce((sum, user) => sum + getTotalCredits(user), 0)}
          </p>
        </div>
      </div>
    </div>
  );
}
