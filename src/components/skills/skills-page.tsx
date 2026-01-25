import { FC, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Zap, Code, Palette, Plug, CheckCircle, Circle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '~/components/ui/input';
import { useServerFn } from '@tanstack/react-start';
import {
  enableUserSkill as enableUserSkillFn,
  disableUserSkill as disableUserSkillFn,
  enableUserUploadedSkillFn,
  disableUserUploadedSkillFn,
  deleteUserSkillFn,
  deleteGitHubSkillFn,
  getSkillDetailFn,
} from '~/server/function/skills.server';
import type { ExtendedSkillInfo, SkillDetail } from '~/claude/skills';
import { SkillsSidebar } from './skills-sidebar';
import { SkillsGrid } from './skills-grid';
import { SkillDetailDialog } from './skill-detail-dialog';
import { SchemaManageDialog } from './schema-manage-dialog';

interface CategoryItem {
  id: string;
  label: string;
  icon: FC<{ className?: string }>;
}

const CATEGORIES: CategoryItem[] = [
  { id: 'all', label: 'All Skills', icon: Zap },
  { id: 'development', label: 'Development', icon: Code },
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'productivity', label: 'Productivity', icon: Zap },
  { id: 'integration', label: 'Integration', icon: Plug },
  { id: 'installed', label: 'Installed', icon: CheckCircle },
];

/**
 * Skills Page Component
 *
 * Displays all skills (official + user) in a unified list.
 * Uses skill.store property to determine permissions and actions.
 *
 * Follows TanStack Start best practices:
 * - Data passed from loader (SSR + streaming)
 * - Server Functions for mutations (type-safe)
 * - No useEffect for data fetching
 */
