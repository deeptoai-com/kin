import { createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { useState } from 'react';
import { listAllSkillsFn, listCuratedSkillsFn, isAdminUser } from '~/server/function/skills.server';
import { listAllMcpsFn } from '~/server/function/mcp.server';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { SkillsPageComponent } from '~/components/skills/skills-page';
import { CuratedSkillsSection } from '~/components/skills/curated-skills-section';
import { SkillUploadDialog } from '~/components/skills/skill-upload-dialog';
import { GitHubSkillInstaller } from '~/components/skills/github-skill-installer';
import { McpPageComponent } from '~/components/mcp/mcp-page';
import type { ExtendedSkillInfo } from '~/claude/skills';
import type { ExtendedMcpInfo } from '~/claude/mcp';

/**
 * Capability Center — unified discovery/management surface for Skills + MCP.
 *
 * Folds the former standalone `/agents/skills` and `/agents/mcp` pages into a
 * single tabbed center (Skills / MCP), per the product decision to unify the
 * *discovery/UI layer* while keeping each capability's runtime model distinct
 * (Skills = filesystem-scanned; MCP = SDK-managed connections).
 * See docs/project/prd/2026-06-mcp-capability-center-prd.md (§5).
 *
 * The old routes redirect here with the matching tab preselected.
 */
type CapabilityTab = 'skills' | 'mcp';

export const Route = createFileRoute('/agents/capabilities')({
  validateSearch: (search: Record<string, unknown>): { tab: CapabilityTab } => ({
    tab: search.tab === 'mcp' ? 'mcp' : 'skills',
  }),
  loader: async () => {
    const [skillsResult, curatedSkills, mcpResult, adminCheck] = await Promise.all([
      listAllSkillsFn(),
      listCuratedSkillsFn(),
      listAllMcpsFn(),
      isAdminUser(),
    ]);

    const allSkills: ExtendedSkillInfo[] = [
      ...skillsResult.official,
      ...skillsResult.user,
    ];

    const officialMcps = mcpResult.official || [];
    const systemMcps = mcpResult.system || [];
    const userMcps = mcpResult.user || [];
    const allMcps: ExtendedMcpInfo[] = [...officialMcps, ...systemMcps, ...userMcps];

    return {
      allSkills,
      curatedSkills,
      isAdmin: adminCheck.isAdmin ?? false,
      officialMcps,
      systemMcps,
      userMcps,
      allMcps,
    };
  },
  component: CapabilityCenter,
});

function CapabilityCenter() {
  const { allSkills, curatedSkills, isAdmin, officialMcps, systemMcps, userMcps, allMcps } =
    Route.useLoaderData();
  const { tab } = Route.useSearch();
  const content = useIntlayer('app');

  const [activeTab, setActiveTab] = useState<string>(tab);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isGitHubInstallOpen, setIsGitHubInstallOpen] = useState(false);

  const enabledSkills = allSkills.filter((s) => s.enabled).map((s) => s.slug);
  const enabledMcps = allMcps.filter((m) => m.enabled).map((m) => m.slug);

  const handleSkillUploadSuccess = () => {
    window.location.reload();
  };

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="skills">{content.nav.skillsStore}</TabsTrigger>
          <TabsTrigger value="mcp">{content.nav.mcpStore}</TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="mt-6">
          {curatedSkills.length > 0 && <CuratedSkillsSection skills={curatedSkills} />}
          <SkillsPageComponent
            skills={allSkills}
            enabledSkills={enabledSkills}
            isAdmin={isAdmin}
            onNewSkill={() => setIsUploadDialogOpen(true)}
          />
        </TabsContent>

        <TabsContent value="mcp" className="mt-6">
          <McpPageComponent
            mcps={officialMcps}
            systemMcps={systemMcps}
            userMcps={userMcps}
            enabledMcps={enabledMcps}
          />
        </TabsContent>
      </Tabs>

      {/* Skill dialogs (preserved from the former /agents/skills route) */}
      <SkillUploadDialog
        open={isUploadDialogOpen}
        onOpenChange={setIsUploadDialogOpen}
        onSuccess={handleSkillUploadSuccess}
      />
      {isAdmin && (
        <GitHubSkillInstaller
          open={isGitHubInstallOpen}
          onOpenChange={setIsGitHubInstallOpen}
          onSuccess={handleSkillUploadSuccess}
        />
      )}
    </div>
  );
}
