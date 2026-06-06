import { SignedIn, SignedOut } from '@daveyplate/better-auth-ui';
import { Link } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { ClientOnly } from './client-only';
import { LocaleSwitcher } from './locale-switcher';
import { ModeToggle } from './mode-toggle';
import { Button } from './ui/button';

export function Header() {
  const content = useIntlayer('app');

  return (
    <header className="sticky top-0 z-50 border-b bg-background/60 px-4 py-3 backdrop-blur">
      <div className="container mx-auto flex items-center justify-between">
        <Link to="/" className="font-bold text-2xl text-foreground">
          {content.common.appName}
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            to="/agents/claude-chat"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {content.nav.claudeChat}
          </Link>
          <Link
            to="/agents/skills"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {content.nav.skillsStore}
          </Link>
          <a
            href="https://x.com/Stephen4171127"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            X
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>External link icon</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>

          {/* TanStack Start - Client-only theme toggle */}
          <ClientOnly fallback={<div className="w-6" />}>
            <ModeToggle />
          </ClientOnly>

          <ClientOnly fallback={<div className="h-9 w-9 shrink-0 rounded-md border bg-muted" title="Language" />}>
            <LocaleSwitcher />
          </ClientOnly>

          {/* Client-only auth components to avoid SSR hydration errors */}
          <ClientOnly fallback={null}>
            <SignedOut>
              <Link to="/auth/$pathname" params={{ pathname: 'sign-in' }}>
                <Button className="rounded-full bg-primary px-6 font-medium text-primary-foreground text-sm hover:bg-primary/90">
                  {content.buttons.signIn} <span className="ml-1">↗</span>
                </Button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/agents/claude-chat">
                <Button className="rounded-full bg-primary px-6 font-medium text-primary-foreground text-sm hover:bg-primary/90">
                  {content.buttons.agentChat} <span className="ml-1">↗</span>
                </Button>
              </Link>
            </SignedIn>
          </ClientOnly>
        </nav>
      </div>
    </header>
  );
}
