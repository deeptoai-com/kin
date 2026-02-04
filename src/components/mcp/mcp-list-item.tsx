import { FC } from 'react';
import { Plus, ExternalLink, Trash2, ShieldCheck, Loader2, Globe, User } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import type { ExtendedMcpInfo } from '~/claude/mcp';
import { toLocalizedString } from '~/lib/utils';
import { cn } from '~/lib/utils';

interface McpListItemProps {
  mcp: ExtendedMcpInfo;
  isEnabled: boolean;
  onToggle: () => void;
  onViewDetails: () => void;
  onVerify: () => void;
  onDelete?: () => void;
  verifying?: boolean;
  deleting?: boolean;
}

export const McpListItem: FC<McpListItemProps> = ({
  mcp,
  isEnabled,
  onToggle,
  onViewDetails,
  onVerify,
  onDelete,
  verifying,
  deleting,
}) => {
  const content = useIntlayer('mcp');

  // Determine store type
  const isSystem = mcp.store === 'system';
  const isPersonal = mcp.store === 'user';
  const isCustom = isSystem || isPersonal;

  return (
    <div
      className={cn(
        "group flex items-center gap-4 px-4 py-3 rounded-lg transition-colors cursor-pointer",
        "border border-border/50 hover:border-border hover:bg-muted/50"
      )}
      onClick={onViewDetails}
    >
      {/* Icon */}
      <LetterAvatar name={mcp.name} iconUrl={mcp.iconUrl} size="md" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm truncate">{mcp.name}</h3>
          {isSystem && (
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              <Globe className="mr-1 h-3 w-3" />
              {content.card.systemBadge}
            </Badge>
          )}
          {isPersonal && (
            <Badge variant="secondary" className="text-xs">
              <User className="mr-1 h-3 w-3" />
              {content.card.personalBadge}
            </Badge>
          )}
        </div>
        {mcp.description && (
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {mcp.description}
          </p>
        )}
      </div>

      {/* Actions - stop propagation to prevent triggering onViewDetails */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {/* Verify button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onVerify}
          disabled={verifying}
          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
          title={toLocalizedString(content.card.verifyMcp)}
        >
          {verifying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
        </Button>

        {/* Delete button - only for custom MCPs (system or personal) */}
        {isCustom && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={deleting}
            className="h-8 w-8 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            title={toLocalizedString(content.card.deleteMcp)}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        )}

        {/* Main action button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={isEnabled ? onViewDetails : onToggle}
          className="h-8 w-8"
          title={isEnabled ? toLocalizedString(content.card.viewDetails) : toLocalizedString(content.card.enable)}
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
