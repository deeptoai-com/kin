import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  Compass,
  Cpu,
  Minimize2,
  PenLine,
  Plus,
  Shapes,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Switch } from '~/components/ui/switch';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  getComposerCatalogFn,
  getCuratedSkillSchemaFn,
  installCuratedSkillFn,
} from '~/server/function/skills.server';
import type { ComposerSkill } from '~/lib/a2composer/types';
import type { SkillInputField } from '~/claude/skills';
import { A2_BUCKETS, CATEGORY_TO_BUCKET, type BucketId } from '~/lib/a2composer/buckets';
import { useChatSessionStore } from '~/lib/chat-session-store';

type SkillOption = NonNullable<SkillInputField['options']>[number];

const BUCKET_ICONS: Record<string, LucideIcon> = { PenLine, Shapes, Workflow, Compass, Cpu };

interface A2ComposerPanelProps {
  composerText: string;
  onSetComposerText: (text: string) => void;
  /** Reset panel to minimized state (call after user sends message) */
  onReset?: () => void;
  /** Notify parent when panel open state changes (expanded vs minimized) */
  onOpenChange?: (open: boolean) => void;
  /** Explicitly select a skill for this message */
  onSkillSelect?: (skill: { slug: string; name: string }) => void;
  /** Open a fresh conversation so a just-enabled skill loads (SDK can't hot-reload) */
  onOpenNewConversation?: () => void;
}

const starterOf = (s: ComposerSkill) => s.firstTaskZh || s.summaryZh || '';
const displayName = (s: ComposerSkill) => s.titleZh || s.name;

