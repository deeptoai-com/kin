/**
 * Permission Badge Component
 *
 * Displays current permission mode and Bash status
 * with ability to view details
 */

'use client';

import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useIntlayer } from 'react-intlayer';
import { InfoIcon, ShieldIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { toLocalizedString } from '~/lib/utils';

// Permission modes
export type PermissionMode =
  | 'default'
  | 'plan'
  | 'dontAsk'
  | 'acceptEdits'
  | 'delegate'
  | 'bypassPermissions';

// Permission info interface
export interface PermissionInfo {
  mode: PermissionMode;
  bashEnabled: boolean;
  isWhitelisted: boolean;
  disallowedTools: string[];
  userId?: string | null;
  organizationId?: string | null;
  role?: string | null;
}

// Props
interface PermissionBadgeProps {
  permissionInfo: PermissionInfo | null;
}

// Get permission mode display info
const getModeDisplay = (mode: PermissionMode, bashEnabled: boolean) => {
  switch (mode) {
    case 'default':
      return {
        icon: ShieldCheckIcon,
        label: 'Standard',
        description: '安全模式：需要权限确认',
        color: 'text-success',
        bgColor: 'bg-success/10',
        borderColor: 'border-success/30',
      };
    case 'plan':
      return {
        icon: ShieldCheckIcon,
        label: 'Plan',
        description: '规划模式：优先使用 EnterPlanMode',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
        borderColor: 'border-border',
      };
    case 'dontAsk':
      return {
        icon: ShieldCheckIcon,
        label: 'Dont Ask',
        description: '自动模式：自动执行安全操作',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
        borderColor: 'border-border',
      };
    case 'acceptEdits':
      return {
        icon: ShieldCheckIcon,
        label: 'Accept Edits',
        description: '编辑模式：自动接受文件编辑',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
        borderColor: 'border-border',
      };
    case 'delegate':
      return {
        icon: ShieldCheckIcon,
        label: 'Delegate',
        description: '委托模式：允许委派任务',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
        borderColor: 'border-border',
      };
    case 'bypassPermissions':
      if (bashEnabled) {
        return {
          icon: ShieldAlertIcon,
          label: 'Bypass + Bash',
          description: '高级模式：无确认 + Bash 命令',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/30',
        };
      }
      return {
        icon: ShieldIcon,
        label: 'Bypass',
        description: '高级模式：无权限确认',
        color: 'text-destructive',
        bgColor: 'bg-destructive/10',
        borderColor: 'border-destructive/30',
      };
    default:
      return {
        icon: ShieldCheckIcon,
        label: 'Standard',
        description: '安全模式：需要权限确认',
        color: 'text-success',
        bgColor: 'bg-success/10',
        borderColor: 'border-success/30',
      };
  }
};

export const PermissionBadge: FC<PermissionBadgeProps> = ({ permissionInfo }) => {
  const content = useIntlayer('claude-chat');
  const [showDetails, setShowDetails] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Default to safe mode if no info
  const info: PermissionInfo = permissionInfo || {
    mode: 'default',
    bashEnabled: false,
    isWhitelisted: false,
    disallowedTools: ['Bash'],
  };

  const display = getModeDisplay(info.mode, info.bashEnabled);
  const Icon = display.icon;
  const isClient = typeof document !== 'undefined';

  const updatePanelPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? 288;
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
    const left = Math.min(Math.max(rect.left, margin), maxLeft);
    setPanelPosition({ top: rect.top, left });
  }, []);

  useEffect(() => {
    if (!showDetails || !isClient) return;
    updatePanelPosition();
    const handleScroll = () => updatePanelPosition();
    const handleResize = () => updatePanelPosition();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [showDetails, isClient, updatePanelPosition]);

  useEffect(() => {
    if (!showDetails || !isClient) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setShowDetails(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDetails(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showDetails, isClient]);

  return (
    <div className="relative">
      {/* Main Badge */}
      <button
        type="button"
        ref={buttonRef}
        onClick={() => {
          setShowDetails(!showDetails);
        }}
        className={`
          group flex items-center gap-2 rounded-lg border px-3 py-1.5
          transition-all duration-200
          ${display.bgColor} ${display.borderColor} ${display.color}
          cursor-pointer hover:opacity-80
        `}
        title={display.description}
      >
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold">{display.label}</span>

        {/* Bash status indicator */}
        {!info.bashEnabled && (
          <span className="text-xs opacity-75" title={toLocalizedString(content.sessionInfo.bashDisabled)}>
            🔒
          </span>
        )}

        {/* Info icon for details */}
        <InfoIcon className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
      </button>

      {/* Details Panel */}
      {showDetails && isClient && createPortal(
        <div
          ref={panelRef}
          style={{
            top: panelPosition.top,
            left: panelPosition.left,
            transform: 'translateY(calc(-100% - 8px))',
          }}
          className={`
            fixed z-[9999] w-72 rounded-lg border bg-card p-4 shadow-lg
            ${display.borderColor}
          `}
        >
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-foreground">
              <Icon className="h-4 w-4" />
              <span className="text-sm">权限模式</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="rounded p-1 text-muted-foreground transition hover:bg-accent"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="space-y-3 text-sm">
            {/* Current Mode */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">当前模式</span>
              <span className={`font-semibold ${display.color}`}>{display.label}</span>
            </div>

            {/* Bash Status */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Bash 工具</span>
              <span className={`font-semibold ${info.bashEnabled ? 'text-success' : 'text-destructive'}`}>
                {info.bashEnabled ? '✅ 已启用' : '❌ 已禁用'}
              </span>
            </div>

            {/* Whitelist Status */}
            {info.mode === 'bypassPermissions' && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">白名单用户</span>
                <span className={`font-semibold ${info.isWhitelisted ? 'text-success' : 'text-destructive'}`}>
                  {info.isWhitelisted ? '✅ 是' : '❌ 否'}
                </span>
              </div>
            )}

            {/* Disallowed Tools */}
            {info.disallowedTools.length > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground">禁用工具</span>
                <div className="flex flex-wrap gap-1">
                  {info.disallowedTools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Security Info */}
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {info.mode === 'default' && (
                <>
                  <p className="mb-2">🟢 <strong>标准安全模式</strong></p>
                  <p className="mb-1">• 需要权限确认才能执行危险操作</p>
                  <p className="mb-1">• Bash 工具默认禁用</p>
                  <p>• 路径级安全边界已启用</p>
                </>
              )}

              {info.mode === 'plan' && (
                <>
                  <p className="mb-2">🔵 <strong>Plan 模式</strong></p>
                  <p className="mb-1">• 提示使用 EnterPlanMode 进行规划</p>
                  <p className="mb-1">• Bash 工具默认禁用</p>
                  <p>• 路径级安全边界已启用</p>
                </>
              )}

              {info.mode === 'dontAsk' && (
                <>
                  <p className="mb-2">🟦 <strong>Dont Ask 模式</strong></p>
                  <p className="mb-1">• 自动执行安全操作</p>
                  <p className="mb-1">• Bash 工具默认禁用</p>
                  <p>• 路径级安全边界已启用</p>
                </>
              )}

              {info.mode === 'acceptEdits' && (
                <>
                  <p className="mb-2">🟣 <strong>Accept Edits 模式</strong></p>
                  <p className="mb-1">• 自动接受文件编辑</p>
                  <p className="mb-1">• Bash 工具默认禁用</p>
                  <p>• 路径级安全边界已启用</p>
                </>
              )}

              {info.mode === 'delegate' && (
                <>
                  <p className="mb-2">🟪 <strong>Delegate 模式</strong></p>
                  <p className="mb-1">• 允许委派任务执行</p>
                  <p className="mb-1">• Bash 工具默认禁用</p>
                  <p>• 路径级安全边界已启用</p>
                </>
              )}

              {info.mode === 'bypassPermissions' && !info.bashEnabled && (
                <>
                  <p className="mb-2">🟡 <strong>高级模式（Bash 禁用）</strong></p>
                  <p className="mb-1">• 跳过权限确认</p>
                  <p className="mb-1">• Bash 工具已禁用</p>
                  <p>• 仅限白名单用户</p>
                </>
              )}

              {info.mode === 'bypassPermissions' && info.bashEnabled && (
                <>
                  <p className="mb-2">🔴 <strong>高级模式（Bash 启用）</strong></p>
                  <p className="mb-1">• 跳过所有权限检查</p>
                  <p className="mb-1">• Bash 工具已启用</p>
                  <p>• 谨慎使用，确保信任环境</p>
                </>
              )}
            </div>

          </div>
        </div>
      , document.body)}
    </div>
  );
};
