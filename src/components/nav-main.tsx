import { Link } from "@tanstack/react-router";
import type { ComponentType, SVGProps } from "react";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";

export interface NavItem {
	title: string;
	url: string;
	icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

export interface NavSection {
	title?: string; // Optional section label
	items: NavItem[];
	// Show a visual divider after this section
	hasDivider?: boolean;
}

export function NavMain({
	sections,
}: {
	sections: NavSection[];
}) {
	return (
		<>
			{sections.map((section, sectionIndex) => (
				<SidebarGroup key={sectionIndex}>
					{section.title && (
						<SidebarGroupLabel className="text-xs font-medium text-muted-foreground/70 px-2 pt-4 pb-2">
							{section.title}
						</SidebarGroupLabel>
					)}
					<SidebarGroupContent className="flex flex-col gap-0.5">
						<SidebarMenu>
							{section.items.map((item) => (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton asChild tooltip={item.title}>
										<Link to={item.url}>
											{item.icon && <item.icon className="size-4" />}
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
						{section.hasDivider && (
							<div className="my-2 border-t border-border/50" />
						)}
					</SidebarGroupContent>
				</SidebarGroup>
			))}
		</>
	);
}
