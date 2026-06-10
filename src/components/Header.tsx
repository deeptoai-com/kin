import { SignedIn, SignedOut } from '@daveyplate/better-auth-ui';
import { Link } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { ClientOnly } from './client-only';
import { LocaleSwitcher } from './locale-switcher';
import { ModeToggle } from './mode-toggle';
import { Button } from './ui/button';

const GH = 'https://github.com/foreveryh/oxygenie';

function BrandGlyph() {
  return (
    <svg viewBox="0 0 30 30" className="h-7 w-7 overflow-visible" aria-hidden="true">
      <title>OxyGenie</title>
      <circle
        cx="15"
        cy="15"
        r="11"
        fill="none"
        stroke="var(--green-deep)"
        strokeWidth="2"
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      <circle cx="26" cy="9" r="3.4" fill="var(--green)" />
    </svg>
  );
}

export function Header() {
  const content = useIntlayer('app');

  const navLink =
    'font-mono text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground';

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
      <div className="container mx-auto flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2.5 font-mono text-xl font-extrabold tracking-tight text-foreground"
        >
          <BrandGlyph />
          <span>
            Oxy<span className="text-primary">Genie</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link to="/agents/skills" className={navLink}>
            {content.nav.skillsStore}
          </Link>
          <a href={GH} target="_blank" rel="noopener noreferrer" className={`${navLink} hidden sm:inline`}>
            github
          </a>

          {/* TanStack Start - Client-only theme toggle */}
          <ClientOnly fallback={<div className="w-6" />}>
            <ModeToggle />
          </ClientOnly>

          <ClientOnly
            fallback={<div className="h-9 w-9 shrink-0 rounded-md border bg-muted" title="Language" />}
          >
            <LocaleSwitcher />
          </ClientOnly>

          {/* Client-only auth components to avoid SSR hydration errors */}
          <ClientOnly fallback={null}>
            <SignedOut>
              <Link to="/auth/$pathname" params={{ pathname: 'sign-in' }}>
                <Button className="rounded-[4px] bg-foreground px-5 font-mono font-semibold text-background text-sm transition-colors hover:bg-[var(--green)] hover:text-[#0f1411]">
                  {content.buttons.signIn} <span className="ml-1">→</span>
                </Button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/agents/c">
                <Button className="rounded-[4px] bg-foreground px-5 font-mono font-semibold text-background text-sm transition-colors hover:bg-[var(--green)] hover:text-[#0f1411]">
                  {content.buttons.agentChat} <span className="ml-1">→</span>
                </Button>
              </Link>
            </SignedIn>
          </ClientOnly>
        </nav>
      </div>
    </header>
  );
}
