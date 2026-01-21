/**
 * FullscreenOverlay - Base component for fullscreen overlays
 *
 * Uses Radix Dialog primitives for:
 * - Focus management (blur on open, restore on close)
 * - ESC key handling
 * - Accessibility (role="dialog", aria-modal)
 *
 * Aligned with Craft's FullscreenOverlayBase.tsx implementation.
 */

import { useEffect, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as CloseIcon } from 'lucide-react';
import { cn } from '~/lib/utils';

export interface FullscreenOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when the overlay should close */
  onClose: () => void;
  /** Content to render inside the overlay */
  children: ReactNode;
  /** Additional CSS classes for the container */
  className?: string;
  /** Accessible title for the overlay (visually hidden) */
  accessibleTitle?: string;
  /** Header title to display */
  title?: string;
  /** Header subtitle to display */
  subtitle?: string;
  /** Badge configuration */
  badge?: {
    icon: string;
    label: string;
    variant: 'blue' | 'green' | 'amber' | 'purple' | 'gray' | 'red';
  };
  /** Optional error state */
  error?: {
    label: string;
    message: string;
  };
  /** Theme mode */
  theme?: 'light' | 'dark';
}

const BADGE_VARIANTS = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function FullscreenOverlay({
  isOpen,
  onClose,
  children,
  className,
  accessibleTitle = 'Overlay',
  title,
  subtitle,
  badge,
  error,
  theme = 'light',
}: FullscreenOverlayProps) {
  // Handle body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const isDark = theme === 'dark';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 animate-in fade-in duration-200" />
        <Dialog.Content
          className={cn(
            'fixed inset-0 z-50 flex flex-col outline-none',
            isDark ? 'bg-[#1e1e1e] text-[#e4e4e4]' : 'bg-white text-[#1a1a1a]',
            className
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Visually hidden title for accessibility */}
          <Dialog.Title className="sr-only">{accessibleTitle}</Dialog.Title>

          {/* Header */}
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#e5e4df] px-4 dark:border-[#3a3938]">
            {/* Badge */}
            {badge && (
              <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', BADGE_VARIANTS[badge.variant])}>
                <span>{badge.icon}</span>
                <span>{badge.label}</span>
              </span>
            )}

            {/* Title */}
            {title && (
              <span className="truncate font-medium">{title}</span>
            )}

            {/* Subtitle */}
            {subtitle && (
              <span className="text-sm text-[#6b6a68] dark:text-[#9a9893]">{subtitle}</span>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Close button */}
            <Dialog.Close asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[#f0f0eb] dark:hover:bg-[#2a2928]"
                aria-label="Close"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/30 dark:bg-red-950/30">
              <CloseIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-xs font-semibold text-red-600/70 dark:text-red-400/70">{error.label}</div>
                <p className="whitespace-pre-wrap break-words text-sm text-red-700 dark:text-red-300">{error.message}</p>
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
