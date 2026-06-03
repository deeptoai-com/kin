import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
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
import { ChevronDown, Minimize2 } from 'lucide-react';
import type { A2Category, A2Template, A2ComposerStore } from '~/lib/a2composer/types';
import { resolveSkillMatch } from '~/lib/a2composer/skill-match';
import { applyTemplate, extractVariables } from '~/lib/a2composer/template-utils';
import { listAllSkillsFn, getCuratedSkillSchemaFn, ensureUserSkillEnabledFn } from '~/server/function/skills.server';
import { getA2ComposerStoreFn } from '~/server/function/a2composer.server';
import type { ExtendedSkillInfo, SkillInputField } from '~/claude/skills';
import { useChatSessionStore } from '~/lib/chat-session-store';

interface A2ComposerPanelProps {
  composerText: string;
  onSetComposerText: (text: string) => void;
  /** Reset panel to minimized state (call after user sends message) */
  onReset?: () => void;
  /** Notify parent when panel open state changes (expanded vs minimized) */
  onOpenChange?: (open: boolean) => void;
  /** Explicitly select a skill for this message */
  onSkillSelect?: (skill: { slug: string; name: string }) => void;
}

export function A2ComposerPanel({ composerText, onSetComposerText, onReset, onOpenChange, onSkillSelect }: A2ComposerPanelProps) {
  // Panel state
  const [isMinimized, setIsMinimized] = useState(true);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const listAllSkills = useServerFn(listAllSkillsFn);
  const getSkillSchema = useServerFn(getCuratedSkillSchemaFn);
  const ensureSkillEnabled = useServerFn(ensureUserSkillEnabledFn);
  const getStore = useServerFn(getA2ComposerStoreFn);
  const addTemporarySkill = useChatSessionStore((state) => state.addTemporarySkill);

  const { data: store } = useQuery<A2ComposerStore>({
    queryKey: ['a2composer-store'],
    queryFn: () => getStore(),
  });
  const { data: skillData, isLoading: isLoadingSkills } = useQuery({
    queryKey: ['a2composer-skills'],
    queryFn: () => listAllSkills(),
  });

  const skills = useMemo<ExtendedSkillInfo[]>(() => {
    if (!skillData) return [];
    return [...skillData.official, ...skillData.user];
  }, [skillData]);

  const categories = useMemo<A2Category[]>(() => {
    return (store?.categories ?? []).filter((category) => !category.hidden);
  }, [store]);

  const selectedCategory = useMemo(() => {
    if (!activeCategoryId) return null;
    return categories.find((cat) => cat.id === activeCategoryId) ?? null;
  }, [activeCategoryId, categories]);

  const templates = useMemo<A2Template[]>(
    () => (store?.templates ?? [])
      .filter((template) => template.categoryId === activeCategoryId && !template.hidden),
    [activeCategoryId, store]
  );

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateId) return null;
    return (store?.templates ?? []).find((template) => template.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, store]);

  const { data: schemaData } = useQuery({
    queryKey: ['a2composer-schema', selectedTemplate?.skillId],
    // S4: read the fillable-variable schema from the DB cache (skill_schema_cache)
    queryFn: () => getSkillSchema({ data: { slug: selectedTemplate?.skillId ?? '' } }),
    enabled: Boolean(selectedTemplate?.skillId),
  });

  const schemaInputs = useMemo<SkillInputField[]>(() => {
    return schemaData?.schema?.inputs ?? [];
  }, [schemaData]);

  const schemaAvailable = Boolean(schemaData?.schema && schemaInputs.length > 0);

  const normalizeKey = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  // Reset selected template if no longer in current category
  useEffect(() => {
    if (!selectedTemplateId) return;
    if (!templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(null);
      setVariableValues({});
    }
  }, [selectedTemplateId, templates]);

  // Auto-select first category if none selected
  useEffect(() => {
    if (!categories.length) {
      setActiveCategoryId('');
      return;
    }
    if (!activeCategoryId || !categories.some((category) => category.id === activeCategoryId)) {
      setActiveCategoryId(categories[0]?.id ?? '');
    }
  }, [activeCategoryId, categories]);

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(!isMinimized);
  }, [isMinimized, onOpenChange]);

  const variables = useMemo(() => {
    if (!selectedTemplate) return [];
    return extractVariables(selectedTemplate.template);
  }, [selectedTemplate]);

  const schemaInputMap = useMemo(() => {
    const map = new Map<string, SkillInputField>();
    for (const field of schemaInputs) {
      map.set(field.name, field);
    }
    return map;
  }, [schemaInputs]);

  const schemaNormalizedMap = useMemo(() => {
    const map = new Map<string, SkillInputField>();
    for (const field of schemaInputs) {
      map.set(normalizeKey(field.name), field);
    }
    return map;
  }, [schemaInputs]);

  const variableFields = useMemo(() => {
    return variables.map((name) => ({
      name,
      field: schemaInputMap.get(name) ?? schemaNormalizedMap.get(normalizeKey(name)),
    }));
  }, [schemaInputMap, schemaNormalizedMap, variables]);

  const matchMap = useMemo(() => {
    const map = new Map<string, ExtendedSkillInfo | null>();
    for (const template of store?.templates ?? []) {
      map.set(template.id, resolveSkillMatch(template, skills));
    }
    return map;
  }, [skills, store]);

  // Auto-fill default values from schema
  useEffect(() => {
    if (!selectedTemplate || schemaInputs.length === 0) return;
    const templateVars = new Set(variables.map((name) => normalizeKey(name)));
    setVariableValues((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, string> = {};
      for (const field of schemaInputs) {
        const normalizedField = normalizeKey(field.name);
        if (!templateVars.has(normalizedField)) continue;
        const templateVar = variables.find((name) => normalizeKey(name) === normalizedField) ?? field.name;
        if (field.defaultValue !== undefined && field.defaultValue !== null) {
          if (Array.isArray(field.defaultValue)) {
            next[templateVar] = field.defaultValue.join(', ');
          } else {
            next[templateVar] = String(field.defaultValue);
          }
        }
      }
      return next;
    });
  }, [schemaInputs, selectedTemplate, variables]);

  // Handle category click - expand panel
  const handleCategoryClick = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    setIsMinimized(false);
  };

  // Handle template selection
  const handleSelectTemplate = async (template: A2Template) => {
    setSelectedTemplateId(template.id);
    setVariableValues({});
    const appliedText = applyTemplate(template.template, {});
    onSetComposerText(appliedText);
    if (template.skillId) {
      try {
        const result = await ensureSkillEnabled({ data: { skillName: template.skillId } });
        if (result?.enabledNow) {
          addTemporarySkill(result.skillName ?? template.skillId);
        }
        const matchedSkill = skills.find((skill) => skill.slug === template.skillId);
        onSkillSelect?.({ slug: template.skillId, name: matchedSkill?.name ?? template.skillId });
      } catch (error) {
        console.error('[A2Composer] Failed to auto-enable skill:', error);
      }
    }
  };

  // Handle variable change
  const handleVariableChange = (key: string, value: string) => {
    setVariableValues((prev) => {
      const next = { ...prev, [key]: value };
      if (selectedTemplate) {
        const appliedText = applyTemplate(selectedTemplate.template, next);
        onSetComposerText(appliedText);
      }
      return next;
    });
  };

  // Handle minimize
  const handleMinimize = () => {
    setIsMinimized(true);
    setSelectedTemplateId(null);
    setVariableValues({});
    onReset?.();
  };

  // Auto-collapse on external reset
  useEffect(() => {
    if (onReset && composerText === '' && selectedTemplateId) {
      handleMinimize();
    }
  }, [composerText, onReset]);

  const getOptionValue = (option: SkillInputField['options'][number], index: number) => {
    if (typeof option === 'string') return option;
    return option.value ?? option.label ?? `option-${index}`;
  };

  const getOptionLabel = (option: SkillInputField['options'][number]) => {
    if (typeof option === 'string') return option;
    return option.label ?? option.value ?? '';
  };

  const parseMultiValue = (value: string | undefined) => {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const renderVariableControl = (variable: string, field?: SkillInputField) => {
    const value = variableValues[variable] ?? '';
    const label = field?.label ?? variable;
    const placeholder = field?.placeholder ?? field?.description ?? `请输入${label}`;
    const type = field?.type ?? 'text';
    const options = field?.options ?? [];

    switch (type) {
      case 'textarea':
        return (
          <Textarea
            value={value}
            placeholder={placeholder}
            rows={3}
            onChange={(event) => handleVariableChange(variable, event.target.value)}
            className="resize-none"
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value}
            placeholder={placeholder}
            onChange={(event) => handleVariableChange(variable, event.target.value)}
          />
        );
      case 'select':
        return (
          <Select
            value={value}
            onValueChange={(next) => handleVariableChange(variable, next)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={placeholder || '请选择'} />
            </SelectTrigger>
            <SelectContent>
              {options.length === 0 ? (
                <SelectItem value="__empty__" disabled>暂无选项</SelectItem>
              ) : options.map((option, index) => {
                const optionValue = getOptionValue(option, index);
                return (
                  <SelectItem key={optionValue} value={optionValue}>
                    {getOptionLabel(option)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );
      case 'multiselect': {
        const selected = new Set(parseMultiValue(value));
        return (
          <div className="flex flex-wrap gap-3">
            {options.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无选项</div>
            ) : options.map((option, index) => {
              const optionValue = getOptionValue(option, index);
              const checked = selected.has(optionValue);
              return (
                <label
                  key={optionValue}
                  className="flex items-center gap-2 text-sm cursor-pointer select-none"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      const nextSelected = new Set(selected);
                      if (next === true) {
                        nextSelected.add(optionValue);
                      } else {
                        nextSelected.delete(optionValue);
                      }
                      handleVariableChange(variable, Array.from(nextSelected).join(', '));
                    }}
                  />
                  <span>{getOptionLabel(option)}</span>
                </label>
              );
            })}
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
      case 'file':
        return (
          <Input
            type="text"
            value={value}
            placeholder={placeholder || '请输入文件名或链接'}
            onChange={(event) => handleVariableChange(variable, event.target.value)}
          />
        );
      case 'text':
      default:
        return (
          <Input
            value={value}
            placeholder={placeholder}
            onChange={(event) => handleVariableChange(variable, event.target.value)}
          />
        );
    }
  };

  // ===== MINIMIZED STATE: Category buttons only =====
  if (isMinimized) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-xl border bg-card/70 backdrop-blur-sm p-2 shadow-sm">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
          {categories.map((category) => (
            <Button
              key={category.id}
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 rounded-full border border-border bg-card hover:bg-accent"
              onClick={() => handleCategoryClick(category.id)}
            >
              <span className="text-base">{category.icon}</span>
              <span>{category.label}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          ))}
          {!categories.length && (
            <span className="text-sm text-muted-foreground px-2">暂无任务分类</span>
          )}
        </div>
      </div>
    );
  }

  // ===== EXPANDED STATE =====
  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border bg-card shadow-sm">
      {/* Header with minimize button */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{selectedCategory?.label ?? '任务入口'}</span>
          {selectedTemplate && (
            <span className="text-sm text-muted-foreground">/ {selectedTemplate.title}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleMinimize}
          >
            <Minimize2 className="h-3.5 w-3.5 mr-1" />
            收起
          </Button>
        </div>
      </div>

      {/* Category Tabs (horizontal scroll) */}
      <div className="border-b">
        <div className="flex items-center gap-1 overflow-x-auto px-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {categories.map((category) => {
            const isActive = category.id === activeCategoryId;
            return (
              <button
                key={category.id}
                className={`
                  shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-b-2
                  ${isActive
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                  }
                `}
                onClick={() => setActiveCategoryId(category.id)}
              >
                <span>{category.icon}</span>
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Task Cards (horizontal scroll) - only show when no template selected */}
      {!selectedTemplate && (
        <div className="p-4">
          <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
            {templates.map((template) => {
              const matchedSkill = matchMap.get(template.id) ?? null;
              const shouldShowMatch = Boolean(
                template.skillId || template.skillHint || template.skillTags?.length
              );

              return (
                <div
                  key={template.id}
                  className="shrink-0 w-64 rounded-lg border border-border bg-card p-4 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between"
                  onClick={() => handleSelectTemplate(template)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <h3 className="font-medium text-sm line-clamp-1">{template.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2.5rem]">
                        {template.summary}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectTemplate(template);
                      }}
                    >
                      使用
                    </Button>
                  </div>
                  {shouldShowMatch && (
                    <div className="flex items-center gap-2">
                      {isLoadingSkills && (
                        <span className="text-xs text-muted-foreground">匹配中...</span>
                      )}
                      {!isLoadingSkills && matchedSkill && (
                        <span className="text-xs text-primary">匹配技能：{matchedSkill.slug}</span>
                      )}
                      {!isLoadingSkills && !matchedSkill && (
                        <span className="text-xs text-muted-foreground">未匹配技能</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {templates.length === 0 && (
              <div className="text-sm text-muted-foreground px-2">该分类暂无任务模板</div>
            )}
          </div>
        </div>
      )}

      {/* Form Fields - show when template selected */}
      {selectedTemplate && variables.length > 0 && (
        <div className="p-4 space-y-4">
          {/* Template info with back button */}
          <div className="flex items-center gap-3 pb-3 border-b">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setSelectedTemplateId(null)}
            >
              <ChevronDown className="h-4 w-4 rotate-90 mr-1" />
              返回
            </Button>
            <div className="flex-1">
              <h3 className="font-medium">{selectedTemplate.title}</h3>
              <p className="text-xs text-muted-foreground">{selectedTemplate.summary}</p>
            </div>
          </div>

          {/* Form fields */}
          <div className="space-y-4">
            {variableFields.map(({ name, field }) => (
              <div key={name} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">
                    {field?.label ?? name}
                  </label>
                  {field?.required && (
                    <span className="text-xs text-destructive">*</span>
                  )}
                  {field?.description && (
                    <span className="text-xs text-muted-foreground">{field.description}</span>
                  )}
                </div>
                {renderVariableControl(name, field)}
              </div>
            ))}
          </div>

        </div>
      )}

      {/* No variables case */}
      {selectedTemplate && variables.length === 0 && (
        <div className="p-4 text-center text-sm text-muted-foreground">
          此任务模板无需填写字段，可直接发送。
        </div>
      )}
    </div>
  );
}
