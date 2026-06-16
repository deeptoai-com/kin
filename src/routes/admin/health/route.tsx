/**
 * Admin · Health (P2)
 *
 * Live service-health snapshot. DB / Redis / Meilisearch / parser are really
 * probed (short timeout); app is implied by serving; worker derives from the
 * session registry. MinIO deep-probe is not yet wired (shown as unknown).
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { getSystemHealth } from '~/server/perf.server';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import RiRefreshLine from '~icons/ri/refresh-line';

type Health = Awaited<ReturnType<typeof getSystemHealth>>;
type State = Health['services'][keyof Health['services']];

const DOT: Record<string, string> = {
  healthy: 'bg-green-500',
  down: 'bg-red-500',
  unknown: 'bg-muted-foreground/40',
};
const LABEL: Record<string, string> = {
  app: 'App',
  db: 'PostgreSQL',
  worker: 'Worker',
  redis: 'Redis',
  meili: 'Meilisearch',
  parser: 'Parser',
  minio: 'MinIO',
};

export const Route = createFileRoute('/admin/health')({
  loader: async () => ({ initial: await getSystemHealth() }),
  component: AdminHealthPage,
});

function AdminHealthPage() {
  const { initial } = Route.useLoaderData();
  const [health, setHealth] = React.useState<Health>(initial);
  const [loading, setLoading] = React.useState(false);
  const refresh = useServerFn(getSystemHealth);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      setHealth(await refresh());
    } finally {
      setLoading(false);
    }
  };

  const services = Object.entries(health.services) as Array<[string, State]>;
  const downCount = services.filter(([, s]) => s === 'down').length;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live dependency probes. {downCount === 0 ? 'All probed services responding.' : `${downCount} service(s) down.`}
            {' '}Checked {new Date(health.checkedAt).toLocaleTimeString()}.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={handleRefresh}>
          <RiRefreshLine className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Services</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            {services.map(([name, state]) => (
              <div key={name} className="flex items-center justify-between border-b py-3 last:border-0">
                <span className="text-sm font-medium">{LABEL[name] ?? name}</span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${DOT[state] ?? DOT.unknown}`} />
                  {state}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-sm">
        <CardContent className="p-4">
          <p className="text-[13px] text-muted-foreground">Active / total workers</p>
          <p className="mt-1 text-2xl font-medium tabular-nums">
            {health.workers.active} / {health.workers.total}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
