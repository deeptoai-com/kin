/**
 * Admin · Access & Permissions (访问与权限)
 *
 * Visualizes Kin's permission posture so a non-technical admin can control it without
 * touching env vars. The two real, fully-wired levers are **shell audience** (who gets
 * the sandboxed shell) and **egress scope** (how open the network is). A posture preset
 * sets both in one click. The "security floor" block is read-only (sandbox on, runtime,
 * native-Bash-disallowed) — shown for transparency, not editable here. Per-user roles
 * live on the Users page. Admin access is enforced by the /admin loader + each server fn.
 */

import { useState } from 'react';
import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Globe, Terminal, Users, Lock } from 'lucide-react';
import {
  getCapabilityAdminFn,
  setCapabilitySettingFn,
  applyPresetFn,
  type CapabilityPreset,
} from '~/server/function/permissions-admin.server';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Textarea } from '~/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

export const Route = createFileRoute('/admin/permissions')({
  loader: async () => ({ view: await getCapabilityAdminFn() }),
  component: AdminPermissionsPage,
});

type PresetCard = { id: Exclude<CapabilityPreset, 'custom'>; title: string; blurb: string };
const PRESET_CARDS: PresetCard[] = [
  {
    id: 'open',
    title: '完全开放',
    blurb: '人人可用沙盒 shell，出网全开（含内网可达）。最省心，自己对自己负责。',
  },
  {
    id: 'guarded',
    title: '开放·留网闸',
    blurb: '人人可用沙盒 shell，出网走推荐白名单（git/npm/pip 照常，挡内网与云元数据）。',
  },
  {
    id: 'adminOnly',
    title: '管理员特权',
    blurb: '仅管理员可用沙盒 shell，出网走推荐白名单。能力收敛，最保守。',
  },
];

const AUDIENCE_OPTIONS = [
  { value: 'everyone', label: '全员', hint: '所有登录成员都能让 Agent 跑沙盒 shell（git/npm/构建等）' },
  { value: 'admins', label: '仅管理员', hint: '只有管理员/白名单用户能用 shell，普通成员不行' },
  { value: 'off', label: '关闭', hint: '任何人都不能用 shell（Agent 仍可读写文件、跑 Python 等）' },
] as const;

const EGRESS_OPTIONS = [
  { value: 'curated', label: '推荐白名单', hint: 'git/npm/pypi/CDN 全通；内网服务与云元数据天然挡掉（推荐）' },
  { value: 'open', label: '全开', hint: '不限制出网，含内网可达；有 SSRF 面，仅完全信任的内网用' },
  { value: 'custom', label: '自定义', hint: '只放行你列出的域名，其余全挡' },
  { value: 'off', label: '全断', hint: '完全不能出网（连 git clone 都不行）' },
] as const;

function AdminPermissionsPage() {
  const { view } = Route.useLoaderData();
  const router = useRouter();
  const setSetting = useServerFn(setCapabilitySettingFn);
  const applyPreset = useServerFn(applyPresetFn);

  const [busy, setBusy] = useState<string | null>(null);
  const [domains, setDomains] = useState(view.config.egressCustomDomains.join('\n'));

  const { config, foundation, activePreset } = view;

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

  const saveDomains = () => {
    const list = domains
      .split(/[\n,]/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    return run('domains', () => setSetting({ data: { key: 'egressCustomDomains', value: list } }), '自定义域名已保存');
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">访问与权限</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        本地部署、单组织信任产品。下面两项就是核心权限：谁能用 <b>沙盒 shell</b>、Agent 能
        <b>出网</b>到哪。改动对下一次会话即时生效，无需重启。
      </p>

      {/* 1 · 安全姿态预设 */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">安全姿态（一键设好下面两项）</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESET_CARDS.map((p) => {
            const active = activePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={busy === `preset:${p.id}`}
                onClick={() => run(`preset:${p.id}`, () => applyPreset({ data: { preset: p.id } }), `已切换到「${p.title}」`)}
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border hover:border-primary/40 hover:bg-muted/40'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{p.title}</span>
                  {active && <Badge className="h-5 px-1.5 text-[10px]">当前</Badge>}
                  {busy === `preset:${p.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{p.blurb}</p>
              </button>
            );
          })}
        </div>
        {activePreset === 'custom' && (
          <p className="mt-2 text-xs text-muted-foreground">当前为自定义组合（不匹配任何预设）。</p>
        )}
      </section>

      {/* 2 · 逐项控制 */}
      <section className="mb-8 space-y-5">
        <h2 className="text-sm font-medium">逐项控制</h2>

        {/* Shell 受众 */}
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">沙盒 Shell 受众</div>
              <p className="text-xs text-muted-foreground">
                {AUDIENCE_OPTIONS.find((o) => o.value === config.shellAudience)?.hint}
              </p>
            </div>
          </div>
          <Select
            value={config.shellAudience}
            onValueChange={(v) =>
              run('audience', () => setSetting({ data: { key: 'shellAudience', value: v } }), 'Shell 受众已更新')
            }
          >
            <SelectTrigger className="w-[150px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 出网范围 */}
        <div className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">出网范围</div>
                <p className="text-xs text-muted-foreground">
                  {EGRESS_OPTIONS.find((o) => o.value === config.egressScope)?.hint}
                </p>
              </div>
            </div>
            <Select
              value={config.egressScope}
              onValueChange={(v) =>
                run('egress', () => setSetting({ data: { key: 'egressScope', value: v } }), '出网范围已更新')
              }
            >
              <SelectTrigger className="w-[150px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EGRESS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {config.egressScope === 'custom' && (
            <div className="mt-3 border-t pt-3">
              <label className="text-xs text-muted-foreground">放行域名（每行一个，或逗号分隔）</label>
              <Textarea
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder={'github.com\nregistry.npmjs.org\npypi.org'}
                rows={4}
                className="mt-1 font-mono text-xs"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" disabled={busy === 'domains'} onClick={saveDomains}>
                  {busy === 'domains' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  保存域名
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3 · 安全地基（只读） */}
      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <Lock className="h-3.5 w-3.5" /> 安全地基（只读，部署级）
        </h2>
        <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-xs">
          <FoundationRow label="执行沙盒" ok={foundation.sandboxEnabled}
            value={foundation.sandboxEnabled ? '开启' : '关闭'}
            note="所有 shell/代码都在沙盒内（文件围栏、剥离密钥、限资源）。改它需部署 env + 重启。" />
          <FoundationRow label="执行后端" ok value={foundation.runtime}
            note="srt = 进程级沙盒（bubblewrap）；docker = 每命令独立容器。" />
          <FoundationRow label="原生 Bash" ok value="永久禁用"
            note="原生 Bash 会绕过沙盒，恒被禁；shell 只走受控的 mcp__bash__run。" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          成员谁是管理员（影响「仅管理员」受众）在{' '}
          <Link to="/admin/users" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline">
            <Users className="h-3 w-3" /> 用户管理
          </Link>{' '}
          里设置。
        </p>
      </section>
    </div>
  );
}

function FoundationRow({ label, value, ok, note }: { label: string; value: string; ok: boolean; note: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="font-medium">{label}</span>
        <p className="text-muted-foreground">{note}</p>
      </div>
      <Badge
        variant="outline"
        className={`shrink-0 ${ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/30 bg-amber-500/10 text-amber-600'}`}
      >
        {value}
      </Badge>
    </div>
  );
}
