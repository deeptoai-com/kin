import { createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { listAllSkillsFn, isAdminUser } from '~/server/function/skills.server';
import { SkillsPageComponent } from '~/components/skills/skills-page';
import { SkillUploadDialog } from '~/components/skills/skill-upload-dialog';
import { GitHubSkillInstaller } from '~/components/skills/github-skill-installer';
import type { ExtendedSkillInfo } from '~/claude/skills';
import { useState } from 'react';

/**
 * Skills Management Route - New List-Based Design
 *
 * Displays all skills in two groups: Installed and Recommended
 * - Installed: Skills that the user has enabled
 * - Recommended: All other available skills
 *
 * Only user-uploaded skills can be deleted.
 * GitHub-installed and official skills cannot be deleted by regular users.
 */
export const Route = createFileRoute('/agents/skills')({
  loader: async () => {
    const [result, adminCheck] = await Promise.all([
      listAllSkillsFn(),
      isAdminUser(),
    ]);

    // Merge official and user skills into a single list
    const allSkills: ExtendedSkillInfo[] = [
      ...result.official,
      ...result.user,
    ];

    return {
      allSkills,
      isAdmin: adminCheck.isAdmin ?? false,
    };
  },
  component: () => {
    const { allSkills, isAdmin } = Route.useLoaderData();
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
    const [isGitHubInstallOpen, setIsGitHubInstallOpen] = useState(false);

    // Get enabled skills
    const enabledSkills = allSkills.filter((s) => s.enabled).map((s) => s.slug);

    const handleUploadSuccess = () => {
      window.location.reload();
    };

    const handleNewSkill = () => {
      setIsUploadDialogOpen(true);
    };

    return (
      <div className="container mx-auto px-6 py-8 max-w-6xl">
        <SkillsPageComponent
          skills={allSkills}
          enabledSkills={enabledSkills}
          isAdmin={isAdmin}
          onNewSkill={handleNewSkill}
        />

        {/* Upload Dialog */}
        <SkillUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onSuccess={handleUploadSuccess}
        />

        {/* GitHub Install Dialog - Admin Only */}
        {isAdmin && (
          <GitHubSkillInstaller
            open={isGitHubInstallOpen}
            onOpenChange={setIsGitHubInstallOpen}
            onSuccess={handleUploadSuccess}
          />
        )}
      </div>
    );
  },
});
