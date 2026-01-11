import { FC } from 'react';
import { CheckCircle, Circle, Eye, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import type { ExtendedSkillInfo } from '~/claude/skills';

interface SkillCardProps {
  skill: ExtendedSkillInfo;
  isEnabled: boolean;
  onToggle: () => void;
  onViewDetails: () => void;
  onDeleteSkill?: (skillSlug: string) => void;
}

export const SkillCard: FC<SkillCardProps> = ({
  skill,
  isEnabled,
  onToggle,
  onViewDetails,
  onDeleteSkill,
}) => {
  // Determine if this is a user skill (for badge and delete button)
  const isUserSkill = skill.store === 'user';

  return (
    <div className="group relative rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{skill.name}</h3>
            {isEnabled ? (
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground capitalize">
            {skill.category}
            {/* Show "自定义" badge for user skills */}
            {isUserSkill && (
              <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                自定义
              </span>
            )}
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
        >
          {isEnabled ? '禁用' : '启用'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewDetails}
          className="shrink-0"
          title="查看详情"
        >
          <Eye className="h-4 w-4" />
        </Button>
        {/* Delete button: only for user skills */}
        {isUserSkill && onDeleteSkill && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDeleteSkill(skill.slug)}
            className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="删除技能"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
