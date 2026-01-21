/**
 * Overlay Components
 *
 * Fullscreen overlay system for previewing tool outputs:
 * - FullscreenOverlay: Base overlay component using Radix Dialog
 * - CodePreviewOverlay: Code file preview (Read/Write tools)
 * - TerminalPreviewOverlay: Terminal output (Bash/Grep/Glob tools)
 * - JSONPreviewOverlay: JSON data preview
 * - DiffPreviewOverlay: Diff preview (Edit tool - single file)
 * - MultiDiffPreviewOverlay: Multi-file diff preview (Edit/Write - aggregated)
 *
 * Aligned with Craft's overlay system.
 */

export { FullscreenOverlay, type FullscreenOverlayProps } from './fullscreen-overlay';
export { CodePreviewOverlay, type CodePreviewOverlayProps } from './code-preview-overlay';
export { TerminalPreviewOverlay, type TerminalPreviewOverlayProps, type ToolType } from './terminal-preview-overlay';
export { JSONPreviewOverlay, type JSONPreviewOverlayProps } from './json-preview-overlay';
export { DiffPreviewOverlay, type DiffPreviewOverlayProps } from './diff-preview-overlay';
export { MultiDiffPreviewOverlay, type MultiDiffPreviewOverlayProps, type FileChange } from './multi-diff-preview-overlay';
