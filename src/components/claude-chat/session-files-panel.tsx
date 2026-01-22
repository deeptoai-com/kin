/**
 * Session Files Panel
 *
 * Displays a tree view of session root files (entire session, not just workspace).
 * Shows read-only file structure with on-demand content preview.
 * Filters out system files (.artifacts.json, session.jsonl, hidden files, node_modules).
 * Auto-refreshes every 8 seconds to sync with file changes.
 *
 * Uses independent session API: /api/session/:sessionId/files
 * Separate from workspace API used by Sandpack/Workspace.
 *
 * Part of P12: 会话文件树 + 变更同步
 */

import type { FC } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  File,
  Folder,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  FolderOpen,
  X,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export interface SessionFilesPanelProps {
  sessionId: string;
  onFileSelect?: (filePath: string) => void;
  onClose?: () => void;
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: number;
  children?: FileNode[] | Record<string, FileNode>;
}

/**
 * File metadata from API
 */
interface FileMetadata {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
}

/**
 * Build a tree structure from file metadata array
 */
function buildFileTree(files: FileMetadata[]): FileNode[] {
  const root: Record<string, FileNode> = {};

  for (const file of files) {
    const parts = file.path.split('/');
    let current: Record<string, FileNode> = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      if (!current[part]) {
        current[part] = {
          name: part,
          path: fullPath,
          isDirectory: !isLast || file.type === 'directory',
          size: isLast ? file.size : undefined,
          modified: isLast ? file.modified : undefined,
          children: isLast ? undefined : {},
        };
      }

      if (!isLast && current[part].children) {
        current = current[part].children as Record<string, FileNode>;
      }
    }
  }

  // Convert record to array and sort
  const convertToArray = (nodes: Record<string, FileNode>): FileNode[] => {
    const result = Object.values(nodes);
    result.sort((a, b) => {
      // Directories first, then files
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    // Recursively convert children
    for (const node of result) {
      if (node.children && typeof node.children === 'object' && !Array.isArray(node.children)) {
        node.children = convertToArray(node.children);
      }
    }

    return result;
  };

  return convertToArray(root);
}

/**
 * Encode file path for URL
 */
function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Get file extension for icon styling
 */
function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

/**
 * File Tree Node Component
 */
const FileTreeNode: FC<{
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onFileSelect?: (filePath: string) => void;
}> = ({ node, depth, selectedPath, onFileSelect }) => {
  const [isExpanded, setIsExpanded] = useState(depth === 0);

  const isSelected = selectedPath === node.path;
  const ext = getFileExtension(node.name);

  const handleClick = async () => {
    if (node.isDirectory) {
      setIsExpanded(!isExpanded);
    } else {
      // P12 fix: Call onFileSelect with just filePath (parent handles content loading)
      onFileSelect?.(node.path);
    }
  };

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        className={cn(
          'w-full justify-start gap-1.5 h-7 px-1.5 text-xs font-normal rounded-md',
          'hover:bg-muted/50',
          isSelected && 'bg-muted/80 text-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {node.isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
          </>
        ) : (
          <File
            className={cn(
              'h-3.5 w-3.5 shrink-0 ml-5',
              ext === 'ts' || ext === 'tsx' ? 'text-blue-500' :
              ext === 'js' || ext === 'jsx' ? 'text-yellow-500' :
              ext === 'json' ? 'text-green-500' :
              ext === 'md' ? 'text-purple-500' :
              ext === 'css' || ext === 'scss' ? 'text-pink-500' :
              'text-muted-foreground'
            )}
          />
        )}
        <span className="truncate">{node.name}</span>
      </Button>

      {node.isDirectory && isExpanded && node.children && Array.isArray(node.children) && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Session Files Panel
 * Displays session workspace files with filtering
 */
// P12: Polling interval for file changes (8 seconds)
const POLL_INTERVAL = 8000

export const SessionFilesPanel: FC<SessionFilesPanelProps> = ({
  sessionId,
  onFileSelect,
  onClose,
}) => {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isPollingEnabled, setIsPollingEnabled] = useState(true)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadFiles = useCallback(async (isBackground = false) => {
    // Don't show loading state for background polling
    if (!isBackground) {
      setIsLoading(true)
    }
    setError(null)

    try {
      // P12: Use independent session API (separate from workspace API)
      const response = await fetch(`/api/session/${sessionId}/files`)
      if (!response.ok) {
        throw new Error('Failed to load session files')
      }

      const data = await response.json()
      setFiles(data.files || [])
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to load session files:', err)
      // Only show error for manual refresh, not background polling
      if (!isBackground) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      if (!isBackground) {
        setIsLoading(false)
      }
    }
  }, [sessionId])

  // P12: Set up polling for file changes
  useEffect(() => {
    if (!isPollingEnabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      return
    }

    // Initial load
    loadFiles()

    // Set up polling interval
    pollIntervalRef.current = setInterval(() => {
      loadFiles(true) // Background refresh
    }, POLL_INTERVAL)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [loadFiles, isPollingEnabled])

  const handleRefresh = () => {
    loadFiles()
    // Reset polling timer on manual refresh
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = setInterval(() => {
        loadFiles(true)
      }, POLL_INTERVAL)
    }
  }

  const fileTree = buildFileTree(files);

  return (
    <div className="session-files-panel h-full flex flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium">会话文件</span>
          <span className="text-[10px] text-muted-foreground">
            ({files.length} 个文件)
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            title="刷新"
            className="h-6 w-6"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </Button>

          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="关闭"
              className="h-6 w-6"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto p-2">
        {isLoading && files.length === 0 ? (
          <div className="px-2 py-4 text-xs text-muted-foreground text-center">
            加载中...
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-destructive text-center">
            加载失败: {error}
          </div>
        ) : files.length === 0 ? (
          <div className="px-2 py-4 text-xs text-muted-foreground text-center">
            暂无文件
          </div>
        ) : (
          fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              sessionId={sessionId}
              depth={0}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              onPathSelect={setSelectedPath}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t bg-muted/20 text-[10px] text-muted-foreground">
        更新于 {lastRefresh.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
};

export default SessionFilesPanel;
