/**
 * Admin · Updates (P1)
 *
 * Surfaces the online-update status (currently running build vs latest published
 * image) inside System & Ops, reusing the existing updater server fns. The apply
 * pipeline itself remains driven by the sidebar update prompt.
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { getUpdateStatus, checkUpdate } from '~/server/function/updater.server';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import RiRefreshLine from '~icons/ri/refresh-line';

type UpdateStatus = Awaited<ReturnType<typeof getUpdateStatus>>;

export const Route = createFileRoute('/admin/updates')({
  loader: async () => ({ initial: await getUpdateStatus() }),
  component: AdminUpdatesPage,
});

function shortSha(sha: string | null | undefined): string {
  if (!sha) return '—';
  return sha.length > 12 ? sha.slice(0, 12) : sha;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

function AdminUpdatesPage() {
  const { initial } = Route.useLoaderData();
  const [status, setStatus] = React.useState<UpdateStatus>(initial);
  const [checking, setChecking] = React.useState(false);
  const runCheck = useServerFn(checkUpdate);
  const refreshStatus = useServerFn(getUpdateStatus);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await runCheck();
      setStatus(await refreshStatus());
    } catch {
      // updater unreachable — leave prior status; surfaced via status.error on next poll
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Online update status. Applying an update is driven by the update prompt in the app
            sidebar (pull → migrate → recreate → health-gate → auto-rollback).
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={checking} onClick={handleCheck}>
          <RiRefreshLine className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
          Check now
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Image status
            {status.updateAvailable ? (
              <Badge>Update available</Badge>
            ) : (
              <Badge variant="secondary">Up to date</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <Row label="Running build">
            <span className="font-mono">{shortSha(status.currentSha)}</span>
          </Row>
          <Row label="Latest published">
            <span className="font-mono">{shortSha(status.latestSha)}</span>
          </Row>
          <Row label="Image">
            <span className="font-mono text-xs">{status.image ?? '—'}</span>
          </Row>
          <Row label="Last checked">
            {status.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'never'}
          </Row>
          {status.error ? (
            <Row label="Last error">
              <span className="text-destructive">{status.error}</span>
            </Row>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
