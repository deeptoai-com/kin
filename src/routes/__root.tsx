import { AuthQueryProvider } from '@daveyplate/better-auth-tanstack';
import { AuthUIProviderTanstack } from '@daveyplate/better-auth-ui/tanstack';
// Root route file
import { IntlayerProvider } from 'react-intlayer';
import * as React from 'react';
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
import { getLocaleServer } from '~/lib/locale';
import { authClient } from '~/lib/auth-client';
import { getTheme } from '~/lib/theme';
import type { Theme } from '~/lib/theme';
import { seo } from '~/utils/seo';
import { localeStorageOptions } from '@intlayer/core';
import { defaultLocale, getHTMLTextDir, getIntlayer, setLocaleInStorage } from 'intlayer';
// Import CSS files directly - TanStack Start will handle them automatically
import '../styles/app.css';
import '../styles/custom.css';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { PostHogProviderWrapper } from '~/components/posthog-provider';
import { PostHogIdentify } from '~/components/posthog-identify';
import { PostHogPageviewTracker } from '~/components/posthog-pageview-tracker';

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
  loader: async () => {
    const [theme, localeData] = await Promise.all([getTheme(), getLocaleServer()]);
    return { theme, locale: localeData.locale };
  },
  head: ({ loaderData }) => {
    const locale = loaderData?.locale ?? defaultLocale;
    const metaContent = getIntlayer('app', locale);

    return {
      meta: [
        {
          charSet: 'utf-8',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        ...seo({
          title: metaContent.meta.title,
          description: metaContent.meta.description,
          keywords: metaContent.meta.keywords,
        }),
      ],
      links: [
        // OxyGenie DS fonts — Latin → JetBrains Mono, CJK → Noto Sans SC
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap',
        },
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
    };
  },
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
  const { theme, locale } = Route.useLoaderData() as {
    theme: Theme;
    locale: string;
  };
  const router = useRouter();
  const [activeLocale, setActiveLocale] = React.useState(locale);
  const hasGithub = !!import.meta.env.VITE_GITHUB_CLIENT_ID;
  const hasGoogle = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const socialProviders = [
    ...(hasGithub ? ['github'] : []),
    ...(hasGoogle ? ['google'] : []),
  ];

  const handleLocaleChange = React.useCallback((nextLocale: string) => {
    setActiveLocale(nextLocale);
    setLocaleInStorage(nextLocale, localeStorageOptions);
  }, []);

  return (
    <html
      dir={getHTMLTextDir(activeLocale)}
      lang={activeLocale}
      className={theme === 'system' ? '' : theme}
      suppressHydrationWarning
    >
      <head>
        {/* Early theme application – prevents FOUC without react/no-danger noise */}
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body className="">
        <AuthQueryProvider>
          <ThemeProvider initial={theme}>
            <PostHogProviderWrapper>
            <PostHogIdentify />
            <PostHogPageviewTracker />
            <IntlayerProvider locale={activeLocale} setLocale={handleLocaleChange}>
              <AuthUIProviderTanstack
              authClient={authClient}
              redirectTo="/agents/c"
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
            </IntlayerProvider>
            </PostHogProviderWrapper>
          </ThemeProvider>
        </AuthQueryProvider>

        <Scripts />
      </body>
    </html>
  );
}
