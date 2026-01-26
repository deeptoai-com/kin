import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Circle, Eye, Trash2, FileJson, RefreshCw } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Switch } from '~/components/ui/switch';
import { useServerFn } from '@tanstack/react-start';
import { getSkillSchemaStatusFn } from '~/server/function/skills.server';
import type { ExtendedSkillInfo, SchemaStatus } from '~/claude/skills';

interface SkillCardProps {
  skill: ExtendedSkillInfo;
  isEnabled: boolean;
  isGlobalEnabled: boolean;
  isAdmin: boolean;
  onToggle: () => void;
  onToggleGlobal: () => void;
  onViewDetails: () => void;
  onDeleteSkill?: (skillSlug: string) => void;
  onManageSchema?: (skillSlug: string) => void;
}

export const SkillCard: FC<SkillCardProps> = ({
  skill,
  isEnabled,
  isGlobalEnabled,
  isAdmin,
  onToggle,
  onToggleGlobal,
  onViewDetails,
  onDeleteSkill,
  onManageSchema,
}) => {
  // Determine if this is a user skill (for badge) and if it's deletable (for delete button)
  const isUserSkill = skill.store === 'user';
  const isDeletable = skill.deletable === true; // GitHub-installed skills

  // Query schema status (admin only, lazy load)
  const getSchemaStatus = useServerFn(getSkillSchemaStatusFn);
  const { data: schemaStatusData, isLoading: isLoadingSchema } = useQuery({
    queryKey: ['schema-status', skill.slug],
    queryFn: async () => {
      if (!isAdmin) return null;
      try {
        return await getSchemaStatus({ data: { skillSlug: skill.slug } });
      } catch {
        // If query fails (e.g., not admin), return null
        return null;
      }
    },
    enabled: isAdmin,
    // Only fetch when card is mounted and user is admin
    staleTime: 60000, // Cache for 1 minute
  });

  const schemaStatus: SchemaStatus = schemaStatusData?.status ?? 'missing';

  // Get schema status badge variant and icon
  const getSchemaBadge = () => {
    if (isLoadingSchema) {
      return (
        <Badge variant="outline" className="text-xs">
          <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
          Loading
        </Badge>
      );
    }

    const variants: Record<SchemaStatus, { variant: "default" | "secondary" | "outline" | "destructive"; icon: any }> = {
      missing: { variant: 'secondary', icon: FileJson },
      valid: { variant: 'default', icon: CheckCircle },
      invalid: { variant: 'destructive', icon: FileJson },
      stale: { variant: 'outline', icon: FileJson },
      failed: { variant: 'destructive', icon: FileJson },
    };

    const config = variants[schemaStatus] || variants.missing;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="text-xs" title={`Schema: ${schemaStatus}`}>
        <Icon className="h-3 w-3 mr-1" />
        {schemaStatus}
      </Badge>
    );
  };

  return (
    <div className="group relative rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{skill.name}</h3>
            {isEnabled ? (
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            {/* Schema Status Badge - Admin Only */}
            {isAdmin && getSchemaBadge()}
            {isGlobalEnabled && (
              <Badge
                variant="secondary"
                className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              >
                全局启用中
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground capitalize">
            {skill.category}
            {/* Show badges for skill source */}
            {isUserSkill ? (
              <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                自定义
              </span>
            ) : isDeletable ? (
              <span className="ml-2 text-xs bg-secondary/50 text-secondary-foreground px-2 py-0.5 rounded">
                GitHub
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {/* Description */}
      {skill.description && (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
          {skill.description}
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          variant={isEnabled ? 'outline' : 'default'}
          size="sm"
          onClick={onToggle}
          className="flex-1"
          disabled={isGlobalEnabled}
          title={isGlobalEnabled ? '已全局启用，无法关闭' : undefined}
        >
          {isEnabled ? '禁用' : '启用'}
        </Button>
        {isAdmin && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">全局</span>
            <Switch checked={isGlobalEnabled} onCheckedChange={onToggleGlobal} />
          </div>
        )}
        {/* Schema Manage Button - Admin Only */}
        {isAdmin && onManageSchema && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onManageSchema(skill.slug)}
            className="shrink-0"
            title="管理 Schema"
          >
            <FileJson className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewDetails}
          className="shrink-0"
          title="查看详情"
        >
          <Eye className="h-4 w-4" />
        </Button>
        {/* Delete button: for user skills or GitHub-installed skills (deletable) */}
        {(isUserSkill || isDeletable) && onDeleteSkill && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDeleteSkill(skill.slug)}
            className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            title={isDeletable ? "删除 GitHub 安装的技能" : "删除自定义技能"}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
