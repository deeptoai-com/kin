import { useLocale } from 'react-intlayer';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import Globe from 'virtual:icons/ri/global-line';

/**
 * LocaleSwitcher Component
 *
 * Allows users to switch between available languages.
 * Uses a dropdown menu with a globe icon.
 */
export function LocaleSwitcher() {
  const { locale, setLocale, availableLocales } = useLocale();

  const localeNames: Record<string, string> = {
    en: 'English',
    zh: '中文',
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label="Switch language">
          <Globe className="size-4 shrink-0" />
          <span>{localeNames[locale] || locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {availableLocales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => setLocale(loc)}
            className={locale === loc ? 'bg-accent' : ''}
          >
            {localeNames[loc] || loc}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
