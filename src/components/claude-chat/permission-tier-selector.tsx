/**
 * Permission Tier Selector (PR-B)
 *
 * Coze-style bottom dropdown: 🔍 Explore · ⚡ Auto · 🚀 Act(default)
 *
 * Tiers are a UX preference — how much the agent interrupts you.
 * Security is the sandbox's job, not the tier's. All tiers are always selectable.
 *
 * Capability notes per tier:
 *   Explore : read-only, no edits, no scripts — for planning/review only
 *   Auto    : edits + sandbox scripts; HITL for dangerous ops (Wave 2)
 *   Act     : same as Auto, minimal interruptions (default)
 */

'use client';

import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, RocketIcon, SearchIcon, ZapIcon } from 'lucide-react';
import {
  DEFAULT_TIER,
  PERMISSION_TIERS,
  type PermissionTier,
} from '~/lib/permission-tier';

interface TierMeta {
  icon: typeof ZapIcon;
  label: string;
  sub: string;
  desc: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const TIER_META: Record<PermissionTier, TierMeta> = {
  explore: {
    icon: SearchIcon,
    label: 'Explore',
    sub: '探索',
    desc: '只读 · 出方案 · 不改文件 · 不跑脚本',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-border',
  },
  auto: {
    icon: ZapIcon,
    label: 'Auto',
    sub: '默认',
    desc: '自动编辑 · 危险才问 · 可跑脚本（沙箱）',
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/30',
  },
  act: {
    icon: RocketIcon,
    label: 'Act',
    sub: '执行',
    desc: '放手干 · 少打断 · 含沙箱 Bash',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
  },
};

interface PermissionTierSelectorProps {
  selectedTier?: PermissionTier;
  onSelect: (tier: PermissionTier) => void;
}

export const PermissionTierSelector: FC<PermissionTierSelectorProps> = ({
  selectedTier,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const current: PermissionTier = selectedTier ?? DEFAULT_TIER;
  const meta = TIER_META[current];
  const Icon = meta.icon;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handlePick = useCallback(
    (tier: PermissionTier) => {
      onSelect(tier);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <div className="relative" ref={rootRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group flex items-center gap-1.5 rounded-lg border px-3 py-1.5 transition-all duration-200 ${meta.bgColor} ${meta.borderColor} ${meta.color} cursor-pointer hover:opacity-80`}
        title={meta.desc}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold">{meta.label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
        >
          {PERMISSION_TIERS.map((tier) => {
            const m = TIER_META[tier];
            const TierIcon = m.icon;
            const isCurrent = tier === current;
            return (
              <button
                key={tier}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => handlePick(tier)}
                className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left cursor-pointer transition hover:bg-accent ${isCurrent ? 'bg-accent' : ''}`}
              >
                <TierIcon className={`mt-0.5 h-4 w-4 shrink-0 ${m.color}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">{m.label}</span>
                    <span className="text-[11px] text-muted-foreground">{m.sub}</span>
                    {isCurrent && <CheckIcon className="ml-auto h-3.5 w-3.5 text-success" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                    {m.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
