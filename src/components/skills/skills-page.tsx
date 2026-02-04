import { FC, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, RefreshCw, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import { useServerFn } from '@tanstack/react-start';
import {
  enableUserSkill as enableUserSkillFn,
  disableUserSkill as disableUserSkillFn,
  enableUserUploadedSkillFn,
  disableUserUploadedSkillFn,
  deleteUserSkillFn,
  getSkillDetailFn,
  setGlobalSkillEnabledFn,
  generateSkillIconFn,
} from '~/server/function/skills.server';
import type { ExtendedSkillInfo } from '~/claude/skills';
import { SkillListItem } from './skill-list-item';
import { SkillDetailDialog } from './skill-detail-dialog';
import { SchemaManageDialog } from './schema-manage-dialog';

/**
 * Skills Page Component - New List-Based Design
 *
 * Displays skills in two groups: Installed and Recommended
 * - Installed: Skills that the user has enabled
 * - Recommended: All other available skills (official)
 *
 * Only user-uploaded skills can be deleted.
 */
export const SkillsPageComponent: FC<{
  skills: ExtendedSkillInfo[];
  enabledSkills: string[];
  isAdmin: boolean;
  onRefresh?: () => void;
  onNewSkill?: () => void;
}> = ({ skills, enabledSkills: initialEnabledSkills, isAdmin, onRefresh, onNewSkill }) => {
  const content = useIntlayer('skills');

  // Server Functions (type-safe RPC)
  const enableOfficialSkill = useServerFn(enableUserSkillFn);
  const disableOfficialSkill = useServerFn(disableUserSkillFn);
  const enableUserSkillServer = useServerFn(enableUserUploadedSkillFn);
  const disableUserSkillServer = useServerFn(disableUserUploadedSkillFn);
  const deleteUserSkill = useServerFn(deleteUserSkillFn);
  const setGlobalSkill = useServerFn(setGlobalSkillEnabledFn);
  const generateSkillIcon = useServerFn(generateSkillIconFn);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkillSlug, setSelectedSkillSlug] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [enabledSkills, setEnabledSkills] = useState<string[]>(() => initialEnabledSkills);
  const [globalSkills, setGlobalSkills] = useState<string[]>(() =>
    skills.filter((skill) => skill.globalEnabled).map((skill) => skill.slug)
  );
  const [schemaManageSlug, setSchemaManageSlug] = useState<string | null>(null);
  const [isSchemaDialogOpen, setIsSchemaDialogOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [regeneratingIconSlug, setRegeneratingIconSlug] = useState<string | null>(null);

  // Query for skill detail (lazy loading on dialog open)
  const { data: skillDetail } = useQuery({
    queryKey: ['skill-detail', selectedSkillSlug],
    queryFn: async () => {
      if (!selectedSkillSlug) return null;
      return await getSkillDetailFn({ data: { skillSlug: selectedSkillSlug } });
    },
    enabled: !!selectedSkillSlug && isDetailOpen,
  });

  // Filter and group skills
  const { installedSkills, recommendedSkills } = useMemo(() => {
    let filtered = skills;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          (skill.description && skill.description.toLowerCase().includes(query))
      );
    }

    // Group by installed status
    const installed = filtered.filter((skill) => enabledSkills.includes(skill.slug));
    const recommended = filtered.filter((skill) => !enabledSkills.includes(skill.slug));

    return { installedSkills: installed, recommendedSkills: recommended };
  }, [skills, searchQuery, enabledSkills]);

  // Handle toggle skill
  const handleToggleSkill = async (skillSlug: string) => {
    const skill = skills.find((s) => s.slug === skillSlug);
    if (!skill) {
      toast.error(toLocalizedString(content.toast.skillNotFound));
      return;
    }

    if (globalSkills.includes(skillSlug)) {
      toast.error(toLocalizedString(content.toast.globalEnabledError));
      return;
    }

    const isEnabled = enabledSkills.includes(skillSlug);

    try {
      if (skill.store === 'official') {
        if (isEnabled) {
          await disableOfficialSkill({ data: { skillName: skillSlug } });
        } else {
          await enableOfficialSkill({ data: { skillName: skillSlug } });
        }
      } else {
        if (isEnabled) {
          await disableUserSkillServer({ data: { skillName: skillSlug } });
        } else {
          await enableUserSkillServer({ data: { skillName: skillSlug } });
        }
      }

      setEnabledSkills((prev) =>
        isEnabled ? prev.filter((s) => s !== skillSlug) : [...prev, skillSlug]
      );
    } catch (error) {
      console.error('Failed to toggle skill:', error);
      const message = error instanceof Error ? error.message : toLocalizedString(content.toast.toggleFailed);
      toast.error(message);
    }
  };

  const handleToggleGlobal = async (skillSlug: string) => {
    if (!isAdmin) return;
    const isGlobalEnabled = globalSkills.includes(skillSlug);
    try {
      const result = await setGlobalSkill({ data: { skillName: skillSlug, enabled: !isGlobalEnabled } });
      const updated = result?.skills ?? [];
      setGlobalSkills(updated);
      if (!isGlobalEnabled) {
        setEnabledSkills((prev) => (prev.includes(skillSlug) ? prev : [...prev, skillSlug]));
      }
    } catch (error) {
      console.error('Failed to toggle global skill:', error);
      toast.error(toLocalizedString(content.toast.globalEnableFailed));
    }
  };

  // Handle delete skill (only user-uploaded skills)
  const handleDeleteSkill = async (skillSlug: string) => {
    const skill = skills.find((s) => s.slug === skillSlug);
    if (!skill || skill.store !== 'user') {
      toast.error(toLocalizedString(content.toast.cannotDeleteOfficial));
      return;
    }

    if (!confirm(toLocalizedString(content.toast.deleteConfirmCustom))) {
      return;
    }

    try {
      await deleteUserSkill({ data: { skillName: skillSlug } });
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete skill:', error);
      toast.error(`${toLocalizedString(content.toast.deleteFailed)}: ${(error as Error).message}`);
    }
  };

  const handleViewDetails = (skillSlug: string) => {
    setSelectedSkillSlug(skillSlug);
    setIsDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedSkillSlug(null);
  };

  const handleManageSchema = (skillSlug: string) => {
    setSchemaManageSlug(skillSlug);
    setIsSchemaDialogOpen(true);
  };

  const handleRegenerateIcon = async (skillSlug: string) => {
    const skill = skills.find((s) => s.slug === skillSlug);
    if (!skill || !skill.description) {
      return;
    }

    try {
      setRegeneratingIconSlug(skillSlug);
      toast.info(toLocalizedString(content.toast.iconGenerating));

      const result = await generateSkillIcon({ data: { skillSlug: skillSlug, description: skill.description } });

      if (result.success && result.iconUrl) {
        toast.success(toLocalizedString(content.toast.iconGenerated));
        // Refresh to show new icon
        window.location.reload();
      } else {
        toast.error(`${toLocalizedString(content.toast.iconGenerateFailed)}: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to regenerate icon:', error);
      toast.error(`${toLocalizedString(content.toast.iconGenerateFailed)}: ${(error as Error).message}`);
    } finally {
      setRegeneratingIconSlug(null);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (onRefresh) {
      await onRefresh();
    } else {
      window.location.reload();
    }
    setIsRefreshing(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-3 mb-6 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {content.toolbar.refresh}
        </Button>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={toLocalizedString(content.toolbar.searchPlaceholder)}
            className="w-64 pl-9"
          />
        </div>
        {onNewSkill && (
          <Button onClick={onNewSkill} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {content.toolbar.newSkill}
          </Button>
        )}
      </div>

      {/* Skills List */}
      <div className="flex-1 overflow-y-auto space-y-8 pb-8">
        {/* Installed Section */}
        {installedSkills.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              {content.sections.installed}
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {installedSkills.map((skill) => (
                <SkillListItem
                  key={skill.slug}
                  skill={skill}
                  isEnabled={true}
                  isGlobalEnabled={globalSkills.includes(skill.slug)}
                  isAdmin={isAdmin}
                  onToggle={() => handleToggleSkill(skill.slug)}
                  onToggleGlobal={() => handleToggleGlobal(skill.slug)}
                  onViewDetails={() => handleViewDetails(skill.slug)}
                  onDeleteSkill={handleDeleteSkill}
                  onManageSchema={handleManageSchema}
                  onRegenerateIcon={handleRegenerateIcon}
                  regeneratingIcon={regeneratingIconSlug === skill.slug}
                />
              ))}
            </div>
          </section>
        )}

        {/* Recommended Section */}
        {recommendedSkills.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              {content.sections.recommended}
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {recommendedSkills.map((skill) => (
                <SkillListItem
                  key={skill.slug}
                  skill={skill}
                  isEnabled={false}
                  isGlobalEnabled={globalSkills.includes(skill.slug)}
                  isAdmin={isAdmin}
                  onToggle={() => handleToggleSkill(skill.slug)}
                  onToggleGlobal={() => handleToggleGlobal(skill.slug)}
                  onViewDetails={() => handleViewDetails(skill.slug)}
                  onDeleteSkill={handleDeleteSkill}
                  onManageSchema={handleManageSchema}
                  onRegenerateIcon={handleRegenerateIcon}
                  regeneratingIcon={regeneratingIconSlug === skill.slug}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {installedSkills.length === 0 && recommendedSkills.length === 0 && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">{content.empty.title}</p>
              <p className="text-sm text-muted-foreground/70">{content.empty.subtitle}</p>
            </div>
          </div>
        )}
      </div>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={skillDetail ?? null}
        isOpen={isDetailOpen}
        onClose={handleCloseDetail}
        isInstalled={selectedSkillSlug ? enabledSkills.includes(selectedSkillSlug) : false}
        onToggleInstall={selectedSkillSlug ? () => handleToggleSkill(selectedSkillSlug) : undefined}
      />

      {/* Schema Manage Dialog - Admin Only */}
      {isAdmin && (
        <SchemaManageDialog
          skillSlug={schemaManageSlug}
          skillName={skills.find((s) => s.slug === schemaManageSlug)?.name ?? ''}
          isOpen={isSchemaDialogOpen}
          onClose={() => {
            setIsSchemaDialogOpen(false);
            setSchemaManageSlug(null);
          }}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
};
