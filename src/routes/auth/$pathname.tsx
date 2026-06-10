import * as React from 'react';
import {
  AuthUIContext,
  AuthView,
  authLocalization,
} from '@daveyplate/better-auth-ui';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useIntlayer, useLocale } from 'react-intlayer';
import { useServerFn } from '@tanstack/react-start';
import { toLocalizedString } from '~/lib/utils';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { z } from 'zod';
import {
  authContainerClassName,
  authDescriptionClassName,
  authHeaderClassName,
  createAuthLocalizationOverrides,
  authTitleClassName,
  authViewClassNames,
} from '~/components/auth/auth-styles';
import {
  resolveSocialProviderDisplays,
  type SocialProviderDisplay,
} from '~/components/auth/social-provider-icons';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';
import { resendVerificationEmail } from '~/server/function/resend-verification-email.server';
import { getSession } from '~/server/function/auth.server.func';

const searchSchema = z.object({
  redirect: z.string().optional(),
  token: z.string().optional(),
  message: z.string().optional(),
  method: z.enum(['email']).optional(),
});

export const Route = createFileRoute('/auth/$pathname')({
  validateSearch: searchSchema,
  component: RouteComponent,
  beforeLoad: async ({ params }: { params: { pathname: string } }) => {
    if (params.pathname === 'sign-in' || params.pathname === 'sign-up') {
      const session = await getSession();
      if (session?.user) {
        throw redirect({
          to: '/agents/c',
        });
      }
    }
  },
});

function RouteComponent() {
  const router = useRouter();
  const { pathname } = Route.useParams();
  const { redirect: redirectParam, message, token, method } = Route.useSearch();
  const redirectTo = redirectParam || '/agents/c';

  // Get i18n content and locale (locale needed for SSR so toLocalizedString resolves correctly)
  const content = useIntlayer('auth');
  const { locale } = useLocale();

  const localizedCopy = React.useMemo(() => {
    const overrides = createAuthLocalizationOverrides(content, locale ?? undefined);

    return {
      ...authLocalization,
      ...overrides,
      ...(pathname === 'sign-in' && message === 'password-reset-sent'
        ? {
            SIGN_IN_DESCRIPTION: toLocalizedString(content.success.passwordResetSent, locale ?? undefined),
          }
        : {}),
      ...(pathname === 'sign-in' && message === 'EMAIL_NOT_VERIFIED'
        ? {
            SIGN_IN_DESCRIPTION: toLocalizedString(content.verification.subtitle, locale ?? undefined),
          }
        : {}),
    };
  }, [content, message, pathname, locale]);

  const showResendNotice =
    pathname === 'sign-in' && message === 'EMAIL_NOT_VERIFIED';
  const methodIsEmail = method === 'email';
  const isPrimaryAuthPath = pathname === 'sign-in' || pathname === 'sign-up';
  const shouldGateToSocial =
    isPrimaryAuthPath &&
    !methodIsEmail &&
    !showResendNotice &&
    !message &&
    !token;

  const handleShowEmail = React.useCallback(() => {
    router.navigate({
      to: '/auth/$pathname',
      params: { pathname },
      search: (previous) => ({
        ...previous,
        method: 'email',
      }),
    });
  }, [pathname, router]);

  const handleBackToSocial = React.useCallback(() => {
    router.navigate({
      to: '/auth/$pathname',
      params: { pathname },
      search: ({ method: _method, ...rest }) => rest,
    });
  }, [pathname, router]);

  return (
    <main className="flex grow flex-col items-center justify-center gap-4 bg-background p-4">
      {shouldGateToSocial ? (
        <SocialSignInPanel
          localization={localizedCopy}
          onContinueWithEmail={handleShowEmail}
          pathname={pathname}
          redirectTo={redirectTo}
        />
      ) : (
        <>
          {showResendNotice ? (
            <ResendVerificationNotice redirectTo={redirectTo} />
          ) : null}
          <EmailAuthView
            localization={localizedCopy}
            methodIsEmail={methodIsEmail}
            onBackToSocial={
              methodIsEmail && isPrimaryAuthPath ? handleBackToSocial : undefined
            }
            pathname={pathname}
            redirectTo={redirectTo}
          />
        </>
      )}
    </main>
  );
}

interface SocialSignInPanelProps {
  readonly localization: typeof authLocalization;
  readonly onContinueWithEmail: () => void;
  readonly pathname: string;
  readonly redirectTo: string;
}

