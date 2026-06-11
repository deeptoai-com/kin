/**
 * Parse-engine picker dialog (U2, ingest-UX spec §3 "系统推荐+可改").
 *
 * After a PDF upload (or on "换引擎重试"), the page probes the file and opens this with a
 * recommendation pre-selected. The user accepts or overrides; OCR is shown but disabled
 * until U3 (the OCR model is deliberately not locked yet). Pure presentation — the caller
 * owns probe + requestDocumentParse.
 */
import { useEffect, useState } from 'react';
import { FileText, Layers, ScanLine, Loader2 } from 'lucide-react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';

export type ParseMethod = 'simple' | 'structured' | 'ocr';

export interface ProbeRecommendation {
  method: ParseMethod;
  reason: string;
  pages?: number;
  chars?: number;
}

const OPTIONS: Array<{ method: ParseMethod; Icon: typeof FileText; title: string; desc: string; disabled?: boolean }> = [
  { method: 'simple', Icon: FileText, title: '简单解析', desc: '快速提取文本层。纯文字、不在乎表格/标题层级时用。' },
  { method: 'structured', Icon: Layers, title: '结构化解析', desc: '完整版式分析：标题层级、表格、页码。合同/招股书/研报推荐。' },
  { method: 'ocr', Icon: ScanLine, title: '扫描 / 图片 (OCR)', desc: '图片型 PDF、扫描件。即将上线。', disabled: true },
];

export function ParseEngineDialog({
  open,
  probing,
  recommendation,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  probing: boolean;
  recommendation: ProbeRecommendation | null;
  busy: boolean;
  onConfirm: (method: ParseMethod) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<ParseMethod>('structured');

  useEffect(() => {
    if (recommendation && recommendation.method !== 'ocr') setSelected(recommendation.method);
  }, [recommendation]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-foreground">选择解析方式</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {probing ? (
            <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> 正在检测文档…</span>
          ) : recommendation ? (
            <>系统推荐 <strong className="text-foreground">{OPTIONS.find((o) => o.method === recommendation.method)?.title}</strong>
              {recommendation.pages ? `（${recommendation.pages} 页）` : ''}——{recommendation.reason}。可改选。</>
          ) : (
            '请选择用哪种引擎把文档解析为 Markdown。'
          )}
        </p>

        <div className="mt-4 space-y-2">
          {OPTIONS.map((o) => {
            const isRecommended = recommendation?.method === o.method;
            return (
              <button
                key={o.method}
                type="button"
                disabled={o.disabled}
                onClick={() => !o.disabled && setSelected(o.method)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  o.disabled && 'cursor-not-allowed opacity-50',
                  selected === o.method && !o.disabled ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                )}
              >
                <o.Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {o.title}
                    {isRecommended && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">推荐</span>}
                    {o.disabled && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">即将上线</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{o.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>取消</Button>
          <Button onClick={() => onConfirm(selected)} disabled={busy || probing}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : '开始解析'}
          </Button>
        </div>
      </div>
    </div>
  );
}
