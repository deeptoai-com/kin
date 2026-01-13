/**
 * Organization Settings Component
 *
 * Allows users to create and manage organizations
 */

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2Icon,
  PlusIcon,
  CrownIcon,
  ShieldIcon,
  UserIcon,
  CheckCircle2Icon,
  InfoIcon,
} from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import { authClient } from '~/lib/auth-client';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Input } from '~/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Alert,
  AlertDescription,
} from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';

const organizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
});

type OrganizationFormValues = z.infer<typeof organizationSchema>;

export function OrganizationSettings() {
  const [organizations, setOrganizations] = React.useState<Array<{
    id: string;
    name: string;
    slug: string | null;
    role: string;
  }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: '',
      slug: '',
    },
  });

  // Load organizations on mount
  React.useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const result = await authClient.organization.list();
      if (result.data) {
        setOrganizations(result.data);
      }
    } catch (err) {
      console.error('Failed to load organizations:', err);
      setError('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (values: OrganizationFormValues) => {
    setCreating(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await authClient.organization.create({
        name: values.name,
        slug: values.slug || undefined,
      });

      if (result.error) {
        setError(result.error.message || 'Failed to create organization');
        return;
      }

      setSuccess(true);
      form.reset();

      // Reload organizations list
      await loadOrganizations();
    } catch (err) {
      console.error('Failed to create organization:', err);
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return (
          <Badge variant="default" className="bg-yellow-500 hover:bg-yellow-600">
            <CrownIcon className="h-3 w-3 mr-1" />
            Owner
          </Badge>
        );
      case 'admin':
        return (
          <Badge variant="default" className="bg-blue-500 hover:bg-blue-600">
            <ShieldIcon className="h-3 w-3 mr-1" />
            Admin
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <UserIcon className="h-3 w-3 mr-1" />
            Member
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Create Organization Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2Icon className="h-5 w-5" />
            Create Organization
          </CardTitle>
          <CardDescription>
            Create an organization to manage permissions and collaborate with your team.
            You will automatically become the owner of the organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Organization Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name *</Label>
              <Input
                id="name"
                placeholder="My Organization"
                {...form.register('name')}
                disabled={creating}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>

            {/* Organization Slug */}
            <div className="space-y-2">
              <Label htmlFor="slug">Slug (Optional)</Label>
              <Input
                id="slug"
                placeholder="my-org"
                {...form.register('slug')}
                disabled={creating}
              />
              {form.formState.errors.slug && (
                <p className="text-sm text-red-500">{form.formState.errors.slug.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Unique identifier for your organization. Leave empty to auto-generate.
              </p>
            </div>

            {/* Success Message */}
            {success && (
              <Alert variant="success" className="border-green-200 bg-green-50">
                <CheckCircle2Icon className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Organization created successfully! You are now the owner.
                </AlertDescription>
              </Alert>
            )}

            {/* Error Message */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <div className="flex justify-end">
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Create Organization
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Existing Organizations */}
      <Card>
        <CardHeader>
          <CardTitle>Your Organizations</CardTitle>
          <CardDescription>
            Organizations you are a member of
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : organizations.length === 0 ? (
            <Alert>
              <InfoIcon className="h-4 w-4" />
              <AlertDescription>
                You are not a member of any organization yet. Create one above to get started.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {organizations.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{org.name}</h4>
                      {getRoleBadge(org.role)}
                    </div>
                    {org.slug && (
                      <p className="text-xs text-muted-foreground">
                        Slug: {org.slug}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Box */}
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          <strong>Organization Owner Benefits:</strong> As an organization owner, you can
          configure permission modes, enable Bash tool access, and manage team members.
          Visit the Permissions settings after creating an organization.
        </AlertDescription>
      </Alert>
    </div>
  );
}
