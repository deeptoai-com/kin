/**
 * MCP Detail Dialog
 *
 * Redesigned to match Skills detail dialog visual style:
 * - Large icon header with name and description
 * - Tabs: About / Configure / Tools
 * - Full markdown rendering for readme
 * - Code syntax highlighting for config
 * - Modern UI with backdrop blur and shadows
 */

import { type FC, useState, useEffect, useMemo } from 'react';
import { useIntlayer } from 'react-intlayer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import {
  X,
  RefreshCw,
  Info,
  Settings,
  Wrench,
  Loader2,
  CheckIcon,
  Globe,
  User,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Switch } from '~/components/ui/switch';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge } from '~/components/ui/badge';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import { cn, toLocalizedString } from '~/lib/utils';
import { useServerFn } from '@tanstack/react-start';
import type { McpDetail, CredentialField } from '~/claude/mcp';
import {
  enableMcpServerFn,
  disableMcpServerFn,
  getMcpCredentialsFn,
  setMcpCredentialsFn,
  getAllowedToolsOverrideFn,
  setAllowedToolsOverrideFn,
  getMcpToolsFn,
  listMcpStore,
} from '~/server/function/mcp.server';

type TabId = 'about' | 'configure' | 'tools';

interface McpDetailDialogProps {
  mcp: McpDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle?: (slug: string, enabled: boolean) => void;
}

