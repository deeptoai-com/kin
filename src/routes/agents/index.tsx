import { AuthLoading, RedirectToSignIn, SignedIn } from '@daveyplate/better-auth-ui';
import { redirect, createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';

export const Route = createFileRoute('/agents/')({
  beforeLoad: () => {
    // Phase 2 (single chat entry): land on the chat workspace home (rail + 最近 + 项目).
    // New solo chat = the "新建" button → /agents/c.
    throw redirect({
      to: '/agents/projects',
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const content = useIntlayer('app');
  return (
    <>
      {/* Show loading skeleton while checking authentication */}
      <AuthLoading>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-4"></div>
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </div>
      </AuthLoading>

      {/* Redirect to sign-in if not authenticated */}
      <RedirectToSignIn />

      {/* Only show content to authenticated users */}
      <SignedIn>
        <div className="container mx-auto py-8">
          <h1 className="text-3xl font-bold mb-4">{toLocalizedString(content.common.welcomeTo).replace('{name}', toLocalizedString(content.common.appName))}</h1>
          <p>{content.common.redirectingToAgentChat}</p>
        </div>
      </SignedIn>
    </>
  );
}