function SocialSignInPanel({
  localization,
  onContinueWithEmail,
  pathname,
  redirectTo,
}: SocialSignInPanelProps) {
  const content = useIntlayer('auth');
  const { locale } = useLocale();
  const t = (v: unknown) => toLocalizedString(v, locale ?? undefined);
  const authUI = React.useContext(AuthUIContext);
  const providerDisplays = React.useMemo(
    () => resolveSocialProviderDisplays(authUI.social?.providers),
    [authUI.social?.providers]
  );
  const [pendingProvider, setPendingProvider] = React.useState<
    SocialProviderDisplay['id'] | null
  >(null);

  const handleProviderClick = React.useCallback(
    async (provider: SocialProviderDisplay) => {
      setPendingProvider(provider.id);

      const callbackURL = `${authUI.baseURL}${
        authUI.persistClient
          ? `${authUI.basePath}/${authUI.viewPaths.CALLBACK}?redirectTo=${redirectTo}`
          : redirectTo
      }`;

      try {
        const params = {
          provider: provider.id,
          callbackURL,
          fetchOptions: { throw: true },
        } as const;

        if (authUI.social?.signIn) {
          await authUI.social.signIn(params);
        } else {
          await authUI.authClient.signIn.social(params);
        }

        setTimeout(() => setPendingProvider(null), 10_000);
      } catch (error) {
        const fallbackMessage =
          localization.REQUEST_FAILED || t(content.errors.invalidCredentials);

        authUI.toast({
          variant: 'error',
          message:
            error instanceof Error && error.message
              ? error.message
              : fallbackMessage,
        });

        setPendingProvider(null);
      }
    },
    [authUI, localization.REQUEST_FAILED, redirectTo, content, locale]
  );

  const title =
    pathname === 'sign-up'
      ? localization.SIGN_UP ?? t(content.signUp.title)
      : localization.SIGN_IN ?? t(content.signIn.title);
  const description =
    pathname === 'sign-up'
      ? localization.SIGN_UP_DESCRIPTION
      : localization.SIGN_IN_DESCRIPTION;

  return (
    <div
      className={cn(
        authContainerClassName,
        'w-full max-w-md space-y-6 rounded-xl border bg-background/95 p-8 text-center shadow-lg backdrop-blur'
      )}
    >
      <div className={cn(authHeaderClassName, 'space-y-2 text-center')}>
        <h1 className={authTitleClassName}>{title}</h1>
        {description ? (
          <p className={authDescriptionClassName}>{description}</p>
        ) : null}
      </div>

      {providerDisplays.length > 0 ? (
        <div className="grid gap-3 text-left">
          {providerDisplays.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              variant="outline"
              className={cn(
                provider.buttonClassName,
                pendingProvider && 'pointer-events-none opacity-60'
              )}
              disabled={Boolean(pendingProvider)}
              onClick={() => handleProviderClick(provider)}
            >
              <provider.icon
                aria-hidden="true"
                className={provider.iconClassName ?? 'size-5'}
              />
              {provider.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          {t(content.signIn.orContinueWith)}
        </div>
      )}

      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">{t(content.signIn.emailLabel)}?</p>
        <Button
          type="button"
          variant="ghost"
          className="group w-full justify-center font-medium"
          onClick={onContinueWithEmail}
        >
          {t(content.signIn.orContinueWith)} {t(content.signIn.emailLabel)}
          <ArrowRightIcon
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-1"
          />
        </Button>
      </div>
    </div>
  );
}

interface EmailAuthViewProps {
  readonly localization: typeof authLocalization;
  readonly methodIsEmail: boolean;
  readonly pathname: string;
  readonly redirectTo: string;
  readonly onBackToSocial?: () => void;
}

function EmailAuthView({
  localization,
  methodIsEmail,
  onBackToSocial,
  pathname,
  redirectTo,
}: EmailAuthViewProps) {
  const content = useIntlayer('auth');
  const { locale } = useLocale();
  const t = (v: unknown) => toLocalizedString(v, locale ?? undefined);

  const hideSocial =
    methodIsEmail && (pathname === 'sign-in' || pathname === 'sign-up');

  const classNames = React.useMemo(() => {
    if (!hideSocial) {
      return authViewClassNames;
    }

    return {
      ...authViewClassNames,
      continueWith: 'hidden',
      separator: 'hidden',
      form: authViewClassNames.form
        ? {
            ...authViewClassNames.form,
            providerButton: 'hidden',
          }
        : authViewClassNames.form,
    };
  }, [hideSocial]);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {onBackToSocial ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full max-w-md justify-start gap-2"
          onClick={onBackToSocial}
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          {t(content.signIn.orContinueWith)} GitHub or Google
        </Button>
      ) : null}

      <AuthView
        classNames={classNames}
        localization={localization}
        pathname={pathname}
        redirectTo={redirectTo}
        socialLayout="vertical"
      />
    </div>
  );
}

interface ResendVerificationNoticeProps {
  readonly redirectTo: string;
}

function ResendVerificationNotice({
  redirectTo,
}: ResendVerificationNoticeProps) {
  const content = useIntlayer('auth');
  const { locale } = useLocale();
  const t = (v: unknown) => toLocalizedString(v, locale ?? undefined);
  const resendFn = useServerFn(resendVerificationEmail);
  const [email, setEmail] = React.useState('');
  const [status, setStatus] = React.useState<'idle' | 'pending' | 'success' | 'error'>(
    'idle'
  );
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!email) {
        setError(t(content.errors.invalidVerificationCode));
        return;
      }

      setStatus('pending');
      setError(null);

      try {
        await resendFn({ data: { email, callbackURL: redirectTo } });
        setStatus('success');
      } catch (err) {
        console.error('[auth] resend verification failed', err);
        setError(
          err instanceof Error ? err.message : t(content.errors.expiredCode)
        );
        setStatus('error');
      }
    },
    [email, redirectTo, resendFn, content, locale]
  );

  return (
    <div className="w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">{t(content.verification.title)}</p>
      <p className="mt-1 text-sm">
        {t(content.verification.subtitle)}
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          placeholder={t(content.signIn.emailPlaceholder)}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="sm:flex-1"
        />
        <Button type="submit" disabled={status === 'pending'}>
          {status === 'pending' ? t(content.verification.resendCode) : t(content.verification.submitButton)}
        </Button>
      </form>
      {status === 'success' ? (
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          {t(content.success.emailVerified)}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
