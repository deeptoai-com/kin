/**
 * Admin Overview
 *
 * One-screen operational snapshot for the self-hosted single-organization app.
 */

import type * as React from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Cpu,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { requireSystemAdmin, getAdminOverview } from '~/server/admin.server';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { cn } from '~/lib/utils';

export const Route = createFileRoute('/admin/')({
  loader: async () => {
    const admin = await requireSystemAdmin();
    const overview = await getAdminOverview();
    return { admin, overview };
  },
  component: AdminDashboard,
});

function AdminDashboard() {
  const { admin, overview } = Route.useLoaderData();
  const updateCheckedAt = overview.update.checkedAt
    ? new Date(overview.update.checkedAt).toLocaleString()
    : 'Never checked';

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3" />
              System admin
            </Badge>
            {overview.update.updateAvailable ? (
              <Badge className="gap-1">
                <Sparkles className="h-3 w-3" />
                Update available
              </Badge>
            ) : null}
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Welcome{admin.name ? `, ${admin.name}` : ''}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A compact operations view for users, live concurrency, model health,
            usage and update readiness.
          </p>
        </div>

        <Card className="w-full rounded-lg py-4 lg:w-[360px]">
          <CardContent className="flex items-center justify-between gap-4 px-4">
            <div>
              <p className="text-sm font-medium">Online update</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Current {shortSha(overview.update.currentSha)}
                {overview.update.latestSha ? ` · latest ${shortSha(overview.update.latestSha)}` : ''}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{updateCheckedAt}</p>
            </div>
            <Button variant={overview.update.updateAvailable ? 'default' : 'outline'} size="sm" asChild>
              <Link to="/admin">
                <RefreshCw className="h-4 w-4" />
                Status
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Users"
          value={overview.users.total.toLocaleString()}
          detail={`${overview.users.admins} admins`}
          icon={Users}
        />
        <MetricCard
          title="Live workers"
          value={`${overview.concurrency.activeWorkers}/${overview.concurrency.maxWorkers}`}
          detail={`${overview.concurrency.byUser.length} users running`}
          icon={Cpu}
        />
        <MetricCard
          title="Per-user cap"
          value={overview.concurrency.perUserMaxWorkers.toString()}
          detail={`${overview.concurrency.silentWorkers} silent workers`}
          icon={Activity}
        />
        <MetricCard
          title="Tokens today"
          value={formatCompact(overview.usageToday.totalTokens)}
          detail={`${overview.usageToday.runs} runs · $${overview.usageToday.costUsd.toFixed(2)}`}
          icon={Zap}
        />
        <MetricCard
          title="Models"
          value={`${overview.models.healthy}/${overview.models.total}`}
          detail={`${overview.models.enabled} enabled`}
          icon={CheckCircle2}
          tone={overview.models.unhealthy > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Service health</CardTitle>
            <CardDescription>
              P0 shows confirmed app/database status and placeholders for P2 probes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {Object.entries(overview.health).map(([name, status]) => (
              <HealthRow key={name} name={name} status={status} />
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Live concurrency</CardTitle>
            <CardDescription>
              Runtime snapshot from the session registry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.concurrency.byUser.length > 0 ? (
              <div className="space-y-2">
                {overview.concurrency.byUser.map((row) => (
                  <div key={row.userId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="max-w-[260px] truncate font-mono text-xs">{row.userId}</span>
                    <Badge variant="outline">
                      {row.count}/{overview.concurrency.perUserMaxWorkers}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Clock3}
                title="No active workers"
                description="Running sessions will appear here once the WebSocket registry reports active work."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <QuickLink
          to="/admin/users"
          title="Manage users"
          description="Roles, credits and account governance."
        />
        <QuickLink
          to="/admin/models"
          title="Model health"
          description="Probe model health, toggle availability and set defaults."
        />
        <QuickLink
          to="/admin/skills"
          title="Skill governance"
          description="Review user-added skills and upstream catalog state."
        />
      </div>

      <Card className="rounded-lg border-dashed">
        <CardContent className="flex flex-col gap-3 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium">Performance foundation</p>
            <p className="mt-1 text-sm text-muted-foreground">
              TTFT, generation duration, preview cold start, RAG latency and resource trends are planned for P2.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            Awaiting perf sample schema
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'warn';
}) {
  return (
    <Card className="rounded-lg py-5">
      <CardContent className="flex items-start justify-between gap-3 px-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div
          className={cn(
            'rounded-md border p-2',
            tone === 'warn'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-600'
              : 'border-primary/20 bg-primary/10 text-primary'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function HealthRow({
  name,
  status,
}: {
  name: string;
  status: 'healthy' | 'unknown';
}) {
  const isHealthy = status === 'healthy';
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        {isHealthy ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <CircleHelp className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="capitalize">{name}</span>
      </div>
      <Badge
        variant="outline"
        className={cn(isHealthy ? 'text-emerald-600' : 'text-muted-foreground')}
      >
        {status}
      </Badge>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-md border border-dashed p-5 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function QuickLink({
  to,
  title,
  description,
}: {
  to: '/admin/users' | '/admin/models' | '/admin/skills';
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border bg-card p-5 text-card-foreground transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function shortSha(value: string | null) {
  if (!value) return '-';
  return value.length > 10 ? value.slice(0, 7) : value;
}
