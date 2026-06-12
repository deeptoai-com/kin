import { PanelLeft } from "lucide-react"
import { Button } from "~/components/ui/button"
import { LocaleSwitcher } from "~/components/locale-switcher"
import { Separator } from "~/components/ui/separator"
import { useMatches } from "@tanstack/react-router"
import { useIntlayer } from "react-intlayer"
import { useRailStore } from "~/lib/stores/rail-store"

export function SiteHeader() {
  const matches = useMatches()
  const content = useIntlayer("app")
  const toggleRail = useRailStore((s) => s.toggle)

  // Get the current route's title from the last matching route
  const currentRoute = matches[matches.length - 1]
  const pathname = currentRoute?.pathname || ""

  // Map route paths to i18n content keys
  const getTitleKey = (path: string): keyof typeof content.titles => {
    const titleMap: Record<string, keyof typeof content.titles> = {
      "/agents/documents": "documents",
      "/agents/c": "claudeChat",
      "/agents/image-chat": "imageChat",
      "/agents/workflow": "workflow",
      "/agents/charts": "dashboard",
      "/agents/skills": "skills",
      "/agents/billing": "billing",
      "/agents/settings/billing": "billingSettings",
    }
    if (path.startsWith("/agents/c/")) return "claudeChat"
    return titleMap[path] || "agent"
  }

  const title = content.titles[getTitleKey(pathname)]

  // The collapse key controls the SECONDARY rail (ProjectsRail), which only exists in the
  // 智能体 module (chat + projects). Main sidebar is now a permanent icon rail (no trigger).
  const hasRail = pathname.startsWith("/agents/c") || pathname.startsWith("/agents/projects")

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        {hasRail && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 size-7"
              onClick={() => toggleRail()}
              aria-label="折叠/展开侧边栏"
            >
              <PanelLeft className="size-4" />
            </Button>
            <Separator
              orientation="vertical"
              className="mx-2 data-[orientation=vertical]:h-4"
            />
          </>
        )}
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a
              href="https://x.com/Stephen4171127"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              X
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}
