import { FC } from 'react';
import { Plus, ExternalLink, Trash2, FileJson, RefreshCw, Loader2 } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Switch } from '~/components/ui/switch';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import type { ExtendedSkillInfo } from '~/claude/skills';
import { toLocalizedString } from '~/lib/utils';
import { cn } from '~/lib/utils';

interface SkillListItemProps {
  skill: ExtendedSkillInfo;
  isEnabled: boolean;
  isGlobalEnabled: boolean;
  isAdmin: boolean;
  onToggle: () => void;
  onToggleGlobal: () => void;
  onViewDetails: () => void;
  onDeleteSkill?: (skillSlug: string) => void;
  onManageSchema?: (skillSlug: string) => void;
  onRegenerateIcon?: (skillSlug: string) => void;
  regeneratingIcon?: boolean;
}

export const SkillListItem: FC<SkillListItemProps> = ({
  skill,
  isEnabled,
  isGlobalEnabled,
  isAdmin,
  onToggle,
  onToggleGlobal,
  onViewDetails,
  onDeleteSkill,
  onManageSchema,
  onRegenerateIcon,
  regeneratingIcon,
}) => {
  const content = useIntlayer('skills');

  // Only user-uploaded skills can be deleted (not official, not github-installed)
  const isUserSkill = skill.store === 'user';
  const canDelete = isUserSkill;

  return (
    <div
      className={cn(
        "group flex items-center gap-4 px-4 py-3 rounded-lg transition-colors cursor-pointer",
        "border border-border/50 hover:border-border hover:bg-muted/50"
      )}
      onClick={onViewDetails}
    >
      {/* Icon */}
      <LetterAvatar name={skill.name} iconUrl={skill.iconUrl} size="md" className="shrink-0" />

      {/* Content - flex-1 to take remaining space */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-base truncate">{skill.name}</h3>
          {isUserSkill && (
            <Badge variant="outline" className="text-xs shrink-0">
              {content.card.custom}
            </Badge>
          )}
        </div>
        {skill.description && (
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {skill.description}
          </p>
        )}
      </div>

      {/* Actions - stop propagation to prevent triggering onViewDetails */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Admin only: Global toggle */}
        {isAdmin && (
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">{content.card.globalLabel}</span>
            <Switch
              checked={isGlobalEnabled}
              onCheckedChange={onToggleGlobal}
              className="scale-90"
            />
          </div>
        )}

        {/* Admin only: Schema manage */}
        {isAdmin && onManageSchema && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onManageSchema(skill.slug)}
            title={toLocalizedString(content.card.manageSchemaTitle)}
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <FileJson className="h-4 w-4" />
          </Button>
        )}

        {/* Admin only: Regenerate Icon button */}
        {isAdmin && onRegenerateIcon && skill.description && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRegenerateIcon(skill.slug)}
            disabled={regeneratingIcon}
            title={toLocalizedString(content.card.regenerateIconTitle)}
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {regeneratingIcon ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        )}

        {/* Delete button - only for user-uploaded skills */}
        {canDelete && onDeleteSkill && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDeleteSkill(skill.slug)}
            title={toLocalizedString(content.card.deleteCustomTitle)}
            className="h-8 w-8 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}

        {/* Main action button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={isEnabled ? onViewDetails : onToggle}
          disabled={isGlobalEnabled && !isEnabled}
          className="h-8 w-8"
          title={isEnabled ? toLocalizedString(content.card.viewDetailsTitle) : toLocalizedString(content.card.enableButton)}
        >
          {isEnabled ? (
            <ExternalLink className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
