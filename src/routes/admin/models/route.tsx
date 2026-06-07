/**
 * Admin · Model board + CRUD (PR6 + PR6b)
 *
 * Lists ALL configured models (incl. disabled/unhealthy) grouped by connection,
 * with health + last-probe + reason + latency. Admins can add/delete connections
 * and models, enable/disable, set the default, and re-probe. Admin access is
 * enforced by the parent /admin loader (requireSystemAdmin) + each server fn
 * (requireAdmin). Tokens are never shown — only whether the tokenEnv resolves;
 * a new connection's secret must be set in the server env (.env) under tokenEnv.
 */

import { useMemo, useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Star, Trash2, Plus } from 'lucide-react';
import {
  listModelsAdminFn,
  setModelEnabledFn,
  setDefaultModelFn,
  reprobeModelsFn,
  upsertConnectionFn,
  deleteConnectionFn,
  upsertModelFn,
  deleteModelFn,
} from '~/server/function/models-admin.server';
import type { AdminModelRow } from '~/server/models/registry';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Switch } from '~/components/ui/switch';
import { Input } from '~/components/ui/input';

export const Route = createFileRoute('/admin/models')({
  loader: async () => ({ models: await listModelsAdminFn() }),
  component: AdminModelsPage,
});

const HEALTH_STYLE: Record<AdminModelRow['health'], string> = {
  healthy: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  unhealthy: 'bg-red-500/15 text-red-600 border-red-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

function fmtWhen(d: Date | string | null): string {
  if (!d) return '从未';
  const t = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString();
}

const emptyConn = { id: '', label: '', baseUrl: '', authStyle: 'bearer', tokenEnv: '', aliasHaiku: '' };
const emptyModel = { id: '', label: '', connectionId: '', model: '', tags: '' };

function AdminModelsPage() {
  const { models } = Route.useLoaderData();
  const router = useRouter();
  const setEnabled = useServerFn(setModelEnabledFn);
  const setDefault = useServerFn(setDefaultModelFn);
  const reprobe = useServerFn(reprobeModelsFn);
  const upsertConn = useServerFn(upsertConnectionFn);
  const delConn = useServerFn(deleteConnectionFn);
  const upsertMdl = useServerFn(upsertModelFn);
  const delMdl = useServerFn(deleteModelFn);

  const [busy, setBusy] = useState<string | null>(null);
  const [connForm, setConnForm] = useState({ ...emptyConn });
  const [modelForm, setModelForm] = useState({ ...emptyModel });
  const [showForms, setShowForms] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; baseUrl: string; authStyle: string; tokenEnv: string; tokenResolved: boolean; items: AdminModelRow[] }>();
    for (const m of models) {
      const g = map.get(m.connectionId) ?? {
        label: m.connectionLabel, baseUrl: m.baseUrl, authStyle: m.authStyle, tokenEnv: m.tokenEnv, tokenResolved: m.tokenResolved, items: [],
      };
      g.items.push(m);
      map.set(m.connectionId, g);
    }
    return [...map.entries()].map(([id, g]) => ({ id, ...g }));
  }, [models]);

  const connectionIds = useMemo(() => [...new Set(models.map((m) => m.connectionId))], [models]);

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    try {
      await fn();
      await router.invalidate();
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">模型与健康（多模型）</h1>
          <p className="text-sm text-muted-foreground">来源也可在 <code>OXY_MODELS_SEED</code>(.env) 配置。密钥仅放服务器 env（按 tokenEnv 名），不在此存。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowForms((v) => !v)}>
            <Plus className="h-4 w-4" />{showForms ? '收起' : '新增'}
          </Button>
          <Button variant="outline" size="sm" disabled={busy === 'all'} onClick={() => run('all', () => reprobe({ data: {} }), '已触发全部重测')}>
            {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            全部重测
          </Button>
        </div>
      </div>

      {showForms && (
        <div className="mb-6 grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-2">
          {/* Add/Update connection */}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run('conn-form', () => upsertConn({ data: { id: connForm.id.trim(), label: connForm.label.trim(), baseUrl: connForm.baseUrl.trim(), authStyle: connForm.authStyle as 'bearer' | 'x-api-key', tokenEnv: connForm.tokenEnv.trim(), aliasHaiku: connForm.aliasHaiku.trim() || null } }), '连接已保存').then(() => setConnForm({ ...emptyConn }));
            }}
          >
            <div className="text-xs font-semibold text-foreground">新增/更新连接</div>
            <Input required placeholder="id 如 ark-coding" value={connForm.id} onChange={(e) => setConnForm({ ...connForm, id: e.target.value })} />
            <Input required placeholder="显示名" value={connForm.label} onChange={(e) => setConnForm({ ...connForm, label: e.target.value })} />
            <Input required placeholder="baseUrl 如 https://ark.cn-beijing.volces.com/api/coding" value={connForm.baseUrl} onChange={(e) => setConnForm({ ...connForm, baseUrl: e.target.value })} />
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={connForm.authStyle} onChange={(e) => setConnForm({ ...connForm, authStyle: e.target.value })}>
              <option value="bearer">bearer (ANTHROPIC_AUTH_TOKEN 风格)</option>
              <option value="x-api-key">x-api-key (原生)</option>
            </select>
            <Input required placeholder="tokenEnv 如 ANTHROPIC_AUTH_TOKEN（env 变量名，非值）" value={connForm.tokenEnv} onChange={(e) => setConnForm({ ...connForm, tokenEnv: e.target.value })} />
            <Input placeholder="aliasHaiku（可选，后台档模型）" value={connForm.aliasHaiku} onChange={(e) => setConnForm({ ...connForm, aliasHaiku: e.target.value })} />
            <Button type="submit" size="sm" disabled={busy === 'conn-form'}>保存连接</Button>
          </form>

          {/* Add/Update model */}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run('model-form', () => upsertMdl({ data: { id: modelForm.id.trim(), label: modelForm.label.trim(), connectionId: modelForm.connectionId.trim(), model: modelForm.model.trim(), tags: modelForm.tags.split(',').map((t) => t.trim()).filter(Boolean) } }), '模型已保存').then(() => setModelForm({ ...emptyModel }));
            }}
          >
            <div className="text-xs font-semibold text-foreground">新增/更新模型</div>
            <Input required placeholder="id 如 ark/glm-5.1（线上传输用）" value={modelForm.id} onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })} />
            <Input required placeholder="显示名 如 GLM 5.1" value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
            <input list="conn-ids" required className="h-9 w-full rounded-md border bg-background px-3 text-sm" placeholder="connectionId 如 ark-coding" value={modelForm.connectionId} onChange={(e) => setModelForm({ ...modelForm, connectionId: e.target.value })} />
            <datalist id="conn-ids">{connectionIds.map((id) => <option key={id} value={id} />)}</datalist>
            <Input required placeholder="model（网关认的串）如 glm-5.1" value={modelForm.model} onChange={(e) => setModelForm({ ...modelForm, model: e.target.value })} />
            <Input placeholder="tags 逗号分隔（可选）如 coding,fast" value={modelForm.tags} onChange={(e) => setModelForm({ ...modelForm, tags: e.target.value })} />
            <Button type="submit" size="sm" disabled={busy === 'model-form'}>保存模型</Button>
          </form>
        </div>
      )}

      {models.length === 0 && !showForms && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          暂无模型。点「新增」添加，或在 <code>.env</code> 配置 <code>OXY_MODELS_SEED</code> 后重启。
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="mb-6 rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
            <span className="font-semibold text-foreground">{g.label}</span>
            <span className="text-muted-foreground">{g.baseUrl}</span>
            <Badge variant="outline">{g.authStyle}</Badge>
            <Badge variant="outline" className={g.tokenResolved ? 'text-emerald-600' : 'text-red-600'}>
              {g.tokenEnv}{g.tokenResolved ? ' ✓' : ' ✗未配置'}
            </Badge>
            <Button variant="ghost" size="sm" className="ml-auto text-red-600" disabled={busy === g.id}
              onClick={() => { if (confirm(`删除连接「${g.label}」及其所有模型？`)) void run(g.id, () => delConn({ data: { id: g.id } }), '连接已删除'); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="divide-y">
            {g.items.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-40 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.label}</span>
                    {m.isDefault && <Badge className="gap-1"><Star className="h-3 w-3" />默认</Badge>}
                    {m.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{m.id} · {m.model}</div>
                </div>

                <div className="min-w-44 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className={HEALTH_STYLE[m.health]}>{m.health}</Badge>
                  {m.probeError && <span className="ml-1 text-red-600">{m.probeError}</span>}
                  <div className="mt-0.5">探活: {fmtWhen(m.lastProbeAt)}{m.latencyMs != null ? ` · ${m.latencyMs}ms` : ''}</div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch checked={m.enabled} disabled={busy === m.id}
                      onCheckedChange={(v) => run(m.id, () => setEnabled({ data: { id: m.id, enabled: v } }), v ? '已启用' : '已停用')} />
                    启用
                  </label>
                  <Button variant="ghost" size="sm" disabled={busy === m.id || m.isDefault}
                    onClick={() => run(m.id, () => setDefault({ data: { id: m.id } }), '已设为默认')}>设默认</Button>
                  <Button variant="ghost" size="sm" disabled={busy === m.id}
                    onClick={() => run(m.id, () => reprobe({ data: { modelId: m.id } }), '已触发重测')}>
                    {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-600" disabled={busy === m.id}
                    onClick={() => { if (confirm(`删除模型「${m.label}」？`)) void run(m.id, () => delMdl({ data: { id: m.id } }), '模型已删除'); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
