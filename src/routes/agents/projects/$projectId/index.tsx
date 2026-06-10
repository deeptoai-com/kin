import { createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { FolderX, Loader2 } from 'lucide-react';
import { ProjectHome } from '~/components/projects/project-home';
import { useProjects, selectProject } from '~/lib/hooks/use-projects';
import { toLocalizedString } from '~/lib/utils';

export const Route = createFileRoute('/agents/projects/$projectId/')({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const content = useIntlayer('projects');
  const { projects, isLoading } = useProjects();
  const project = selectProject(projects, projectId);

  if (!project) {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <FolderX className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm">{content.index.subtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <ProjectHome
      project={project}
      currentUserId={user.id}
      personalLabel={toLocalizedString(content.rail.personal)}
    />
  );
}
