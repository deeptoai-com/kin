/**
 * Model picker (PR5) — replaces the cosmetic "GLM 5.0" badge with a real per-
 * conversation selector. Lists only currently-selectable models (enabled &&
 * healthy, from the 6h probe), grouped by connection. Writes selectedModelId to
 * the store; ws-server validates + rejects on unhealthy at send (owner decision #2).
 */

'use client';

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { CheckIcon, ChevronDownIcon, CpuIcon } from 'lucide-react';
import { useChatSessionStore } from '~/lib/chat-session-store';
import { getModelMenu } from '~/server/function/models.server';

export const ModelPicker: FC = () => {
  const selectedModelId = useChatSessionStore((s) => s.selectedModelId);
  const setSelectedModelId = useChatSessionStore((s) => s.setSelectedModelId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const menuFn = useServerFn(getModelMenu);
  const { data } = useQuery({
    queryKey: ['model-menu'],
    queryFn: () => menuFn(),
    staleTime: 60_000,
  });
  const models = data?.models ?? [];
  const defaultId = data?.defaultId ?? undefined;

  // Effective current model: explicit selection → default → first selectable.
  const effectiveId = selectedModelId ?? defaultId ?? models[0]?.id;
  const current = models.find((m) => m.id === effectiveId);

  // Group by connection for the dropdown.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: typeof models }>();
    for (const m of models) {
      const g = map.get(m.connectionId) ?? { label: m.connectionLabel, items: [] };
      g.items.push(m);
      map.set(m.connectionId, g);
    }
    return [...map.values()];
  }, [models]);

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
    (id: string) => {
      setSelectedModelId(id);
      setOpen(false);
    },
    [setSelectedModelId],
  );

  // No usable models — guide the admin/owner without breaking the composer.
  if (models.length === 0) {
    return (
      <div
        className="flex h-8 items-center justify-center rounded-md px-2 text-xs text-muted-foreground"
        title="暂无可用模型：在 /admin/models 配置，或等待健康探活通过"
      >
        无可用模型
      </div>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-muted-foreground transition-all duration-200 hover:opacity-80"
        title="选择本次对话使用的模型"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CpuIcon className="h-4 w-4" />
        <span className="max-w-32 truncate text-xs font-semibold text-foreground">
          {current?.label ?? '选择模型'}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-64 overflow-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg"
        >
          {groups.map((g) => (
            <div key={g.label} className="mb-1 last:mb-0">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </div>
              {g.items.map((m) => {
                const isCurrent = m.id === effectiveId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => handlePick(m.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-accent ${isCurrent ? 'bg-accent' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{m.label}</span>
                    {m.tags?.[0] && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {m.tags[0]}
                      </span>
                    )}
                    {isCurrent && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-success" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
