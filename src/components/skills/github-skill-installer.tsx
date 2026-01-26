import { FC, useState, useCallback } from 'react';
import { Github, Loader2, X, Terminal, CheckCircle2, AlertCircle, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { useServerFn } from '@tanstack/react-start';
import { installGitHubSkillFn, checkGitHubSkillCompatibilityFn } from '~/server/function/skills.server';

interface GitHubSkillInstallerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface InstallResult {
  success: boolean;
  skill?: {
    slug: string;
    name?: string;
    description?: string | null;
    category?: string;
    source?: {
      type: string;
      owner: string;
      repo: string;
      commitSha: string | null;
    };
  };
  error?: string;
}

interface CompatibilityWarning {
  compatible: boolean;
  formattedWarnings: string[];
  rawWarnings: string[];
}

/**
 * GitHub Skills Installer Component
 *
 * Admin-only component for installing skills from GitHub repositories.
 * Supports the npx skills add command format:
 *
 *   npx skills add https://github.com/owner/repo --skill skill-name
 *   npx skills add owner/repo -s skill-name
 *   npx skills add github.com/owner/repo --skill skill-name
 *
 * Features:
 * - Real-time command parsing and validation
 * - Visual preview of parsed results
 * - Installation progress feedback
 * - Error handling with detailed messages
 */
export const GitHubSkillInstaller: FC<GitHubSkillInstallerProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  // Server Functions
  const checkCompatibility = useServerFn(checkGitHubSkillCompatibilityFn);
  const installSkill = useServerFn(installGitHubSkillFn);

  // Form state
  const [command, setCommand] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [compatibilityWarning, setCompatibilityWarning] = useState<CompatibilityWarning | null>(null);
  const [hasCheckedCompatibility, setHasCheckedCompatibility] = useState(false);
  const [parseResult, setParseResult] = useState<{
    valid: boolean;
    url?: string;
    skillName?: string;
    owner?: string;
    repo?: string;
    error?: string;
  } | null>(null);

  // Parse command on change
  const handleCommandChange = useCallback((value: string) => {
    setCommand(value);
    setInstallResult(null);
    setCompatibilityWarning(null);
    setHasCheckedCompatibility(false);

    if (!value.trim()) {
      setParseResult(null);
      return;
    }

    // Client-side preview parsing (basic validation)
    // Full parsing happens on server for security
    const trimmed = value.trim();
    const patterns = [
      // Full format: npx skills add <source> --skill <name>
      /^npx\s+skills\s+add\s+(\S+)\s+(?:--skill|-s)\s+(\S+)$/i,
      // Simplified format: <source> --skill <name>
      /^(\S+)\s+(?:--skill|-s)\s+(\S+)$/i,
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const urlInput = match[1];
        const skillName = match[2];

        // Basic URL validation (will be re-validated on server)
        let url = urlInput;
        if (urlInput.startsWith('github.com/')) {
          url = `https://${urlInput}`;
        } else if (!urlInput.startsWith('https://') && /^[^\/]+\/[^\/]+$/.test(urlInput)) {
          url = `https://github.com/${urlInput}`;
        }

        try {
          const parsed = new URL(url);
          if (parsed.hostname === 'github.com') {
            const pathMatch = parsed.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
            if (pathMatch) {
              setParseResult({
                valid: true,
                url,
                skillName,
                owner: pathMatch[1],
                repo: pathMatch[2].replace(/\.git$/, ''),
              });
              return;
            }
          }
        } catch {
          // Invalid URL, continue
        }
      }
    }

    // Invalid command
    setParseResult({
      valid: false,
      error: '命令格式无效。请使用：npx skills add <仓库地址> --skill <技能名称>',
    });
  }, []);

  // Handle install
  const handleInstall = async () => {
    if (!command.trim() || !parseResult?.valid || !parseResult.url) {
      setInstallResult({
        success: false,
        error: '请输入有效的安装命令',
      });
      return;
    }

    const runInstall = async () => {
      setIsInstalling(true);
      setInstallResult(null);

      try {
        const result = await installSkill({
          data: {
            repoUrl: parseResult.url,
            skillName: parseResult.skillName || 'skill',
          },
        });

        setInstallResult({ success: true, skill: result });

        // Auto-close on success after short delay
        setTimeout(() => {
          onOpenChange(false);
          onSuccess?.();
          handleReset();
        }, 1500);
      } catch (err) {
        setInstallResult({
          success: false,
          error: err instanceof Error ? err.message : '安装失败',
        });
      } finally {
        setIsInstalling(false);
      }
    };

    // Step 1: Check compatibility first
    if (!hasCheckedCompatibility) {
      setIsChecking(true);
      try {
        const checkResult = await checkCompatibility({
          data: {
            repoUrl: parseResult.url,
            skillName: parseResult.skillName || 'skill',
          },
        });
        setCompatibilityWarning(checkResult);
        setHasCheckedCompatibility(true);

        // If no warnings, proceed immediately to installation to avoid double-click confusion.
        if (checkResult.compatible && checkResult.formattedWarnings.length === 0) {
          return await runInstall();
        }
        return;
      } catch (err) {
        setCompatibilityWarning(null);
        setInstallResult({
          success: false,
          error: err instanceof Error ? err.message : '兼容性检查失败',
        });
      } finally {
        setIsChecking(false);
      }
      return;
    }

    // Step 2: Proceed with installation
    await runInstall();
  };

  // Reset to check compatibility again (e.g., after command change)
  const handleRecheck = () => {
    setCompatibilityWarning(null);
    setHasCheckedCompatibility(false);
    setInstallResult(null);
  };

  // Reset state
  const handleReset = () => {
    setCommand('');
    setParseResult(null);
    setInstallResult(null);
    setCompatibilityWarning(null);
    setHasCheckedCompatibility(false);
  };

  // Handle close
  const handleClose = () => {
    if (!isInstalling && !isChecking) {
      onOpenChange(false);
      setTimeout(handleReset, 100); // Reset after animation
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            从 GitHub 安装技能
          </DialogTitle>
          <DialogDescription>
            使用 npx skills add 命令格式从 GitHub 仓库安装技能
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Command Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              安装命令
            </label>
            <div className="relative">
              <Terminal className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={command}
                onChange={(e) => handleCommandChange(e.target.value)}
                placeholder="npx skills add owner/repo --skill skill-name"
                className="pl-9 font-mono text-sm"
                disabled={isInstalling}
                autoFocus
              />
              {command && (
                <button
                  onClick={() => handleCommandChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Command Format Help */}
            <div className="text-xs text-muted-foreground space-y-1">
              <p>支持的格式：</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li><code className="bg-muted px-1 rounded">npx skills add owner/repo --skill skill-name</code></li>
                <li><code className="bg-muted px-1 rounded">npx skills add https://github.com/owner/repo -s name</code></li>
              </ul>
            </div>
          </div>

          {/* Parse Result Preview */}
          {parseResult && (
            <div className={`
              rounded-lg border p-3 text-sm
              ${parseResult.valid
                ? 'border-green-500/50 bg-green-500/10'
                : 'border-destructive/50 bg-destructive/10'
              }
            `}>
              {parseResult.valid ? (
                <div className="space-y-1">
                  <p className="font-medium text-green-600 dark:text-green-400">
                    解析成功
                  </p>
                  <div className="text-xs space-y-0.5 text-muted-foreground">
                    <p>仓库：{parseResult.owner}/{parseResult.repo}</p>
                    <p>技能名称：{parseResult.skillName}</p>
                  </div>
                </div>
              ) : (
                <p className="text-destructive">
                  {parseResult.error}
                </p>
              )}
            </div>
          )}

          {/* Compatibility Warnings */}
          {compatibilityWarning && compatibilityWarning.formattedWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <TriangleAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium text-amber-600 dark:text-amber-400">
                    兼容性警告
                  </p>
                  <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                    {compatibilityWarning.formattedWarnings.map((warning, idx) => (
                      <p key={idx}>{warning}</p>
                    ))}
                  </div>
                  <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
                    建议谨慎安装。如仍要安装，请再次点击"安装"按钮继续。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Install Result */}
          {installResult && (
            <div className={`
              rounded-lg border p-3 text-sm
              ${installResult.success
                ? 'border-green-500/50 bg-green-500/10'
                : 'border-destructive/50 bg-destructive/10'
              }
            `}>
              {installResult.success ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-green-600 dark:text-green-400">
                      安装成功
                    </p>
                    {installResult.skill && (
                      <p className="text-xs text-muted-foreground">
                        技能 <strong>{installResult.skill.name || installResult.skill.slug}</strong>
                        已添加到技能库
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">
                      安装失败
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {installResult.error}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            {compatibilityWarning && compatibilityWarning.formattedWarnings.length > 0 && (
              <Button
                variant="outline"
                onClick={handleRecheck}
                disabled={isInstalling}
              >
                重新检查
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isInstalling || isChecking}
            >
              取消
            </Button>
            <Button
              onClick={handleInstall}
              disabled={!command.trim() || !parseResult?.valid || isChecking || isInstalling || installResult?.success}
              className="min-w-[100px]"
            >
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  检查中...
                </>
              ) : isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  安装中...
                </>
              ) : installResult?.success ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  完成
                </>
              ) : hasCheckedCompatibility && compatibilityWarning?.formattedWarnings.length > 0 ? (
                <>
                  <AlertCircle className="h-4 w-4 mr-2" />
                  仍然安装
                </>
              ) : (
                <>
                  <Github className="h-4 w-4 mr-2" />
                  安装
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
