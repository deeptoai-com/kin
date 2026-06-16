/**
 * Admin · Audit Log (P1)
 *
 * Read-only, paginated view over audit_log with action filter. Rows are written
 * by recordAudit() at action sites; meta never carries conversation content.
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { listAuditLog } from '~/server/admin.server';
import { Card, CardContent } from '~/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

type AuditResult = Awaited<ReturnType<typeof listAuditLog>>;

const PAGE_SIZE = 50;
const ALL = '__all__';

export const Route = createFileRoute('/admin/audit')({
  loader: async () => ({ initial: await listAuditLog({ data: { limit: PAGE_SIZE, offset: 0 } }) }),
  component: AdminAuditPage,
});

function metaSummary(meta: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== 'object') return '';
  const keys = Object.keys(meta);
  if (keys.length === 0) return '';
  return keys
    .slice(0, 4)
    .map((k) => `${k}=${String((meta as Record<string, unknown>)[k])}`)
    .join(' · ');
}

function AdminAuditPage() {
  const { initial } = Route.useLoaderData();
  const [data, setData] = React.useState<AuditResult>(initial);
  const [action, setAction] = React.useState<string>(ALL);
  const [offset, setOffset] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const fetchAudit = useServerFn(listAuditLog);

  const load = async (nextAction: string, nextOffset: number) => {
    setLoading(true);
    try {
      const result = await fetchAudit({
        data: {
          limit: PAGE_SIZE,
          offset: nextOffset,
          action: nextAction === ALL ? undefined : nextAction,
        },
      });
      setData(result);
      setAction(nextAction);
      setOffset(nextOffset);
    } finally {
      setLoading(false);
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Append-only trail of security-relevant actions. {data.total.toLocaleString('en-US')} events.
          </p>
        </div>
        <div className="w-56 shrink-0">
          <Select value={action} disabled={loading} onValueChange={(v) => load(v, 0)}>
            <SelectTrigger>
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              {data.actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No audit events
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {row.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{row.userId ?? '—'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs" title={row.target ?? ''}>
                      {row.target ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={metaSummary(row.meta)}>
                      {metaSummary(row.meta) || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.ip ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {page} of {pageCount}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || offset === 0}
            onClick={() => load(action, Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || offset + PAGE_SIZE >= data.total}
            onClick={() => load(action, offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
