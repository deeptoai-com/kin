/**
 * Interaction Mode Selector — Cowork-aligned: 🖐 Ask · ⏩ Act (default).
 *
 * Modes are an INTERRUPTION preference (how much the agent pauses), not a
 * capability gate. Security is the sandbox's job. (The old read-only "Explore/Plan"
 * tier was dropped — web + fully-sandboxed, no use for read-only planning.)
 *
 *   Ask : Claude pauses before each action so you can approve it (HITL)
 *   Act : Claude works without pausing for approval (default)
 */

'use client';

import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, FastForwardIcon, HandIcon } from 'lucide-react';
import {
  DEFAULT_MODE,
  INTERACTION_MODES,
  type InteractionMode,
} from '~/lib/permission-tier';

interface ModeMeta {
  icon: typeof HandIcon;
  label: string;
  sub: string;
  desc: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const MODE_META: Record<InteractionMode, ModeMeta> = {
  ask: {
    icon: HandIcon,
    label: 'Ask',
    sub: '逐步批准',
    desc: '每个动作前暂停,等你批准',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-border',
  },
  act: {
    icon: FastForwardIcon,
    label: 'Act',
    sub: '自主',
    desc: '自主执行,不打断',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
  },
};

interface PermissionTierSelectorProps {
  selectedTier?: InteractionMode;
  onSelect: (mode: InteractionMode) => void;
}

export const PermissionTierSelector: FC<PermissionTierSelectorProps> = ({
  selectedTier,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const current: InteractionMode = selectedTier ?? DEFAULT_MODE;
  const meta = MODE_META[current];
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
    (mode: InteractionMode) => {
      onSelect(mode);
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
          {INTERACTION_MODES.map((mode) => {
            const m = MODE_META[mode];
            const ModeIcon = m.icon;
            const isCurrent = mode === current;
            return (
              <button
                key={mode}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => handlePick(mode)}
                className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left cursor-pointer transition hover:bg-accent ${isCurrent ? 'bg-accent' : ''}`}
              >
                <ModeIcon className={`mt-0.5 h-4 w-4 shrink-0 ${m.color}`} />
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
