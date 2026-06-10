import { createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { FolderOpen } from 'lucide-react';

export const Route = createFileRoute('/agents/projects/')({
  component: ProjectsIndex,
});

/** Landing when no specific project is open — prompt to pick or create one. */
function ProjectsIndex() {
  const content = useIntlayer('projects');
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          {content.index.title}
        </h1>
        <p className="text-muted-foreground">{content.index.subtitle}</p>
      </div>
    </div>
  );
}
