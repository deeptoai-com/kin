/**
 * Admin · Usage (P1)
 *
 * Read-only aggregates over usage_record: totals, by-model, by-day, by-user.
 * No new schema. Range switches re-run the server fn. No conversation content.
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { getUsageAggregate } from '~/server/admin.server';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Button } from '~/components/ui/button';

type Aggregate = Awaited<ReturnType<typeof getUsageAggregate>>;

const RANGES = [7, 30, 90] as const;

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const Route = createFileRoute('/admin/usage')({
  loader: async () => ({ initial: await getUsageAggregate({ data: { days: 30 } }) }),
  component: AdminUsagePage,
});

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function AdminUsagePage() {
  const { initial } = Route.useLoaderData();
  const [data, setData] = React.useState<Aggregate>(initial);
  const [days, setDays] = React.useState<number>(initial.days);
  const [loading, setLoading] = React.useState(false);
  const fetchAggregate = useServerFn(getUsageAggregate);

  const switchRange = async (next: number) => {
    if (next === days || loading) return;
    setLoading(true);
    try {
      const result = await fetchAggregate({ data: { days: next } });
      setData(result);
      setDays(next);
    } finally {
      setLoading(false);
    }
  };

  const maxDayTokens = Math.max(1, ...data.byDay.map((d) => d.totalTokens));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token, cost and run aggregates over the selected window. Cost is the SDK's local
            estimate against list prices — internal reference only, not a billing basis.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={r === days ? 'default' : 'outline'}
              disabled={loading}
              onClick={() => switchRange(r)}
            >
              {r}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Runs" value={fmtInt(data.totals.runs)} hint={`${fmtInt(data.totals.rows)} model rows`} />
        <MetricCard
          label="Tokens"
          value={fmtTokens(data.totals.totalTokens)}
          hint={`${fmtTokens(data.totals.inputTokens)} in · ${fmtTokens(data.totals.outputTokens)} out`}
        />
        <MetricCard label="Est. cost (USD)" value={`$${data.totals.costUsd.toFixed(2)}`} hint="local estimate" />
        <MetricCard label="Errored runs" value={fmtInt(data.totals.errors)} />
      </div>

      {/* Daily trend — CSS mini bars, stable height, no chart lib */}
      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage recorded in this window.</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {data.byDay.map((d) => (
                <div key={d.day} className="group flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${fmtInt(d.totalTokens)} tokens · $${d.costUsd.toFixed(2)}`}>
                  <div
                    className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                    style={{ height: `${Math.max(2, (d.totalTokens / maxDayTokens) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By model</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Est. $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byModel.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No data
                    </TableCell>
                  </TableRow>
                ) : (
                  data.byModel.map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-medium">{m.model}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(m.runs)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtTokens(m.inputTokens + m.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">${m.costUsd.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By user (top 50)</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Est. $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byUser.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No data
                    </TableCell>
                  </TableRow>
                ) : (
                  data.byUser.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell>
                        <div className="font-medium">{u.name ?? u.email ?? u.userId}</div>
                        {u.name && u.email ? (
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(u.runs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(u.totalTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">${u.costUsd.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
