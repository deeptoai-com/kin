import type { ComponentType, SVGProps } from 'react';
import RiDashboardLine from '~icons/ri/dashboard-line';
import RiUserSettingsLine from '~icons/ri/user-settings-line';
import RiBuilding4Line from '~icons/ri/building-4-line';

export type AdminSection = 'dashboard' | 'users' | 'organizations';

export interface AdminNavItem {
  section: AdminSection;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  path: string;
}

export const adminNavItems: AdminNavItem[] = [
  {
    section: 'dashboard',
    label: 'Dashboard',
    description: 'System overview and statistics',
    icon: RiDashboardLine,
    path: '/admin',
  },
  {
    section: 'users',
    label: 'Users',
    description: 'Manage users and credits',
    icon: RiUserSettingsLine,
    path: '/admin/users',
  },
  {
    section: 'organizations',
    label: 'Organizations',
    description: 'Manage organizations',
    icon: RiBuilding4Line,
    path: '/admin/organizations',
  },
];

export const defaultAdminSection: AdminSection = 'dashboard';

export function isAdminSection(value: unknown): value is AdminSection {
  return adminNavItems.some((item) => item.section === value);
}
