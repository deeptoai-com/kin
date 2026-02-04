import { FC, useMemo, useState, useCallback } from 'react';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Search, Plus } from 'lucide-react';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import { useServerFn } from '@tanstack/react-start';
import {
  disableMcpServerFn,
  enableMcpServerFn,
  getMcpDetailFn,
  verifyMcpServerFn,
  deleteCustomMcpFn,
  listAllMcpsFn,
} from '~/server/function/mcp.server';
import type { ExtendedMcpInfo, McpDetail } from '~/claude/mcp';
import { McpListItem } from './mcp-list-item';
import { McpDetailDialog } from './mcp-detail-dialog';
import { AddCustomMcpDialog } from './add-custom-mcp-dialog';

/**
 * MCP Page Component - New List-Based Design
 *
 * Displays MCPs in two groups: Installed and Recommended
 * - Installed: MCPs that the user has enabled
 * - Recommended: All other available MCPs (official)
 *
 * Custom MCPs (system or personal) can be deleted.
 */
export const McpPageComponent: FC<{
  mcps: ExtendedMcpInfo[];
  systemMcps: ExtendedMcpInfo[];
  userMcps: ExtendedMcpInfo[];
  enabledMcps: string[];
  onAddMcp?: () => void;
}> = ({ mcps: initialMcps, systemMcps: initialSystemMcps, userMcps: initialUserMcps, enabledMcps: initialEnabled, onAddMcp }) => {
  const content = useIntlayer('mcp');
  const enableMcp = useServerFn(enableMcpServerFn);
  const disableMcp = useServerFn(disableMcpServerFn);
  const verifyMcp = useServerFn(verifyMcpServerFn);
  const deleteCustomMcp = useServerFn(deleteCustomMcpFn);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [mcps, setMcps] = useState<ExtendedMcpInfo[]>(() => initialMcps || []);
  const [systemMcps, setSystemMcps] = useState<ExtendedMcpInfo[]>(() => initialSystemMcps || []);
  const [userMcps, setUserMcps] = useState<ExtendedMcpInfo[]>(() => initialUserMcps || []);
  const [enabledMcps, setEnabledMcps] = useState<string[]>(() => initialEnabled || []);
  const [verifyingSlug, setVerifyingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Combine all MCPs
  const allMcps = useMemo(() => [...mcps, ...systemMcps, ...userMcps], [mcps, systemMcps, userMcps]);

  const { data: detail } = useQuery({
    queryKey: ['mcp-detail', selectedSlug],
    queryFn: async () => {
      if (!selectedSlug) return null;
      return await getMcpDetailFn({ data: { slug: selectedSlug } });
    },
    enabled: !!selectedSlug && isDetailOpen,
  });

  // Filter and group MCPs
  const { installedMcps, recommendedMcps } = useMemo(() => {
    let filtered = allMcps;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (mcp) =>
          mcp.name.toLowerCase().includes(query) ||
          (mcp.description && mcp.description.toLowerCase().includes(query))
      );
    }

    // Group by enabled status
    const installed = filtered.filter((mcp) => enabledMcps.includes(mcp.slug));
    const recommended = filtered.filter((mcp) => !enabledMcps.includes(mcp.slug));

    return { installedMcps: installed, recommendedMcps: recommended };
  }, [allMcps, searchQuery, enabledMcps]);

  const handleToggleMcp = async (slug: string) => {
    const isEnabled = enabledMcps.includes(slug);
    try {
      if (isEnabled) {
        await disableMcp({ data: { slug } });
      } else {
        await enableMcp({ data: { slug } });
      }
      setEnabledMcps((prev) =>
        isEnabled ? prev.filter((item) => item !== slug) : [...prev, slug]
      );
    } catch (error) {
      console.error('Failed to toggle MCP:', error);
    }
  };

  const handleViewDetails = (slug: string) => {
    setSelectedSlug(slug);
    setIsDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedSlug(null);
  };

  const handleVerify = async (slug: string) => {
    try {
      setVerifyingSlug(slug);
      const result = await verifyMcp({ data: { slug } });
      if (result.ok) {
        alert(toLocalizedString(content.verify.success));
      } else {
        const detail = result.message
          || (result.details ? JSON.stringify(result.details, null, 2) : '')
          || result.stderr
          || '';
        alert(`${toLocalizedString(content.verify.failed)} ${detail}`.trim());
      }
    } catch (error) {
      console.error('Failed to verify MCP:', error);
      alert(toLocalizedString(content.verify.genericFailed));
    } finally {
      setVerifyingSlug(null);
    }
  };

  const handleDeleteCustomMcp = async (slug: string) => {
    const mcp = allMcps.find((m) => m.slug === slug);
    const storeType = mcp?.store;
    const isSystemMcp = storeType === 'system';

    const confirmMsg = isSystemMcp
      ? toLocalizedString(content.deleteConfirm.system).replace('{slug}', slug)
      : toLocalizedString(content.deleteConfirm.personal).replace('{slug}', slug);

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      setDeletingSlug(slug);
      const result = await deleteCustomMcp({ data: { slug, scope: isSystemMcp ? 'system' : 'personal' } });
      if (result.ok) {
        if (isSystemMcp) {
          setSystemMcps((prev) => prev.filter((mcp) => mcp.slug !== slug));
        } else {
          setUserMcps((prev) => prev.filter((mcp) => mcp.slug !== slug));
        }
        setEnabledMcps((prev) => prev.filter((s) => s !== slug));
      } else {
        alert(result.error || toLocalizedString(content.delete.failed));
      }
    } catch (error) {
      console.error('Failed to delete MCP:', error);
      alert(toLocalizedString(content.delete.failed));
    } finally {
      setDeletingSlug(null);
    }
  };

  const handleAddSuccess = useCallback(async () => {
    try {
      const result = await listAllMcpsFn();
      setMcps(result.official);
      setSystemMcps(result.system);
      setUserMcps(result.user);
    } catch (error) {
      console.error('Failed to refresh MCP list:', error);
    }
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await handleAddSuccess();
    setIsRefreshing(false);
  };

  const handleOpenAddDialog = () => {
    if (onAddMcp) {
      onAddMcp();
    } else {
      setIsAddDialogOpen(true);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {content.detailDialog.refresh}
        </Button>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={toLocalizedString(content.page.searchPlaceholder)}
            className="w-64 pl-9"
          />
        </div>
        <Button onClick={handleOpenAddDialog} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          {content.page.addMcpButton}
        </Button>
      </div>

      {/* MCP List */}
      <div className="flex-1 overflow-y-auto space-y-8 pb-8">
        {/* Installed Section */}
        {installedMcps.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              Installed
            </h2>
            <div className="grid gap-1 md:grid-cols-2">
              {installedMcps.map((mcp) => (
                <McpListItem
                  key={mcp.slug}
                  mcp={mcp}
                  isEnabled={true}
                  onToggle={() => handleToggleMcp(mcp.slug)}
                  onViewDetails={() => handleViewDetails(mcp.slug)}
                  onVerify={() => handleVerify(mcp.slug)}
                  onDelete={mcp.store !== 'official' ? () => handleDeleteCustomMcp(mcp.slug) : undefined}
                  verifying={verifyingSlug === mcp.slug}
                  deleting={deletingSlug === mcp.slug}
                />
              ))}
            </div>
          </section>
        )}

        {/* Recommended Section */}
        {recommendedMcps.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              Recommended
            </h2>
            <div className="grid gap-1 md:grid-cols-2">
              {recommendedMcps.map((mcp) => (
                <McpListItem
                  key={mcp.slug}
                  mcp={mcp}
                  isEnabled={false}
                  onToggle={() => handleToggleMcp(mcp.slug)}
                  onViewDetails={() => handleViewDetails(mcp.slug)}
                  onVerify={() => handleVerify(mcp.slug)}
                  onDelete={mcp.store !== 'official' ? () => handleDeleteCustomMcp(mcp.slug) : undefined}
                  verifying={verifyingSlug === mcp.slug}
                  deleting={deletingSlug === mcp.slug}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {installedMcps.length === 0 && recommendedMcps.length === 0 && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">{content.page.noResults}</p>
              <p className="text-sm text-muted-foreground/70">{content.page.noResultsHint}</p>
            </div>
          </div>
        )}
      </div>

      {/* MCP Detail Dialog */}
      <McpDetailDialog
        mcp={detail as McpDetail | null}
        isOpen={isDetailOpen}
        onClose={handleCloseDetail}
        onToggle={(slug, enabled) => {
          setEnabledMcps((prev) =>
            enabled ? [...prev.filter((s) => s !== slug), slug] : prev.filter((s) => s !== slug)
          );
        }}
      />

      {/* Add Custom MCP Dialog */}
      <AddCustomMcpDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={handleAddSuccess}
      />
    </div>
  );
};
