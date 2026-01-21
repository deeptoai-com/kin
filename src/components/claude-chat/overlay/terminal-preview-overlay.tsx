/**
 * TerminalPreviewOverlay - Overlay for terminal output (Bash/Grep/Glob tools)
 *
 * Features:
 * - Monospace terminal-style display
 * - Command and output sections
 * - Exit code indicator
 * - Copy functionality
 *
 * Aligned with Craft's TerminalPreviewOverlay.tsx implementation.
 */

import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { FullscreenOverlay } from './fullscreen-overlay';

export type ToolType = 'bash' | 'grep' | 'glob';

export interface TerminalPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when the overlay should close */
  onClose: () => void;
  /** The command that was executed */
  command: string;
  /** The output from the command */
  output: string;
  /** Exit code (0 = success) */
  exitCode?: number;
  /** Tool type for display styling */
  toolType?: ToolType;
  /** Optional description of what the command does */
  description?: string;
  /** Error message if tool failed */
  error?: string;
}

const TOOL_CONFIG: Record<ToolType, { icon: string; label: string; variant: 'green' | 'purple' | 'gray' }> = {
  grep: { icon: '🔍', label: 'Grep', variant: 'green' },
  glob: { icon: '📁', label: 'Glob', variant: 'purple' },
  bash: { icon: '💻', label: 'Bash', variant: 'gray' },
};

export function TerminalPreviewOverlay({
  isOpen,
  onClose,
  command,
  output,
  exitCode,
  toolType = 'bash',
  description,
  error,
}: TerminalPreviewOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyOutput = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [output]);

  const config = TOOL_CONFIG[toolType];
  const isSuccess = exitCode === 0 || exitCode === undefined;

  // Truncate command for display in title
  const truncatedCommand = command.length > 50 ? command.slice(0, 50) + '...' : command;

  return (
    <FullscreenOverlay
      isOpen={isOpen}
      onClose={onClose}
      accessibleTitle={`${config.label} output`}
      title={description || truncatedCommand}
      subtitle={exitCode !== undefined ? `Exit code: ${exitCode}` : undefined}
      badge={{
        icon: config.icon,
        label: config.label,
        variant: isSuccess ? config.variant : 'red',
      }}
      error={error ? { label: `${config.label} Failed`, message: error } : undefined}
    >
      <div className="relative flex-1 overflow-auto bg-[#1a1a18] font-mono text-sm text-[#e5e4df]">
        {/* Copy button */}
        <button
          onClick={handleCopyOutput}
          className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-md bg-[#2a2928] px-2.5 py-1.5 text-xs font-medium text-[#e5e4df] hover:bg-[#3a3938]"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>

        <div className="p-4 space-y-4">
          {/* Command section */}
          <div>
            <div className="mb-1 text-xs font-semibold text-[#9a9893]">Command</div>
            <div className="rounded bg-[#2a2928] p-3">
              <pre className="whitespace-pre-wrap break-all text-green-400">$ {command}</pre>
            </div>
          </div>

          {/* Output section */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#9a9893]">Output</span>
              {exitCode !== undefined && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isSuccess
                    ? 'bg-green-900/30 text-green-400'
                    : 'bg-red-900/30 text-red-400'
                }`}>
                  Exit {exitCode}
                </span>
              )}
            </div>
            <div className="rounded bg-[#2a2928] p-3">
              <pre className="whitespace-pre-wrap break-all">{output || '(no output)'}</pre>
            </div>
          </div>
        </div>
      </div>
    </FullscreenOverlay>
  );
}
