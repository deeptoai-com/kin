import { Outlet, createFileRoute, useParams } from '@tanstack/react-router';
import { ProjectsRail } from '~/components/projects/projects-rail';

export const Route = createFileRoute('/agents/projects')({
  component: ProjectsLayout,
});

/**
 * Projects surface layout: rail-2 (项目 + 最近) on the left, the selected
 * project / index in the main area. Inherits rail-1 (AppSidebar) + auth guard
 * from the parent /agents route — the production chat route is left untouched.
 */
function ProjectsLayout() {
  // projectId is only present on the /$projectId child — read leniently for highlight.
  const params = useParams({ strict: false }) as { projectId?: string };

  return (
    <div className="flex h-full min-h-0">
      <ProjectsRail activeProjectId={params.projectId} />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