export function A2ComposerPanel({
  composerText,
  onSetComposerText,
  onReset,
  onOpenChange,
  onSkillSelect,
  onOpenNewConversation,
}: A2ComposerPanelProps) {
  void composerText; // prop kept for API compatibility; no longer read internally
  const [isMinimized, setIsMinimized] = useState(true);
  const [activeBucketId, setActiveBucketId] = useState<BucketId>(A2_BUCKETS[0].id);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [showUnenabled, setShowUnenabled] = useState(false);
  const [riskSkill, setRiskSkill] = useState<ComposerSkill | null>(null);
  const [justEnabled, setJustEnabled] = useState<ComposerSkill | null>(null);

  const getCatalog = useServerFn(getComposerCatalogFn);
  const getSkillSchema = useServerFn(getCuratedSkillSchemaFn);
  const installSkill = useServerFn(installCuratedSkillFn);
  const setPendingArmedSkill = useChatSessionStore((s) => s.setPendingArmedSkill);

  const { data: catalog = [], isLoading, refetch } = useQuery<ComposerSkill[]>({
    queryKey: ['a2composer-catalog'],
    queryFn: () => getCatalog(),
  });

  // Group skills into the 5 task buckets.
  const byBucket = useMemo(() => {
    const map = new Map<BucketId, ComposerSkill[]>();
    for (const b of A2_BUCKETS) map.set(b.id, []);
    for (const s of catalog) {
      const bucket = s.category ? CATEGORY_TO_BUCKET[s.category] : undefined;
      if (bucket && map.has(bucket)) map.get(bucket)?.push(s);
    }
    return map;
  }, [catalog]);

  const buckets = useMemo(
    () => A2_BUCKETS.filter((b) => (byBucket.get(b.id)?.length ?? 0) > 0),
    [byBucket],
  );

  const activeSkills = byBucket.get(activeBucketId) ?? [];
  const enabledSkills = activeSkills.filter((s) => s.enabled);
  const unenabledSkills = activeSkills.filter((s) => !s.enabled);
  const activeBucket = A2_BUCKETS.find((b) => b.id === activeBucketId) ?? null;

  const selectedSkill = useMemo(
    () => catalog.find((s) => s.slug === selectedSlug) ?? null,
    [catalog, selectedSlug],
  );

  // Variable schema (only for an already-enabled, selected skill).
  const { data: schemaData } = useQuery({
    queryKey: ['a2composer-skill-schema', selectedSkill?.enabled ? selectedSlug : null],
    queryFn: () => getSkillSchema({ data: { slug: selectedSlug ?? '' } }),
    enabled: Boolean(selectedSkill?.enabled && selectedSlug),
  });
  const schemaInputs: SkillInputField[] = useMemo(
    () => schemaData?.schema?.inputs ?? [],
    [schemaData],
  );

  // Keep active bucket valid.
  useEffect(() => {
    if (buckets.length && !buckets.some((b) => b.id === activeBucketId)) {
      setActiveBucketId(buckets[0].id);
    }
  }, [buckets, activeBucketId]);

  useEffect(() => {
    onOpenChange?.(!isMinimized);
  }, [isMinimized, onOpenChange]);

  const buildPrompt = (skill: ComposerSkill, values: Record<string, string>) => {
    const base = starterOf(skill);
    const filled = schemaInputs
      .filter((f) => values[f.name] && String(values[f.name]).trim())
      .map((f) => `- ${f.label || f.name}：${values[f.name]}`);
    return filled.length ? `${base}\n\n${filled.join('\n')}` : base;
  };

  // ── actions ────────────────────────────────────────────────────────────
  const handleMinimize = () => {
    setIsMinimized(true);
    setSelectedSlug(null);
    setVariableValues({});
    setRiskSkill(null);
    setJustEnabled(null);
    setShowUnenabled(false);
    onReset?.();
  };

  const openEnabledSkill = (skill: ComposerSkill) => {
    // Arm the skill (composer chip + skill marker on send). Composer text is set
    // by the tier effect once the schema resolves: Tier 2 (has inputs) → form-fill
    // prompt; Tier 1 (no inputs) → empty composer, firstTaskZh shown only as a hint.
    setSelectedSlug(skill.slug);
    setVariableValues({});
    onSkillSelect?.({ slug: skill.slug, name: displayName(skill) });
  };

  const enableSkill = async (skill: ComposerSkill) => {
    setRiskSkill(null);
    onSkillSelect?.({ slug: skill.slug, name: displayName(skill) });
    try {
      // Catalog install: materialize SKILL.md to disk + record in skill_enablement.
      // Effective next conversation (SDK can't hot-reload — STATUS Skills S2).
      await installSkill({ data: { slug: skill.slug } });
      void refetch();
    } catch (error) {
      console.error('[A2Composer] Failed to install skill:', error);
    }
    setJustEnabled(skill);
  };

  const handlePick = (skill: ComposerSkill) => {
    if (skill.enabled) {
      openEnabledSkill(skill);
      return;
    }
    if (skill.riskNotesZh?.trim()) {
      setRiskSkill(skill);
      return;
    }
    void enableSkill(skill);
  };

  const handleOpenNewChat = (skill: ComposerSkill) => {
    // Arm the skill in the fresh session (it's enabled now, effective next convo).
    setPendingArmedSkill({ slug: skill.slug, name: displayName(skill) });
    onOpenNewConversation?.();
    handleMinimize();
  };

  const handleVariableChange = (key: string, value: string) => {
    setVariableValues((prev) => {
      const next = { ...prev, [key]: value };
      if (selectedSkill) onSetComposerText(buildPrompt(selectedSkill, next));
      return next;
    });
  };

  // Two-tier: once an enabled skill is selected and its schema resolves, either
  // seed the form-fill prompt (Tier 2 — has inputs) or keep the composer empty so
  // firstTaskZh acts purely as a hint (Tier 1). Post-send reset is handled by the
  // parent remount (a2ComposerKey), so no auto-collapse effect is needed here.
  useEffect(() => {
    if (!selectedSkill?.enabled) return;
    if (schemaData === undefined) return; // schema still loading
    onSetComposerText(schemaInputs.length > 0 ? buildPrompt(selectedSkill, {}) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlug, schemaData]);

  // ── variable form controls (schema-driven) ─────────────────────────────
  const getOptionValue = (option: SkillOption, index: number) =>
    typeof option === 'string' ? option : option.value ?? option.label ?? `option-${index}`;
  const getOptionLabel = (option: SkillOption) =>
    typeof option === 'string' ? option : option.label ?? option.value ?? '';
  const parseMultiValue = (value: string | undefined) =>
    value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];

  const renderVariableControl = (variable: string, field?: SkillInputField) => {
    const value = variableValues[variable] ?? '';
    const placeholder = field?.placeholder ?? field?.description ?? `请输入${field?.label ?? variable}`;
    const type = field?.type ?? 'text';
    const options = field?.options ?? [];

    switch (type) {
      case 'textarea':
        return (
          <Textarea
            value={value}
            placeholder={placeholder}
            rows={3}
            onChange={(e) => handleVariableChange(variable, e.target.value)}
            className="resize-none"
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value}
            placeholder={placeholder}
            onChange={(e) => handleVariableChange(variable, e.target.value)}
          />
        );
      case 'select':
        return (
          <Select value={value} onValueChange={(v) => handleVariableChange(variable, v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={placeholder || '请选择'} />
            </SelectTrigger>
            <SelectContent>
              {options.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  暂无选项
                </SelectItem>
              ) : (
                options.map((option, index) => {
                  const optionValue = getOptionValue(option, index);
                  return (
                    <SelectItem key={optionValue} value={optionValue}>
                      {getOptionLabel(option)}
                    </SelectItem>
                  );
                })
              )}
            </SelectContent>
          </Select>
        );
      case 'multiselect': {
        const selected = new Set(parseMultiValue(value));
        return (
          <div className="flex flex-wrap gap-3">
            {options.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无选项</div>
            ) : (
              options.map((option, index) => {
                const optionValue = getOptionValue(option, index);
                return (
                  <label key={optionValue} className="flex cursor-pointer select-none items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(optionValue)}
                      onCheckedChange={(next) => {
                        const nextSel = new Set(selected);
                        if (next === true) nextSel.add(optionValue);
                        else nextSel.delete(optionValue);
                        handleVariableChange(variable, Array.from(nextSel).join(', '));
                      }}
                    />
                    <span>{getOptionLabel(option)}</span>
                  </label>
                );
              })
            )}
          </div>
        );
      }
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={value === 'true' || value === '1'}
              onCheckedChange={(checked) => handleVariableChange(variable, checked ? 'true' : 'false')}
            />
            <span className="text-sm text-muted-foreground">
              {value === 'true' || value === '1' ? '是' : '否'}
            </span>
          </div>
        );
      default:
        return (
          <Input
            value={value}
            placeholder={placeholder}
            onChange={(e) => handleVariableChange(variable, e.target.value)}
          />
        );
    }
  };

  // ── small presentational bits ──────────────────────────────────────────
  const StatusBadge = ({ skill }: { skill: ComposerSkill }) =>
    skill.enabled ? (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" /> 可用
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" /> 未启用
      </span>
    );

  const SkillCard = ({ skill }: { skill: ComposerSkill }) => (
    <button
      type="button"
      className="group flex w-64 shrink-0 flex-col justify-between rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
      onClick={() => handlePick(skill)}
    >
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="line-clamp-1 font-medium text-sm">{displayName(skill)}</h3>
          {skill.level && <span className="font-mono text-[10px] text-muted-foreground">{skill.level}</span>}
        </div>
        <p className="line-clamp-2 min-h-[2.5rem] text-muted-foreground text-xs">{skill.summaryZh}</p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <StatusBadge skill={skill} />
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {skill.enabled ? '使用' : '启用'} <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );

  // ===== MINIMIZED: bucket pills only =====
  if (isMinimized) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card/70 p-2 shadow-sm backdrop-blur-sm">
        <div className="scrollbar-thin scrollbar-thumb-muted-foreground/20 flex items-center gap-2 overflow-x-auto pb-1">
          {buckets.map((bucket) => {
            const Icon = BUCKET_ICONS[bucket.icon] ?? Plus;
            return (
              <Button
                key={bucket.id}
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1.5 rounded-md border border-border bg-card font-mono text-xs hover:bg-accent"
                onClick={() => {
                  setActiveBucketId(bucket.id);
                  setIsMinimized(false);
                }}
              >
                <Icon className="h-3.5 w-3.5 text-primary" />
                <span>{bucket.label}</span>
              </Button>
            );
          })}
          {!buckets.length && (
            <span className="px-2 text-muted-foreground text-sm">
              {isLoading ? '加载技能…' : '暂无可用技能'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ===== EXPANDED =====
  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="font-medium">{activeBucket?.label ?? '技能'}</span>
          {selectedSkill && <span className="text-muted-foreground">/ {displayName(selectedSkill)}</span>}
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleMinimize}>
          <Minimize2 className="mr-1 h-3.5 w-3.5" />
          收起
        </Button>
      </div>

      {/* Bucket tabs */}
      <div className="border-b border-border">
        <div className="scrollbar-thin scrollbar-thumb-muted-foreground/20 flex items-center gap-1 overflow-x-auto px-2">
          {buckets.map((bucket) => {
            const Icon = BUCKET_ICONS[bucket.icon] ?? Plus;
            const isActive = bucket.id === activeBucketId;
            return (
              <button
                type="button"
                key={bucket.id}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-sm transition-colors ${
                  isActive
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => {
                  setActiveBucketId(bucket.id);
                  setSelectedSlug(null);
                  setRiskSkill(null);
                  setJustEnabled(null);
                  setShowUnenabled(false);
                }}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-primary' : ''}`} />
                <span>{bucket.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Risk guard */}
      {riskSkill && (
        <div className="p-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1">
                <p className="font-medium text-sm">启用「{displayName(riskSkill)}」前请注意</p>
                <p className="mt-1 text-muted-foreground text-xs">{riskSkill.riskNotesZh}</p>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRiskSkill(null)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void enableSkill(riskSkill)}>
                仍要启用
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Just-enabled cue (effective next conversation) */}
      {!riskSkill && justEnabled && (
        <div className="p-4">
          <div className="rounded-md border border-primary/30 bg-accent p-4">
            <p className="font-medium text-sm">
              已加入「{displayName(justEnabled)}」—— 将在<strong className="text-primary">新对话</strong>生效
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              当前模型无法在运行中的会话热加载技能；开启新对话即可加载并使用。起手 prompt 已为你准备好。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setJustEnabled(null)}>
                知道了
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => handleOpenNewChat(justEnabled)}>
                开启新对话并加载 <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Selected enabled skill — Tier 2 (curated form) or Tier 1 (placeholder hint) */}
      {!riskSkill && !justEnabled && selectedSkill?.enabled && (
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelectedSlug(null)}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
            <div className="flex-1">
              <h3 className="font-medium text-sm">{displayName(selectedSkill)}</h3>
              <p className="text-muted-foreground text-xs">{selectedSkill.summaryZh}</p>
            </div>
          </div>

          {schemaData === undefined ? (
            <p className="text-center text-muted-foreground text-sm">正在准备…</p>
          ) : schemaInputs.length > 0 ? (
            // Tier 2 — curated form: the fields compose the prompt.
            <div className="space-y-4">
              {schemaInputs.map((field) => (
                <div key={field.name} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label className="font-medium text-sm">{field.label ?? field.name}</label>
                    {field.required && <span className="text-destructive text-xs">*</span>}
                    {field.description && (
                      <span className="text-muted-foreground text-xs">{field.description}</span>
                    )}
                  </div>
                  {renderVariableControl(field.name, field)}
                </div>
              ))}
            </div>
          ) : (
            // Tier 1 — placeholder hint: skill is armed, composer stays empty.
            <div className="rounded-md border border-primary/20 bg-accent/60 p-3">
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                提示 · how to use
              </p>
              <p className="mt-1.5 text-foreground text-sm">{starterOf(selectedSkill)}</p>
              <p className="mt-2 text-muted-foreground text-xs">
                「{displayName(selectedSkill)}」已就绪 —— 按提示在下方输入框输入 / 粘贴内容并发送即可。
              </p>
            </div>
          )}
        </div>
      )}

      {/* Skill cards (default view) */}
      {!riskSkill && !justEnabled && !selectedSkill && (
        <div className="space-y-3 p-4">
          {enabledSkills.length > 0 ? (
            <div className="scrollbar-thin scrollbar-thumb-muted-foreground/20 flex items-center gap-3 overflow-x-auto pb-2">
              {enabledSkills.map((skill) => (
                <SkillCard key={skill.slug} skill={skill} />
              ))}
            </div>
          ) : (
            <p className="px-1 text-muted-foreground text-sm">
              该分类下还没有已启用的技能 —— 从下方启用一个（新对话生效）。
            </p>
          )}

          {unenabledSkills.length > 0 && (
            <div>
              <button
                type="button"
                className="font-mono text-muted-foreground text-xs hover:text-foreground"
                onClick={() => setShowUnenabled((v) => !v)}
              >
                {showUnenabled ? '收起' : `更多技能（未启用 · ${unenabledSkills.length}）`}
              </button>
              {showUnenabled && (
                <div className="scrollbar-thin scrollbar-thumb-muted-foreground/20 mt-3 flex items-center gap-3 overflow-x-auto pb-2">
                  {unenabledSkills.map((skill) => (
                    <SkillCard key={skill.slug} skill={skill} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