export const McpDetailDialog: FC<McpDetailDialogProps> = ({
  mcp,
  isOpen,
  onClose,
  onToggle,
}) => {
  const content = useIntlayer('mcp');
  const [activeTab, setActiveTab] = useState<TabId>('about');
  const [isEnabled, setIsEnabled] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const enableMcp = useServerFn(enableMcpServerFn);
  const disableMcp = useServerFn(disableMcpServerFn);

  // Sync enabled state when mcp changes
  useEffect(() => {
    if (mcp) {
      setIsEnabled(mcp.enabled);
      setActiveTab('about');
    }
  }, [mcp?.slug]);

  if (!isOpen || !mcp) {
    return null;
  }

  const handleToggleEnabled = async () => {
    setIsToggling(true);
    try {
      if (isEnabled) {
        await disableMcp({ data: { slug: mcp.slug } });
      } else {
        await enableMcp({ data: { slug: mcp.slug } });
      }
      setIsEnabled(!isEnabled);
      onToggle?.(mcp.slug, !isEnabled);
    } catch (error) {
      console.error('Failed to toggle MCP:', error);
    } finally {
      setIsToggling(false);
    }
  };

  const tabs: { id: TabId; labelKey: keyof typeof content.detailDialog.tabs; icon: FC<{ className?: string }> }[] = [
    { id: 'about', labelKey: 'about', icon: Info },
    { id: 'configure', labelKey: 'configure', icon: Settings },
    { id: 'tools', labelKey: 'tools', icon: Wrench },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - MCP Info with Large Icon */}
        <div className="flex items-stretch border-b">
          {/* Large Icon Area - matches header height, no background */}
          <div className="flex items-center justify-center p-6">
            {mcp.iconUrl ? (
              <img
                src={mcp.iconUrl}
                alt={mcp.name}
                className="w-32 h-32 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div
              className={cn(
                "w-32 h-32 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-4xl font-bold text-primary",
                mcp.iconUrl && "hidden"
              )}
            >
              {mcp.name.charAt(0).toUpperCase()}
            </div>
          </div>

          {/* Title & Description */}
          <div className="flex-1 flex flex-col justify-center px-8 py-6">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h2 className="text-2xl font-bold tracking-tight">{mcp.name}</h2>
              {/* Status Badge */}
              <Badge
                variant={isEnabled ? 'default' : 'secondary'}
                className={cn(
                  'text-xs',
                  isEnabled
                    ? 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'
                    : ''
                )}
              >
                {isEnabled ? content.detailDialog.enabled : content.detailDialog.disabled}
              </Badge>
              {/* Store Badge */}
              {mcp.store === 'system' && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Globe className="h-3 w-3" />
                  {content.detailDialog.storeBadge.system}
                </Badge>
              )}
              {mcp.store === 'user' && (
                <Badge variant="outline" className="text-xs gap-1">
                  <User className="h-3 w-3" />
                  {content.detailDialog.storeBadge.personal}
                </Badge>
              )}
            </div>
            {mcp.description && (
              <p className="text-base text-muted-foreground max-w-2xl leading-relaxed">
                {mcp.description}
              </p>
            )}
          </div>

          {/* Close Button */}
          <div className="p-4">
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Tabs and Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar tabs */}
          <div className="w-52 border-r bg-muted/30 p-3">
            <div className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
                      activeTab === tab.id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {content.detailDialog.tabs[tab.labelKey]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'about' && <AboutTab mcp={mcp} />}
            {activeTab === 'configure' && <ConfigureTab mcp={mcp} />}
            {activeTab === 'tools' && <ToolsTab mcp={mcp} />}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4 bg-muted/20">
          <Button
            variant={isEnabled ? 'outline' : 'default'}
            onClick={handleToggleEnabled}
            disabled={isToggling}
            className={cn(
              isEnabled && 'text-destructive hover:text-destructive hover:bg-destructive/10'
            )}
          >
            {isToggling && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEnabled ? content.detailDialog.uninstall : content.detailDialog.install}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// About Tab
// ============================================================================

const AboutTab: FC<{ mcp: McpDetail }> = ({ mcp }) => {
  const content = useIntlayer('mcp');
  const [copied, setCopied] = useState(false);

  // Generate MCP config JSON for display
  const mcpConfigJson = mcp.mcp
    ? JSON.stringify({ mcpServers: { [mcp.slug]: formatMcpConfig(mcp.mcp) } }, null, 2)
    : null;

  const handleCopyConfig = async () => {
    if (mcpConfigJson) {
      await navigator.clipboard.writeText(mcpConfigJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Readme content - Markdown rendered */}
      {mcp.readme ? (
        <div className="prose prose-sm dark:prose-invert max-w-none
          prose-headings:font-semibold prose-headings:tracking-tight
          prose-h1:text-2xl prose-h1:border-b prose-h1:pb-2 prose-h1:mb-4
          prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-3
          prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-2
          prose-p:leading-relaxed prose-p:my-3
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
          prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-[#282c34] prose-pre:rounded-lg prose-pre:p-0 prose-pre:my-4
          prose-ul:my-2 prose-ol:my-2
          prose-li:my-0.5
          prose-blockquote:border-l-primary prose-blockquote:bg-muted/50 prose-blockquote:py-1 prose-blockquote:pr-4 prose-blockquote:rounded-r
        ">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;

                if (isInline) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }

                const language = match ? match[1] : 'text';
                const codeString = String(children).replace(/\n$/, '');

                return (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={language}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                );
              },
            }}
          >
            {mcp.readme}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="text-muted-foreground italic py-8 text-center">
          {content.detailDialog.about.noDocs}
        </div>
      )}

      {/* MCP Config - with syntax highlighting */}
      {mcpConfigJson && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {content.detailDialog.about.configuration}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyConfig}
              className="h-8 gap-1.5 text-xs"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {content.detailDialog.about.copied}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  {content.detailDialog.about.copy}
                </>
              )}
            </Button>
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language="json"
            customStyle={{
              margin: 0,
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
          >
            {mcpConfigJson}
          </SyntaxHighlighter>
        </div>
      )}

      {/* Tools list (read-only summary) */}
      {mcp.allowedTools && mcp.allowedTools.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {content.detailDialog.about.tools}
          </h3>
          <div className="flex flex-wrap gap-2">
            {mcp.allowedTools.map((tool) => (
              <Badge key={tool} variant="secondary" className="font-mono text-xs">
                {extractToolName(tool)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function formatMcpConfig(mcp: McpDetail['mcp']) {
  if (!mcp) return {};
  if (mcp.type === 'stdio') {
    return {
      command: mcp.command,
      ...(mcp.args && { args: mcp.args }),
    };
  }
  if (mcp.type === 'sse' || mcp.type === 'http') {
    return {
      type: mcp.type,
      url: mcp.url,
    };
  }
  return { type: mcp.type };
}

function extractToolName(fullName: string): string {
  // mcp__name__tool -> tool
  const parts = fullName.split('__');
  return parts.length >= 3 ? parts.slice(2).join('__') : fullName;
}

// ============================================================================
// Configure Tab
// ============================================================================

const ConfigureTab: FC<{ mcp: McpDetail }> = ({ mcp }) => {
  const content = useIntlayer('mcp');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCredentials = useServerFn(getMcpCredentialsFn);
  const setCredentialsFn = useServerFn(setMcpCredentialsFn);

  const credentialFields = mcp.credentials || [];
  const hasCredentials = credentialFields.length > 0;

  useEffect(() => {
    if (hasCredentials) {
      loadCredentials();
    } else {
      setLoading(false);
    }
  }, [mcp.slug]);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const result = await getCredentials({ data: { slug: mcp.slug } });
      setCredentials(result || {});
    } catch (err) {
      console.error('Failed to load credentials:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await setCredentialsFn({ data: { slug: mcp.slug, credentials } });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : toLocalizedString(content.detailDialog.configure.saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!hasCredentials) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <Settings className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{toLocalizedString(content.detailDialog.configure.noConfig).replace('{name}', mcp.name)}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {content.detailDialog.configure.loading}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-5">
        {credentialFields.map((field: CredentialField) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={field.key} className="flex items-center gap-2 text-sm font-medium">
              {field.label}
              {field.required && <span className="text-destructive">*</span>}
            </Label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}
            <Input
              id={field.key}
              type={field.sensitive ? 'password' : 'text'}
              value={credentials[field.key] || ''}
              onChange={(e) =>
                setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              placeholder={field.sensitive ? '••••••••' : toLocalizedString(content.detailDialog.configure.enterPlaceholder).replace('{label}', field.label)}
              className="font-mono"
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {saving ? content.detailDialog.configure.saving : content.detailDialog.configure.saveButton}
        </Button>
        {saveSuccess && (
          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
            <CheckIcon className="h-4 w-4" />
            {content.detailDialog.configure.saved}
          </span>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Tools Tab
// ============================================================================

interface McpTool {
  name: string;
  description: string;
  fullName: string;
}

interface ToolState {
  tool: McpTool;
  allowed: boolean;
}

const ToolsTab: FC<{ mcp: McpDetail }> = ({ mcp }) => {
  const content = useIntlayer('mcp');
  const [toolStates, setToolStates] = useState<ToolState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const getMcpTools = useServerFn(getMcpToolsFn);
  const getAllowedToolsOverride = useServerFn(getAllowedToolsOverrideFn);
  const setAllowedToolsOverride = useServerFn(setAllowedToolsOverrideFn);
  const getMcpStore = useServerFn(listMcpStore);

  useEffect(() => {
    loadTools();
  }, [mcp.slug]);

  const loadTools = async () => {
    setLoading(true);
    setError(null);
    setConnectionError(null);

    try {
      // Get MCP info for default allowedTools
      const mcpStore = await getMcpStore({});
      if (!mcpStore || !Array.isArray(mcpStore)) {
        setError(toLocalizedString(content.detailDialog.tools.loadError));
        return;
      }

      const mcpInfo = mcpStore.find(
        (m) => m && typeof m === 'object' && 'slug' in m && m.slug === mcp.slug
      ) as { slug: string; allowedTools?: string[] } | undefined;
      const defaultAllowedTools = mcpInfo?.allowedTools || mcp.allowedTools || null;

      // Try to fetch tool list from MCP server
      let fetchedTools: McpTool[] = [];
      let fetchError: string | null = null;

      try {
        const toolsResult = await getMcpTools({ data: { slug: mcp.slug } });
        if (toolsResult?.ok) {
          fetchedTools = toolsResult.tools || [];
        } else {
          fetchError = toolsResult?.error || content.detailDialog.tools.connectionError;
        }
      } catch (err) {
        fetchError = err instanceof Error ? err.message : content.detailDialog.tools.connectionError;
      }

      // If connection failed, use predefined tools from MCP.md
      if (fetchedTools.length === 0 && defaultAllowedTools && defaultAllowedTools.length > 0) {
        // Convert allowedTools strings to McpTool objects
        fetchedTools = defaultAllowedTools.map((fullName) => {
          const toolName = extractToolName(fullName);
          return {
            name: toolName,
            description: `Tool from ${mcp.name}`,
            fullName,
          };
        });
        if (fetchError) {
          setConnectionError(fetchError);
        }
      } else if (fetchedTools.length === 0 && fetchError) {
        setError(fetchError);
        setToolStates([]);
        return;
      }

      // Get user override
      const overrideResult = await getAllowedToolsOverride({ data: { slug: mcp.slug } });
      const userOverride = overrideResult?.allowedTools;

      // Determine allowed state
      const defaultSet = new Set(defaultAllowedTools || []);
      const overrideSet = userOverride ? new Set(userOverride) : null;

      setToolStates(
        fetchedTools.map((tool: McpTool) => {
          const isInOverride = overrideSet ? overrideSet.has(tool.fullName) : false;
          const allowed = overrideSet ? isInOverride : defaultSet.has(tool.fullName) || defaultSet.size === 0;
          return { tool, allowed };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (fullName: string) => {
    setToolStates((prev) =>
      prev.map((state) =>
        state.tool.fullName === fullName ? { ...state, allowed: !state.allowed } : state
      )
    );
    setHasChanges(true);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const allowedTools = toolStates.filter((s) => s.allowed).map((s) => s.tool.fullName);
      await setAllowedToolsOverride({ data: { slug: mcp.slug, allowedTools } });
      setSaveSuccess(true);
      setHasChanges(false);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : toLocalizedString(content.detailDialog.tools.saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {content.detailDialog.tools.loading}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-destructive/10 p-4">
          <p className="font-medium text-destructive">{content.detailDialog.tools.error}</p>
          <p className="text-sm mt-1 text-destructive/80">{error}</p>
          <Button variant="outline" size="sm" onClick={loadTools} className="mt-3">
            {content.detailDialog.tools.retry}
          </Button>
        </div>
      </div>
    );
  }

  if (toolStates.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <Wrench className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{content.detailDialog.tools.noTools}</p>
        </div>
      </div>
    );
  }

  const enabledCount = toolStates.filter((s) => s.allowed).length;

  return (
    <div className="p-6 space-y-4">
      {/* Connection warning */}
      {connectionError && (
        <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm">
          <p className="font-medium text-yellow-800 dark:text-yellow-300">
            {content.detailDialog.tools.connectionWarning}
          </p>
          <p className="text-xs mt-1 text-yellow-700 dark:text-yellow-400 opacity-80">
            {connectionError}
          </p>
          <p className="text-xs mt-1 text-yellow-700 dark:text-yellow-400">
            {content.detailDialog.tools.connectionWarningHint}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="text-sm text-muted-foreground">
        {toLocalizedString(content.detailDialog.tools.stats).replace('{count}', String(toolStates.length)).replace('{enabled}', String(enabledCount))}
      </div>

      {/* Tool list */}
      <div className="space-y-1 rounded-lg border divide-y">
        {toolStates.map(({ tool, allowed }, index) => (
          <div
            key={tool.fullName}
            className="flex items-start justify-between gap-4 p-4 hover:bg-muted/30 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">
                {index + 1}. <span className="font-mono">{tool.name}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{tool.description}</p>
            </div>
            <Switch
              checked={allowed}
              onCheckedChange={() => handleToggle(tool.fullName)}
            />
          </div>
        ))}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-4">
        <Button onClick={handleSave} disabled={saving || !hasChanges}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {saving ? content.detailDialog.tools.saving : content.detailDialog.tools.saveChanges}
        </Button>
        {saveSuccess && (
          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
            <CheckIcon className="h-4 w-4" />
            {content.detailDialog.tools.saved}
          </span>
        )}
      </div>
    </div>
  );
};
