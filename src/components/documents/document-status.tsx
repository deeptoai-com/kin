/**
 * RAG document parse/embed status badge (U2, ingest-UX spec §4).
 *
 * Two separate state machines drive a KB document: parse (PDF→Markdown via the sidecar)
 * then embed (ingest into the vector store). This collapses both into one user-facing
 * chip so the documents table reads at a glance. A parse failure is the actionable case
 * (offer "换引擎重试") — surfaced via `actionable`.
 */
import { AlertCircle, CheckCircle2, Loader2, FileText } from 'lucide-react';
import { cn } from '~/lib/utils';

export interface DocStatusFields {
  parseStatus?: string | null;
  ingestStatus?: string | null;
  ingestProgress?: number | null;
}

export type DocStatusKind = 'none' | 'parse_pending' | 'parsing' | 'parse_failed' | 'embedding' | 'ready' | 'failed';

export function resolveDocStatus(d: DocStatusFields): { kind: DocStatusKind; label: string; progress?: number; actionable: boolean } {
  // Parse stage first — it gates embedding.
  if (d.parseStatus === 'failed') {
    return { kind: 'parse_failed', label: '解析失败', actionable: true };
  }
  if (d.parseStatus === 'processing') {
    return { kind: 'parsing', label: '解析中', actionable: false };
  }
  // 'pending' + not yet embedding = uploaded but no engine chosen (dialog dismissed):
  // actionable so the row offers a way back into the engine picker.
  if (d.parseStatus === 'pending' && d.ingestStatus === 'none') {
    return { kind: 'parse_pending', label: '待解析', actionable: true };
  }
  // Embed stage.
  switch (d.ingestStatus) {
    case 'ready':
      return { kind: 'ready', label: '可检索', actionable: false };
    case 'processing':
    case 'pending':
      return { kind: 'embedding', label: '向量化中', progress: d.ingestProgress ?? 0, actionable: false };
    case 'failed':
      return { kind: 'failed', label: '向量化失败', actionable: true };
    default:
      // ingestStatus 'none' = not a KB/RAG document (e.g. a plain file): no chip.
      return { kind: 'none', label: '', actionable: false };
  }
}

const STYLES: Record<DocStatusKind, { cls: string; Icon: typeof CheckCircle2; spin?: boolean }> = {
  none: { cls: 'text-muted-foreground', Icon: FileText },
  parse_pending: { cls: 'text-amber-600 dark:text-amber-400', Icon: FileText },
  parsing: { cls: 'text-blue-600 dark:text-blue-400', Icon: Loader2, spin: true },
  parse_failed: { cls: 'text-destructive', Icon: AlertCircle },
  embedding: { cls: 'text-blue-600 dark:text-blue-400', Icon: Loader2, spin: true },
  ready: { cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  failed: { cls: 'text-destructive', Icon: AlertCircle },
};

export function DocumentStatusBadge({ doc, onRetry }: { doc: DocStatusFields; onRetry?: () => void }) {
  const s = resolveDocStatus(doc);
  if (s.kind === 'none') return null;
  const { cls, Icon, spin } = STYLES[s.kind];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', cls)}>
      <Icon className={cn('size-3.5', spin && 'animate-spin')} />
      <span>{s.label}{s.kind === 'embedding' && s.progress ? ` ${s.progress}%` : ''}</span>
      {s.actionable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 underline underline-offset-2 hover:no-underline"
        >
          {s.kind === 'parse_pending' ? '选择解析引擎' : '换引擎重试'}
        </button>
      )}
    </span>
  );
}

/** True while any document is mid-pipeline — drives list polling cadence. */
export function anyInFlight(docs: DocStatusFields[]): boolean {
  return docs.some((d) => {
    const k = resolveDocStatus(d).kind;
    return k === 'parsing' || k === 'embedding';
  });
}
