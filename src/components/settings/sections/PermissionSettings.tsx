/**
 * Permission Settings Component
 *
 * Allows organization owners and admins to configure permission modes and tool access
 */

import * as React from 'react';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from '@tanstack/react-router';
import {
  ShieldCheckIcon,
  ShieldAlertIcon,
  ShieldIcon,
  InfoIcon,
} from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import {
  getPermissionInfo,
  updateOrganizationPermissions,
} from '~/server/permissions.server';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { Alert, AlertDescription } from '~/components/ui/alert';
import type { PermissionInfo } from '~/components/claude-chat/permission-badge';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

// All permission modes supported by the SDK
const ALL_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'plan',
  'dontAsk',
  'acceptEdits',
  'bypassPermissions',
];

const permissionSchema = z.object({
  permissionMode: z.enum(ALL_PERMISSION_MODES),
  allowBash: z.boolean(),
});

type PermissionFormValues = z.infer<typeof permissionSchema>;

export interface PermissionSettingsSectionProps {
  variant?: 'dialog' | 'page';
  permissionInfo?: PermissionInfo | null;
}

export function PermissionSettingsSection({
  variant = 'dialog',
  permissionInfo,
}: PermissionSettingsSectionProps) {
  const content = useIntlayer('settings');
  const router = useRouter();
  const updatePermissions = useServerFn(updateOrganizationPermissions);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const form = useForm<PermissionFormValues>({
    resolver: zodResolver(permissionSchema),
    defaultValues: {
      permissionMode: permissionInfo?.mode || 'default',
      allowBash: permissionInfo?.bashEnabled || false,
    },
    values: {
      permissionMode: permissionInfo?.mode || 'default',
      allowBash: permissionInfo?.bashEnabled || false,
    },
  });

  // Watch permission mode to update bash availability
  const watchedPermissionMode = form.watch('permissionMode');
  const isBypassMode = watchedPermissionMode === 'bypassPermissions';

  const canEdit = permissionInfo?.role === 'owner' || permissionInfo?.role === 'admin';

  const onSubmit = async (values: PermissionFormValues) => {
    if (!canEdit || !permissionInfo?.organizationId) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await updatePermissions({
        data: {
          organizationId: permissionInfo.organizationId,
          permissionMode: values.permissionMode,
          allowBash: values.allowBash,
        },
      });

      setSuccess(true);
      await router.invalidate();
    } catch (err) {
      console.error('Failed to update permissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to update permissions');
    } finally {
      setSaving(false);
    }
  };

  const getModeDisplay = (mode: string) => {
    switch (mode) {
      case 'default':
        return {
          icon: ShieldCheckIcon,
          label: toLocalizedString(content.permissionModes.standard),
          description: toLocalizedString(content.permissionModes.descStandard),
          color: 'text-green-600 dark:text-green-400',
          bgColor: 'bg-green-50 dark:bg-green-950',
          borderColor: 'border-green-200 dark:border-green-800',
        };
      case 'plan':
        return {
          icon: ShieldCheckIcon,
          label: toLocalizedString(content.permissionModes.plan),
          description: toLocalizedString(content.permissionModes.descPlan),
          color: 'text-blue-600 dark:text-blue-400',
          bgColor: 'bg-blue-50 dark:bg-blue-950',
          borderColor: 'border-blue-200 dark:border-blue-800',
        };
      case 'dontAsk':
        return {
          icon: ShieldCheckIcon,
          label: toLocalizedString(content.permissionModes.dontAsk),
          description: toLocalizedString(content.permissionModes.descDontAsk),
          color: 'text-cyan-600 dark:text-cyan-400',
          bgColor: 'bg-cyan-50 dark:bg-cyan-950',
          borderColor: 'border-cyan-200 dark:border-cyan-800',
        };
      case 'acceptEdits':
        return {
          icon: ShieldCheckIcon,
          label: toLocalizedString(content.permissionModes.acceptEdits),
          description: toLocalizedString(content.permissionModes.descAcceptEdits),
          color: 'text-indigo-600 dark:text-indigo-400',
          bgColor: 'bg-indigo-50 dark:bg-indigo-950',
          borderColor: 'border-indigo-200 dark:border-indigo-800',
        };
      case 'bypassPermissions':
        return {
          icon: ShieldIcon,
          label: toLocalizedString(content.permissionModes.bypass),
          description: toLocalizedString(content.permissionModes.descBypass),
          color: 'text-yellow-600 dark:text-yellow-400',
          bgColor: 'bg-yellow-50 dark:bg-yellow-950',
          borderColor: 'border-yellow-200 dark:border-yellow-800',
        };
      default:
        return {
          icon: ShieldCheckIcon,
          label: toLocalizedString(content.permissionModes.standard),
          description: toLocalizedString(content.permissionModes.descStandard),
          color: 'text-green-600 dark:text-green-400',
          bgColor: 'bg-green-50 dark:bg-green-950',
          borderColor: 'border-green-200 dark:border-green-800',
        };
    }
  };

  const currentModeDisplay = getModeDisplay(permissionInfo?.mode || 'default');
  const CurrentModeIcon = currentModeDisplay.icon;

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <div
        className={`rounded-lg border p-4 ${currentModeDisplay.bgColor} ${currentModeDisplay.borderColor}`}
      >
        <div className="flex items-start gap-3">
          <CurrentModeIcon className={`h-5 w-5 mt-0.5 ${currentModeDisplay.color}`} />
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">当前权限模式</h3>
              {!canEdit && permissionInfo?.role && (
                <span className="text-xs text-muted-foreground">
                  仅所有者和管理员可编辑
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {currentModeDisplay.description}
            </p>
            {permissionInfo?.organizationId && (
              <p className="text-xs text-muted-foreground">
                组织级别配置 • 角色: {permissionInfo.role}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Edit Form */}
      {canEdit && (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Permission Mode Selector */}
          <div className="space-y-3">
            <Label htmlFor="permissionMode">权限模式</Label>
            <Select
              value={form.watch('permissionMode')}
              onValueChange={(value) =>
                form.setValue('permissionMode', value as PermissionMode)
              }
              disabled={saving}
            >
              <SelectTrigger id="permissionMode">
                <SelectValue placeholder="选择权限模式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-green-600" />
                    <div>
                      <div className="font-medium">Standard</div>
                      <div className="text-xs text-muted-foreground">
                        安全模式，需要权限确认
                      </div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="plan">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-blue-600" />
                    <div>
                      <div className="font-medium">Plan</div>
                      <div className="text-xs text-muted-foreground">
                        规划模式，优先使用 EnterPlanMode
                      </div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="dontAsk">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-cyan-600" />
                    <div>
                      <div className="font-medium">Dont Ask</div>
                      <div className="text-xs text-muted-foreground">
                        自动模式，自动执行安全操作
                      </div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="acceptEdits">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-indigo-600" />
                    <div>
                      <div className="font-medium">Accept Edits</div>
                      <div className="text-xs text-muted-foreground">
                        编辑模式，自动接受文件编辑
                      </div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="bypassPermissions">
                  <div className="flex items-center gap-2">
                    <ShieldIcon className="h-4 w-4 text-yellow-600" />
                    <div>
                      <div className="font-medium">Bypass</div>
                      <div className="text-xs text-muted-foreground">
                        高级模式，跳过权限确认（需管理员权限）
                      </div>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bash Tool Toggle */}
          {isBypassMode && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="allowBash">启用 Bash 工具</Label>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <InfoIcon className="h-3 w-3" />
                    <span>允许 Claude 执行 Shell 命令</span>
                  </div>
                </div>
                <Switch
                  id="allowBash"
                  checked={form.watch('allowBash')}
                  onCheckedChange={(checked) => form.setValue('allowBash', checked)}
                  disabled={saving}
                />
              </div>
            </div>
          )}

          {/* Warning for bypass mode */}
          {isBypassMode && form.watch('allowBash') && (
            <Alert variant="destructive">
              <ShieldAlertIcon className="h-4 w-4" />
              <AlertDescription>
                <strong>警告：</strong> 您正在启用 Bypass + Bash 模式。这将允许 Claude
                执行所有操作而无需权限确认，包括执行 Bash 命令。请确保您信任当前环境。
              </AlertDescription>
            </Alert>
          )}

          {/* Success Message */}
          {success && (
            <Alert variant="success" className="border-green-200 bg-green-50">
              <ShieldCheckIcon className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                权限设置已成功更新。
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !form.formState.isDirty}>
              {saving ? '保存中...' : '保存设置'}
            </Button>
          </div>
        </form>
      )}

      {/* Info Box for non-admins */}
      {!canEdit && permissionInfo?.organizationId && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            只有组织的所有者和管理员可以修改权限设置。如果您需要更改权限，请联系组织管理员。
          </AlertDescription>
        </Alert>
      )}

      {/* Organization Info */}
      {!permissionInfo?.organizationId && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            您当前没有加入任何组织。权限设置从环境变量读取。要使用组织级权限管理，请先创建或加入一个组织。
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
