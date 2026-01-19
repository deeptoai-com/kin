/**
 * MCP Detail Dialog
 *
 * Redesigned based on Antigravity's MCP detail UI:
 * - Header with name, enabled toggle, and refresh button
 * - Tabs: About / Configure / Tools
 * - About: Markdown readme content
 * - Configure: Credentials form
 * - Tools: Toggle switches for each tool
 */

import { type FC, useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  Info,
  Settings,
  Wrench,
  ChevronDown,
  Loader2,
  CheckIcon,
  Globe,
  User,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Switch } from '~/components/ui/switch';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { cn } from '~/lib/utils';
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
  const [activeTab, setActiveTab] = useState<TabId>('about');
  const [isEnabled, setIsEnabled] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Simulate refresh - in real app, would refetch MCP details
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsRefreshing(false);
  };

  const tabs: { id: TabId; label: string; icon: FC<{ className?: string }> }[] = [
    { id: 'about', label: 'About', icon: Info },
    { id: 'configure', label: 'Configure', icon: Settings },
    { id: 'tools', label: 'Tools', icon: Wrench },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{mcp.name}</h2>
              {/* Enabled/Disabled dropdown-style button */}
              <button
                onClick={handleToggleEnabled}
                disabled={isToggling}
                className={cn(
                  'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isEnabled
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400',
                  isToggling && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isToggling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {isEnabled ? 'Enabled' : 'Disabled'}
              </button>
              {/* Store type badge */}
              {mcp.store === 'system' && (
                <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  <Globe className="h-3 w-3" />
                  System
                </span>
              )}
              {mcp.store === 'user' && (
                <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  <User className="h-3 w-3" />
                  Personal
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn('h-4 w-4 mr-1', isRefreshing && 'animate-spin')} />
                Refresh
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{mcp.description}</p>
        </div>

        {/* Tabs and Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar tabs */}
          <div className="w-48 border-r bg-muted/30 p-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'about' && <AboutTab mcp={mcp} />}
            {activeTab === 'configure' && <ConfigureTab mcp={mcp} />}
            {activeTab === 'tools' && <ToolsTab mcp={mcp} />}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// About Tab
// ============================================================================

const AboutTab: FC<{ mcp: McpDetail }> = ({ mcp }) => {
  // Generate MCP config JSON for display
  const mcpConfigJson = mcp.mcp
    ? JSON.stringify({ mcpServers: { [mcp.slug]: formatMcpConfig(mcp.mcp) } }, null, 2)
    : null;

  return (
    <div className="space-y-6">
      {/* Readme content */}
      {mcp.readme ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <div className="whitespace-pre-wrap">{mcp.readme}</div>
        </div>
      ) : (
        <div className="text-muted-foreground italic">
          No documentation available for this MCP.
        </div>
      )}

      {/* MCP Config */}
      {mcpConfigJson && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Configuration</h3>
          <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">
            <code>{mcpConfigJson}</code>
          </pre>
        </div>
      )}

      {/* Tools list (read-only summary) */}
      {mcp.allowedTools && mcp.allowedTools.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Tools</h3>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {mcp.allowedTools.map((tool) => (
              <li key={tool} className="text-muted-foreground">
                <span className="font-medium text-foreground">{extractToolName(tool)}</span>
              </li>
            ))}
          </ul>
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
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  if (!hasCredentials) {
    return (
      <div className="text-muted-foreground">
        No configuration needed for {mcp.name}.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {credentialFields.map((field: CredentialField) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={field.key} className="flex items-center gap-2">
              {field.label}
              {field.required && <span className="text-red-500">*</span>}
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
              placeholder={field.sensitive ? '••••••••' : `Enter ${field.label}`}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
        {saveSuccess && (
          <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
            <CheckIcon className="h-4 w-4" />
            Saved
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
        setError('Failed to load MCP info');
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
          fetchError = toolsResult?.error || 'Failed to connect to MCP server';
        }
      } catch (err) {
        fetchError = err instanceof Error ? err.message : 'Failed to connect to MCP server';
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
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading tools...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-900/20 dark:text-red-400">
        <p className="font-medium">Error loading tools</p>
        <p className="text-sm mt-1">{error}</p>
        <Button variant="outline" size="sm" onClick={loadTools} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  if (toolStates.length === 0) {
    return (
      <div className="text-muted-foreground italic">
        No tools available for this MCP server.
      </div>
    );
  }

  const enabledCount = toolStates.filter((s) => s.allowed).length;

  return (
    <div className="space-y-4">
      {/* Connection warning */}
      {connectionError && (
        <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
          <p className="font-medium">Could not connect to MCP server</p>
          <p className="text-xs mt-1 opacity-80">{connectionError}</p>
          <p className="text-xs mt-1">Showing predefined tools from configuration. You may need to configure credentials or install the MCP package.</p>
        </div>
      )}

      {/* Stats */}
      <div className="text-sm text-muted-foreground">
        {toolStates.length} tools · <span className="text-green-600 dark:text-green-400">{enabledCount} enabled</span>
      </div>

      {/* Tool list */}
      <div className="space-y-1">
        {toolStates.map(({ tool, allowed }, index) => (
          <div
            key={tool.fullName}
            className="flex items-start justify-between gap-4 rounded-md p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {index + 1}. {tool.name}
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
      <div className="flex items-center gap-3 pt-4 border-t">
        <Button onClick={handleSave} disabled={saving || !hasChanges}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        {saveSuccess && (
          <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
            <CheckIcon className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
};
