import { createFileRoute, Link } from '@tanstack/react-router';
import { listAllSkillsFn } from '~/server/function/skills.server';
import { SkillsPageComponent } from '~/components/skills/skills-page';
import { SkillUploadDialog } from '~/components/skills/skill-upload-dialog';
import type { ExtendedSkillInfo } from '~/claude/skills';
import { useState } from 'react';

/**
 * Skills Management Route
 *
 * Displays all skills (official + user-uploaded) in a unified list.
 * Differentiated by visual badges and permissions (user skills can be deleted).
 *
 * Follows TanStack Start best practices:
 * - Fetch on navigation: Load data in route loader
 * - Server Functions: Use RPC instead of REST API
 * - SSR + Streaming: Data is pre-fetched on server
 */
export const Route = createFileRoute('/agents/skills')({
  loader: async () => {
    // Load all skills (both official and user-uploaded)
    const result = await listAllSkillsFn();

    // Merge official and user skills into a single list
    const allSkills: ExtendedSkillInfo[] = [
      ...result.official,
      ...result.user,
    ];

    return {
      allSkills,
    };
  },
  component: () => {
    const { allSkills } = Route.useLoaderData();
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

    // Get enabled skills for both types
    const enabledSkills = allSkills.filter(s => s.enabled).map(s => s.slug);

    // Handle upload success
    const handleUploadSuccess = () => {
      // Refresh the page to show new skill
      window.location.reload();
    };

    return (
      <div className="container mx-auto py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Skills 管理</h1>
            <p className="text-sm text-muted-foreground">
              管理您的 AI 技能（{allSkills.length} 个）
            </p>
          </div>
          <button
            onClick={() => setIsUploadDialogOpen(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            上传新技能
          </button>
        </div>

        {/* Unified Skills List */}
        <SkillsPageComponent
          skills={allSkills}
          enabledSkills={enabledSkills}
        />

        {/* Upload Dialog */}
        <SkillUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onSuccess={handleUploadSuccess}
        />
      </div>
    );
  },
});
