/**
 * Server Update Dialog — admin-only 4-step "Web server update" flow (Kin M3, FR3–FR8).
 *
 * Opened from the sidebar "update available" entry. Steps:
 *   1. Web server update — current/latest version + release notes + auto-check toggle
 *   2. Are you absolutely sure? — warning + "check service status"
 *   3. Ready to update — live service health checklist (verifyServices)
 *   4. In progress — live phase chips (getApplyStatus), then auto-reload when /api/health flips
 *
 * Reuses the design-system shadcn primitives (Dialog/Button/Badge/Switch) + intlayer i18n.
 * Degrades gracefully when the updater sidecar is unreachable (pre-M0 wiring): mutations
 * surface an error rather than crashing.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useIntlayer } from 'react-intlayer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Switch } from '~/components/ui/switch';
import { verifyServices, applyUpdate, getApplyStatus } from '~/server/function/updater.server';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Server,
  ArrowRight,
  Sparkles,
  XCircle,
  Check,
} from 'lucide-react';

export interface UpdateStatusView {
  currentSha: string;
  latestSha: string | null;
  updateAvailable: boolean;
  image: string | null;
}

interface ServiceRow {
  service: string | null;
  state: string | null;
  health: string | null;
  status: string | null;
}

interface ServerUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatusView;
  autoCheck: boolean;
  onAutoCheckChange: (value: boolean) => void;
  releaseNotesUrl?: string;
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—');

// updater phase -> 0..3 chip index (or special states)
const PHASE_INDEX: Record<string, number> = {
  'recording-good-image': 0,
  pulling: 0,
  migrating: 1,
  'recreating-worker': 2,
  'recreating-app': 3,
  'health-gate': 3,
  done: 4,
};

export function ServerUpdateDialog({
  open,
  onOpenChange,
  status,
  autoCheck,
  onAutoCheckChange,
  releaseNotesUrl = 'https://github.com/Deeptoai-com/kin/releases',
}: ServerUpdateDialogProps) {
  const sv = useIntlayer('serverUpdate');
  const [step, setStep] = useState(1);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [allRunning, setAllRunning] = useState(false);
  const [phase, setPhase] = useState<string>('pulling');
  const [failed, setFailed] = useState<{ rolledBack: boolean } | null>(null);
  const sawDowntime = useRef(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setServices([]);
      setFailed(null);
      setPhase('pulling');
      sawDowntime.current = false;
    }
  }, [open]);

  const verifyMutation = useMutation({
    mutationFn: () => verifyServices(),
    onSuccess: (data) => {
      setServices((data?.services as ServiceRow[]) ?? []);
      setAllRunning(Boolean(data?.allRunning));
      setStep(3);
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => applyUpdate(),
    onSuccess: () => setStep(4),
  });

  // Step 4: poll updater phase (best-effort) + app health; reload when the version flips.
  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await getApplyStatus();
        if (!cancelled && typeof st?.phase === 'string') setPhase(st.phase);
        if (!cancelled && st?.error) setFailed({ rolledBack: Boolean(st?.rolledBack) });
      } catch {
        // app likely recreating — fall through to the health poll
      }
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { version?: string };
          const versionChanged = body?.version && body.version !== status.currentSha;
          if (!cancelled && (versionChanged || sawDowntime.current)) {
            window.location.reload();
            return;
          }
        } else {
          sawDowntime.current = true;
        }
      } catch {
        sawDowntime.current = true;
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step, status.currentSha]);

  const phaseIndex = PHASE_INDEX[phase] ?? 0;
  const mutationError = verifyMutation.error || applyMutation.error;

  const chips = [
    { label: sv.step4.phasePull.value },
    { label: sv.step4.phaseMigrate.value },
    { label: sv.step4.phaseWorker.value },
    { label: sv.step4.phaseApp.value },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !applyMutation.isPending && step !== 4 && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Server className="size-5" /> {sv.step1.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                  {sv.common.currentVersion} {short(status.currentSha)}
                </span>
                {status.updateAvailable && (
                  <>
                    <ArrowRight className="size-4 text-muted-foreground" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                      <Sparkles className="size-3" /> {sv.step1.newVersion} {short(status.latestSha)}
                    </span>
                  </>
                )}
                {!status.updateAvailable && (
                  <span className="text-xs text-muted-foreground">{sv.step1.upToDate}</span>
                )}
              </div>
              <a
                href={releaseNotesUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" /> {sv.step1.releaseNotes}
              </a>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">{sv.step1.autoCheck}</span>
                <Switch checked={autoCheck} onCheckedChange={onAutoCheckChange} aria-label={sv.step1.autoCheck.value} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {sv.common.cancel}
              </Button>
              <Button disabled={!status.updateAvailable} onClick={() => setStep(2)}>
                {sv.step1.updateServer}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-500" /> {sv.step2.title}
              </DialogTitle>
              <DialogDescription className="pt-1 leading-relaxed">{sv.step2.warning}</DialogDescription>
            </DialogHeader>
            {mutationError && (
              <p className="text-sm text-destructive">{String((mutationError as Error).message)}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {sv.common.cancel}
              </Button>
              <Button onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
                {verifyMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {sv.step2.verifyStatus}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 3 && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Server className="size-5" /> {sv.step3.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {services.length === 0 && (
                <p className="text-sm text-muted-foreground">{sv.step3.checking}</p>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {services.map((s) => {
                  const running = (s.state ?? '').toLowerCase() === 'running';
                  return (
                    <span key={s.service ?? Math.random()} className="flex items-center gap-2 py-1 text-sm">
                      {running ? (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      ) : (
                        <XCircle className="size-4 text-destructive" />
                      )}
                      {s.service}
                    </span>
                  );
                })}
              </div>
              {services.length > 0 && (
                <p className={`text-sm ${allRunning ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {allRunning ? sv.step3.allRunning : sv.step3.someNotRunning}
                </p>
              )}
              {mutationError && (
                <p className="text-sm text-destructive">{String((mutationError as Error).message)}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {sv.common.cancel}
              </Button>
              <Button variant="outline" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
                <RefreshCw className={`mr-2 size-4 ${verifyMutation.isPending ? 'animate-spin' : ''}`} />
                {sv.step3.recheck}
              </Button>
              <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
                {applyMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {sv.step3.confirmUpgrade}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 4 && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {failed ? (
                  <AlertTriangle className="size-5 text-destructive" />
                ) : (
                  <Loader2 className="size-5 animate-spin text-primary" />
                )}
                {sv.step4.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {chips.map((chip, i) => {
                  const done = !failed && phaseIndex > i;
                  const active = !failed && phaseIndex === i;
                  return (
                    <span key={chip.label} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-muted-foreground/50">›</span>}
                      <span
                        className={
                          done
                            ? 'flex items-center gap-1 text-emerald-600'
                            : active
                              ? 'flex items-center gap-1 font-medium text-primary'
                              : 'flex items-center gap-1 text-muted-foreground/60'
                        }
                      >
                        {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : null}
                        {chip.label}
                      </span>
                    </span>
                  );
                })}
              </div>
              {failed ? (
                <p className="text-sm text-destructive">
                  {failed.rolledBack ? sv.step4.rolledBack : sv.step4.failed}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {phaseIndex >= 4 ? sv.step4.done : sv.step4.willReload}
                </p>
              )}
            </div>
            {failed && (
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {sv.common.close}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