export const SkillsPageComponent: FC<{
  skills: ExtendedSkillInfo[];
  enabledSkills: string[];
  isAdmin: boolean;
}> = ({ skills, enabledSkills: initialEnabledSkills, isAdmin }) => {
  // Server Functions (type-safe RPC)
  const enableOfficialSkill = useServerFn(enableUserSkillFn);
  const disableOfficialSkill = useServerFn(disableUserSkillFn);
  const enableUserSkillServer = useServerFn(enableUserUploadedSkillFn);
  const disableUserSkillServer = useServerFn(disableUserUploadedSkillFn);
  const deleteUserSkill = useServerFn(deleteUserSkillFn);
  const deleteGitHubSkill = useServerFn(deleteGitHubSkillFn);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [selectedSkillSlug, setSelectedSkillSlug] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [enabledSkills, setEnabledSkills] = useState<string[]>(() => initialEnabledSkills);
  const [schemaManageSlug, setSchemaManageSlug] = useState<string | null>(null);
  const [isSchemaDialogOpen, setIsSchemaDialogOpen] = useState(false);

  // Query for skill detail (lazy loading on dialog open)
  const { data: skillDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['skill-detail', selectedSkillSlug],
    queryFn: async () => {
      if (!selectedSkillSlug) return null;
      return await getSkillDetailFn({ data: { skillSlug: selectedSkillSlug } });
    },
    enabled: !!selectedSkillSlug && isDetailOpen,
  });

  // Handle toggle skill (using Server Functions)
  const handleToggleSkill = async (skillSlug: string) => {
    // Find the skill to determine its type
    const skill = skills.find(s => s.slug === skillSlug);
    if (!skill) {
      console.error('Skill not found:', skillSlug);
      return;
    }

    const isEnabled = enabledSkills.includes(skillSlug);

    try {
      // Use appropriate function based on skill store
      if (skill.store === 'official') {
        // Official skills
        if (isEnabled) {
          await disableOfficialSkill({ data: { skillName: skillSlug } });
        } else {
          await enableOfficialSkill({ data: { skillName: skillSlug } });
        }
      } else {
        // User skills
        if (isEnabled) {
          await disableUserSkillServer({ data: { skillName: skillSlug } });
        } else {
          await enableUserSkillServer({ data: { skillName: skillSlug } });
        }
      }

      // Update local state so UI reflects the change immediately
      setEnabledSkills((prev) =>
        isEnabled ? prev.filter((s) => s !== skillSlug) : [...prev, skillSlug]
      );
    } catch (error) {
      console.error('Failed to toggle skill:', error);
      const message = error instanceof Error ? error.message : '启用技能失败';
      if (message.startsWith('SKILL_NOT_SYNCED:')) {
        const slug = message.split(':')[1]?.trim() ?? skillSlug;
        toast.error(`技能未同步到运行时目录：${slug}。当前启用不会生效。`);
      } else {
        toast.error(message);
      }
    }
  };

  // Handle delete skill (user skills or GitHub-installed skills)
  const handleDeleteSkill = async (skillSlug: string) => {
    // Find the skill
    const skill = skills.find(s => s.slug === skillSlug);
    if (!skill) {
      console.error('Skill not found:', skillSlug);
      return;
    }

    // Check if skill can be deleted
    const canDelete = skill.store === 'user' || skill.deletable === true;
    if (!canDelete) {
      console.error('Cannot delete official skill:', skillSlug);
      alert('这是内置技能，无法删除');
      return;
    }

    const confirmMessage = skill.store === 'user'
      ? '确定要删除这个自定义技能吗？此操作无法撤销。'
      : '确定要从全局技能库删除这个 GitHub 技能吗？所有用户将无法再看到此技能。';

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      if (skill.store === 'user') {
        // Delete user-uploaded skill
        await deleteUserSkill({ data: { skillName: skillSlug } });
      } else {
        // Delete GitHub-installed skill
        await deleteGitHubSkill({ data: { skillName: skillSlug } });
      }
      // Refresh page to update list
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete skill:', error);
      alert('删除技能失败：' + (error as Error).message);
    }
  };

  // Handle view details
  const handleViewDetails = (skillSlug: string) => {
    setSelectedSkillSlug(skillSlug);
    setIsDetailOpen(true);
  };

  // Handle close detail dialog
  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedSkillSlug(null);
  };

  // Handle open schema manage dialog (admin only)
  const handleManageSchema = (skillSlug: string) => {
    setSchemaManageSlug(skillSlug);
    setIsSchemaDialogOpen(true);
  };

  // Handle close schema dialog
  const handleCloseSchemaDialog = () => {
    setIsSchemaDialogOpen(false);
    setSchemaManageSlug(null);
  };

  // Handle schema generation success
  const handleSchemaSuccess = () => {
    // Refresh page to show updated status
    window.location.reload();
  };

  // Filter skills based on search and category (computed on render)
  const filteredSkills = useMemo(() => {
    let result = skills;

    // Apply category filter
    if (activeFilter === 'installed') {
      result = result.filter((skill) => enabledSkills.includes(skill.slug));
    } else if (activeFilter !== 'all') {
      result = result.filter((skill) => skill.category === activeFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          (skill.description && skill.description.toLowerCase().includes(query))
      );
    }

    return result;
  }, [skills, activeFilter, searchQuery, enabledSkills]);

  // Get category counts
  const getCategoryCount = (categoryId: string) => {
    if (categoryId === 'all') return skills.length;
    if (categoryId === 'installed') return enabledSkills.length;
    return skills.filter((s) => s.category === categoryId).length;
  };

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))]">
      {/* Left Sidebar */}
      <SkillsSidebar
        categories={CATEGORIES}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        getCategoryCount={getCategoryCount}
      />

      {/* Right Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            {activeFilter === 'all'
              ? 'All Skills'
              : CATEGORIES.find((c) => c.id === activeFilter)?.label || 'Skills'}
            <span className="ml-2 text-muted-foreground">
              • {filteredSkills.length}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search skills..."
                className="w-64 pl-9"
              />
            </div>
          </div>
        </div>

        {/* Skills Grid */}
        <div className="flex-1 overflow-auto p-6">
          {filteredSkills.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Circle className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-muted-foreground">No skills found</p>
                <p className="text-sm text-muted-foreground/70">
                  Try adjusting your search or filter
                </p>
              </div>
            </div>
          ) : (
            <SkillsGrid
              skills={filteredSkills}
              enabledSkills={enabledSkills}
              isAdmin={isAdmin}
              onToggleSkill={handleToggleSkill}
              onViewDetails={handleViewDetails}
              onDeleteSkill={handleDeleteSkill}
              onManageSchema={handleManageSchema}
            />
          )}
        </div>
      </main>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={skillDetail ?? null}
        isOpen={isDetailOpen}
        onClose={handleCloseDetail}
      />

      {/* Schema Manage Dialog - Admin Only */}
      {isAdmin && (
        <SchemaManageDialog
          skillSlug={schemaManageSlug}
          skillName={skills.find(s => s.slug === schemaManageSlug)?.name ?? ''}
          isOpen={isSchemaDialogOpen}
          onClose={handleCloseSchemaDialog}
          onSuccess={handleSchemaSuccess}
        />
      )}
    </div>
  );
};
