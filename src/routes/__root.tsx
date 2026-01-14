import { AuthQueryProvider } from '@daveyplate/better-auth-tanstack';
import { AuthUIProviderTanstack } from '@daveyplate/better-auth-ui/tanstack';
// Root route file
import type { QueryClient } from '@tanstack/react-query';
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary';
import { NotFound } from '~/components/NotFound';
import { ThemeInitScript } from '~/components/theme-init-script';
import { ThemeProvider } from '~/components/theme-provider';
import { authClient } from '~/lib/auth-client';
import { getTheme } from '~/lib/theme';
import type { Theme } from '~/lib/theme';
import { seo } from '~/utils/seo';
// Import CSS files directly - TanStack Start will handle them automatically
import '../styles/app.css';
import '../styles/custom.css';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// Global error handler for debugging
if (typeof window !== 'undefined') {
  // Log environment variables for debugging
  console.log('[Env Debug] Vite environment variables:', {
    VITE_BASE_URL: import.meta.env.VITE_BASE_URL,
    VITE_WS_URL: import.meta.env.VITE_WS_URL,
    MODE: import.meta.env.MODE,
    DEV: import.meta.env.DEV,
    PROD: import.meta.env.PROD,
    'all env keys': Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')),
  });

  window.addEventListener('error', (event) => {
    console.error('[Global Error Handler]', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
      stack: event.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Global Promise Rejection]', {
      reason: event.reason,
      stack: event.reason?.stack,
    });
  });
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  loader: () => getTheme(),
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      ...seo({
        title: 'DeeptoAI - AI 工作台',
        description: '基于 Claude Agent SDK 的 AI 工作台，支持流式对话、Skills 管理、Artifacts 展示和会话管理。Powered by Zhipu AI GLM-4.7',
        keywords: 'AI, Claude Agent, Zhipu AI, GLM-4.7, Chat, Skills, Artifacts, AI Workspace',
      }),
    ],
    links: [
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  errorComponent: (props) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    );
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
      <ReactQueryDevtools initialIsOpen={false} />
      <TanStackRouterDevtools />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme;
  const router = useRouter();
  const hasGithub = !!import.meta.env.VITE_GITHUB_CLIENT_ID;
  const hasGoogle = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const socialProviders = [
    ...(hasGithub ? ['github'] : []),
    ...(hasGoogle ? ['google'] : []),
  ];

  return (
    <html lang="en" className={initial === 'system' ? '' : initial} suppressHydrationWarning>
      <head>
        {/* Early theme application – prevents FOUC without react/no-danger noise */}
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body className="">
        <AuthQueryProvider>
          <ThemeProvider initial={initial}>
            <AuthUIProviderTanstack
              authClient={authClient}
              redirectTo="/agents/claude-chat"
              navigate={(href) => router.navigate({ href })}
              replace={(href) => router.navigate({ href, replace: true })}
              Link={({ href, ...props }) => <Link to={href} {...props} />}
              social={
                socialProviders.length > 0
                  ? { providers: socialProviders }
                  : undefined
              }
            >
              <div className="flex min-h-svh flex-col">{children}</div>
              <Toaster />
            </AuthUIProviderTanstack>
          </ThemeProvider>
        </AuthQueryProvider>

        <Scripts />
      </body>
    </html>
  );
}
