/**
 * Permission Settings Component (read-only)
 *
 * Single-organization model: permissions are resolved from environment defaults +
 * the user's system role + an optional per-user bypass whitelist (see
 * permissions.server.ts). They are configured by the deployment admin via env, not
 * editable from this panel — so this section just shows the user their effective
 * permission state.
 */

import * as React from 'react';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import {
  ShieldCheckIcon,
  ShieldIcon,
  InfoIcon,
  TerminalIcon,
} from 'lucide-react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import type { PermissionInfo } from '~/components/claude-chat/permission-badge';

export interface PermissionSettingsSectionProps {
  variant?: 'dialog' | 'page';
  permissionInfo?: PermissionInfo | null;
}

export function PermissionSettingsSection({
  permissionInfo,
}: PermissionSettingsSectionProps) {
  const content = useIntlayer('settings');

  const getModeDisplay = (mode: string) => {
    switch (mode) {
      case 'plan':
        return {
          icon: ShieldCheckIcon,
          description: toLocalizedString(content.permissionModes.descPlan),
          color: 'text-blue-600 dark:text-blue-400',
          bgColor: 'bg-blue-50 dark:bg-blue-950',
          borderColor: 'border-blue-200 dark:border-blue-800',
        };
      case 'dontAsk':
        return {
          icon: ShieldCheckIcon,
          description: toLocalizedString(content.permissionModes.descDontAsk),
          color: 'text-cyan-600 dark:text-cyan-400',
          bgColor: 'bg-cyan-50 dark:bg-cyan-950',
          borderColor: 'border-cyan-200 dark:border-cyan-800',
        };
      case 'acceptEdits':
        return {
          icon: ShieldCheckIcon,
          description: toLocalizedString(content.permissionModes.descAcceptEdits),
          color: 'text-indigo-600 dark:text-indigo-400',
          bgColor: 'bg-indigo-50 dark:bg-indigo-950',
          borderColor: 'border-indigo-200 dark:border-indigo-800',
        };
      case 'bypassPermissions':
        return {
          icon: ShieldIcon,
          description: toLocalizedString(content.permissionModes.descBypass),
          color: 'text-yellow-600 dark:text-yellow-400',
          bgColor: 'bg-yellow-50 dark:bg-yellow-950',
          borderColor: 'border-yellow-200 dark:border-yellow-800',
        };
      default:
        return {
          icon: ShieldCheckIcon,
          description: toLocalizedString(content.permissionModes.descStandard),
          color: 'text-green-600 dark:text-green-400',
          bgColor: 'bg-green-50 dark:bg-green-950',
          borderColor: 'border-green-200 dark:border-green-800',
        };
    }
  };

  const mode = permissionInfo?.mode || 'default';
  const currentModeDisplay = getModeDisplay(mode);
  const CurrentModeIcon = currentModeDisplay.icon;

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <div
        className={`rounded-lg border p-4 ${currentModeDisplay.bgColor} ${currentModeDisplay.borderColor}`}
      >
        <div className="flex items-start gap-3">
          <CurrentModeIcon className={`h-5 w-5 mt-0.5 ${currentModeDisplay.color}`} />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">当前权限模式</h3>
              <Badge variant="outline" className="font-mono text-[11px]">
                {mode}
              </Badge>
              {permissionInfo?.isWhitelisted && (
                <Badge variant="secondary" className="text-[11px]">whitelisted</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{currentModeDisplay.description}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TerminalIcon className="h-3 w-3" />
              <span>Bash {permissionInfo?.bashEnabled ? '已启用' : '已禁用'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Env-configured explanation */}
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          权限由部署管理员通过环境变量配置（<code>CLAUDE_PERMISSION_MODE</code>、
          <code>CLAUDE_ALLOW_BASH</code>、<code>CLAUDE_BYPASS_USER_IDS</code>），并结合你的系统角色生效；
          bypassPermissions 仅对系统管理员或白名单用户开放。如需调整，请联系部署管理员。
        </AlertDescription>
      </Alert>
    </div>
  );
}
