/**
 * Session Info Panel Component
 *
 * Displays session tool configuration information including:
 * - Skills and MCP servers (priority display)
 * - Available agents
 * - Built-in tools
 * - Working directory
 * - Session ID (with copy button)
 * - UI Settings (showThinking toggle)
 */

import { type FC, useState, useEffect } from 'react';
import { Cross2Icon, CopyIcon, CheckIcon } from '@radix-ui/react-icons';
import { SkillsManagerPanel } from './skills-manager-panel';
import { useChatSessionStore } from '~/lib/chat-session-store';

export interface SessionMetadata {
  session_id: string;
  user_id: string;  // 真实的用户 ID，用于 Skills 隔离
  model: string;
  skills: string[];
  mcp_servers: string[];
  agents: string[];
  tools: string[];
  slash_commands: string[];
  cwd: string;
}

interface SessionInfoPanelProps {
  data: SessionMetadata;
  onClose: () => void;
}

// Helper to safely convert array items to strings
// Handles cases where SDK returns objects like { name: string, status: string }
const toStringArray = (arr: unknown[]): string[] => {
  return arr.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && 'name' in item) {
      return String((item as { name: unknown }).name);
    }
    return String(item);
  });
};

export const SessionInfoPanel: FC<SessionInfoPanelProps> = ({ data, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [showSkillsManager, setShowSkillsManager] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ensure we're on the client before accessing the store (SSR safety)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Access store after mount to avoid SSR/hydration issues
  const storeShowThinking = useChatSessionStore((state) => state.showThinking);
  const storeSetShowThinking = useChatSessionStore((state) => state.setShowThinking);

  // Use safe values - default to true before mount
  const showThinking = mounted ? storeShowThinking : true;

  const handleToggleThinking = (checked: boolean) => {
    if (mounted && storeSetShowThinking) {
      storeSetShowThinking(checked);
    }
  };

  const handleCopySessionId = async () => {
    try {
      await navigator.clipboard.writeText(data.session_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy session ID:', error);
    }
  };

  // Safely convert arrays to strings (SDK may return objects with {name, status})
  const skills = toStringArray(data.skills || []);
  const mcpServers = toStringArray(data.mcp_servers || []);
  const agents = toStringArray(data.agents || []);
  const tools = toStringArray(data.tools || []);

  return (
    <div className="absolute bottom-full right-0 z-50 mb-2 w-96 max-h-[80vh] overflow-y-auto rounded-lg border border-[#e5e4df] bg-white p-4 shadow-lg dark:border-[#3a3938] dark:bg-[#1f1e1b]">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-[#1a1a18] text-sm dark:text-[#eee]">
          🔧 会话工具配置
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-[#6b6a68] transition hover:bg-[#e5e4df] dark:text-[#9a9893] dark:hover:bg-[#3a3938]"
          aria-label="关闭"
        >
          <Cross2Icon width={14} height={14} />
        </button>
      </div>

      <div className="space-y-3 text-xs">
        {/* Skills */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="font-medium text-[#1a1a18] dark:text-[#eee]">
              📦 Skills {skills.length > 0 && `(${skills.length})`}
            </div>
            <button
              onClick={() => setShowSkillsManager(!showSkillsManager)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              管理 Skills
            </button>
          </div>
          {skills.length > 0 ? (
            <ul className="space-y-1 pl-4">
              {skills.map((skill) => (
                <li key={skill} className="text-[#6b6a68] dark:text-[#9a9893]">
                  • {skill}
                </li>
              ))}
            </ul>
          ) : (
            <div className="pl-4 text-[#8a8985] italic dark:text-[#b8b5a9]">
              未配置 Skills
            </div>
          )}
        </div>

        {/* MCP 服务器 */}
        <div>
          <div className="mb-1.5 font-medium text-[#1a1a18] dark:text-[#eee]">
            🔌 MCP 服务器 {mcpServers.length > 0 && `(${mcpServers.length})`}
          </div>
          {mcpServers.length > 0 ? (
            <ul className="space-y-1 pl-4">
              {mcpServers.map((server) => (
                <li key={server} className="text-[#6b6a68] dark:text-[#9a9893]">
                  • {server}
                </li>
              ))}
            </ul>
          ) : (
            <div className="pl-4 text-[#8a8985] italic dark:text-[#b8b5a9]">
              未配置 MCP 服务器
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-[#e5e4df] dark:border-[#3a3938]" />

        {/* 子代理 */}
        <div>
          <div className="mb-1 font-medium text-[#1a1a18] dark:text-[#eee]">
            🤖 子代理 ({agents.length})
          </div>
          <div className="pl-4 text-[#6b6a68] dark:text-[#9a9893]">
            {agents.join(', ')}
          </div>
        </div>

        {/* 内置工具 */}
        <div>
          <div className="mb-1 font-medium text-[#1a1a18] dark:text-[#eee]">
            ⚡ 内置工具 ({tools.length})
          </div>
          <details className="pl-4">
            <summary className="cursor-pointer text-[#8a8985] hover:text-[#1a1a18] dark:text-[#b8b5a9] dark:hover:text-[#eee]">
              <span className="inline-block transition group-open:rotate-90">▶</span> 点击查看全部
            </summary>
            <div className="mt-1 text-[#6b6a68] dark:text-[#9a9893]">
              {tools.join(', ')}
            </div>
          </details>
        </div>

        {/* Divider */}
        <div className="border-t border-[#e5e4df] dark:border-[#3a3938]" />

        {/* 工作目录 */}
        <div>
          <div className="mb-1 font-medium text-[#1a1a18] dark:text-[#eee]">
            📍 工作目录
          </div>
          <div className="pl-4 break-all font-mono text-[10px] text-[#6b6a68] dark:text-[#9a9893]">
            {data.cwd}
          </div>
        </div>

        {/* Session ID */}
        <div>
          <div className="mb-1 font-medium text-[#1a1a18] dark:text-[#eee]">
            🆔 Session ID
          </div>
          <div className="flex items-center gap-2 pl-4">
            <code className="flex-1 truncate font-mono text-[10px] text-[#6b6a68] dark:text-[#9a9893]">
              {data.session_id}
            </code>
            <button
              onClick={handleCopySessionId}
              className="rounded p-1 text-[#6b6a68] transition hover:bg-[#e5e4df] dark:text-[#9a9893] dark:hover:bg-[#3a3938]"
              aria-label="复制 Session ID"
            >
              {copied ? (
                <CheckIcon width={12} height={12} className="text-green-600 dark:text-green-400" />
              ) : (
                <CopyIcon width={12} height={12} />
              )}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[#e5e4df] dark:border-[#3a3938]" />

        {/* UI Settings */}
        <div>
          <div className="mb-2 font-medium text-[#1a1a18] dark:text-[#eee]">
            ⚙️ 显示设置
          </div>
          <div className="pl-4 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showThinking}
                onChange={(e) => handleToggleThinking(e.target.checked)}
                className="h-4 w-4 rounded border-[#e5e4df] text-[#ae5630] focus:ring-[#ae5630] dark:border-[#3a3938]"
              />
              <span className="text-[#6b6a68] dark:text-[#9a9893]">
                显示 Thinking/Reasoning
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[#e5e4df] text-[#8a8985] text-[10px] dark:border-[#3a3938] dark:text-[#b8b5a9]">
        提示：可按 Cmd+Shift+I 快速打开此面板
      </div>

      {/* Skills Manager Panel */}
      {showSkillsManager && (
        <SkillsManagerPanel
          userId={data.user_id}
          onClose={() => setShowSkillsManager(false)}
        />
      )}
    </div>
  );
};
