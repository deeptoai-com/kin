/**
 * Admin Layout Component
 *
 * Layout wrapper for admin pages with sidebar navigation
 */

import * as React from 'react';
import { Outlet, useNavigate, Link, useLocation } from '@tanstack/react-router';
import RiLogoutBoxLine from '~icons/ri/logout-box-line';
import RiArrowLeftLine from '~icons/ri/arrow-left-line';
import { adminNavItems, type AdminSection } from './admin-nav';
import { authClient } from '~/lib/auth-client';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

interface AdminLayoutProps {
  readonly activeSection: AdminSection;
}

export function AdminLayout({ activeSection }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine active section from current route path
  const getActiveSectionFromPath = (): AdminSection => {
    const pathname = location.pathname;

    if (pathname === '/admin' || pathname === '/admin/') return 'dashboard';
    if (pathname.startsWith('/admin/users')) return 'users';
    if (pathname.startsWith('/admin/organizations')) return 'organizations';
    if (pathname.startsWith('/admin/a2composer')) return 'a2composer';

    return 'dashboard';
  };

  const currentActiveSection = getActiveSectionFromPath();

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      navigate({ to: '/auth/sign-in' });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Admin Panel
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.section === currentActiveSection;

              return (
                <li key={item.section}>
                  <Link
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate({ to: '/agents/claude-chat' })}
          >
            <RiArrowLeftLine className="h-4 w-4 mr-2" />
            Back to App
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={handleLogout}
          >
            <RiLogoutBoxLine className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
