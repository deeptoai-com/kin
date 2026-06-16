import type { ComponentType, SVGProps } from 'react';
import RiDashboardLine from '~icons/ri/dashboard-line';
import RiUserSettingsLine from '~icons/ri/user-settings-line';
import RiFileEditLine from '~icons/ri/file-edit-line';
import RiListSettingsLine from '~icons/ri/list-settings-line';
import RiRobot2Line from '~icons/ri/robot-2-line';
import RiLineChartLine from '~icons/ri/line-chart-line';
import RiBankCardLine from '~icons/ri/bank-card-line';
import RiServerLine from '~icons/ri/server-line';
import RiPulseLine from '~icons/ri/pulse-line';
import RiRefreshLine from '~icons/ri/refresh-line';
import RiFileList3Line from '~icons/ri/file-list-3-line';

export type AdminSection =
  | 'overview'
  | 'users'
  | 'usage'
  | 'billing'
  | 'models'
  | 'skills'
  | 'a2composer'
  | 'health'
  | 'performance'
  | 'updates'
  | 'audit';

export interface AdminNavItem {
  section: AdminSection;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  path?: string;
  disabled?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const adminNavGroups: AdminNavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        section: 'overview',
        label: 'Overview',
        description: 'Live system snapshot',
        icon: RiDashboardLine,
        path: '/admin',
      },
    ],
  },
  {
    label: 'People',
    items: [
      {
        section: 'users',
        label: 'Users',
        description: 'Manage users, roles and credits',
        icon: RiUserSettingsLine,
        path: '/admin/users',
      },
    ],
  },
  {
    label: 'Usage & Billing',
    items: [
      {
        section: 'usage',
        label: 'Usage',
        description: 'Token, cost and run aggregates',
        icon: RiLineChartLine,
        disabled: true,
      },
      {
        section: 'billing',
        label: 'Billing',
        description: 'Billing profile and invoices',
        icon: RiBankCardLine,
        disabled: true,
      },
    ],
  },
  {
    label: 'Capabilities',
    items: [
      {
        section: 'models',
        label: 'Models',
        description: 'Model routing and health',
        icon: RiRobot2Line,
        path: '/admin/models',
      },
      {
        section: 'skills',
        label: 'Skills',
        description: 'Skill governance',
        icon: RiListSettingsLine,
        path: '/admin/skills',
      },
      {
        section: 'a2composer',
        label: 'A2Composer',
        description: 'Composer skill presentation',
        icon: RiFileEditLine,
        path: '/admin/a2composer',
      },
    ],
  },
  {
    label: 'System & Ops',
    items: [
      {
        section: 'health',
        label: 'Health',
        description: 'Service health checks',
        icon: RiServerLine,
        disabled: true,
      },
      {
        section: 'performance',
        label: 'Performance',
        description: 'Latency and capacity trends',
        icon: RiPulseLine,
        disabled: true,
      },
      {
        section: 'updates',
        label: 'Updates',
        description: 'Online update status',
        icon: RiRefreshLine,
        disabled: true,
      },
      {
        section: 'audit',
        label: 'Audit Log',
        description: 'Security-relevant events',
        icon: RiFileList3Line,
        disabled: true,
      },
    ],
  },
];

export const adminNavItems = adminNavGroups.flatMap((group) => group.items);

export const defaultAdminSection: AdminSection = 'overview';

export function isAdminSection(value: unknown): value is AdminSection {
  return adminNavItems.some((item) => item.section === value);
}
