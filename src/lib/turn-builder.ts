import { formatToolDisplayName, formatToolNameForSummary } from '~/lib/tool-display';
import { parseSearchResult, type SearchSource } from '~/lib/search-results';
import type { ContentPart, ToolCallContentPart, TextContentPart } from '~/lib/chat-session-store';

export type StepActivityStatus = 'running' | 'completed' | 'error' | 'backgrounded';

export type StepActivity =
  | {
      id: string;
      kind: 'intermediate' | 'reasoning';
      text: string;
      status: StepActivityStatus;
    }
  | {
      id: string;
      kind: 'tool';
      toolName: string;
      displayName: string;
      args: Record<string, unknown>;
      argsText: string;
      result?: unknown;
      status: StepActivityStatus;
      isError?: boolean;
      elapsedSeconds?: number;
    };

export type SearchGroup = {
  id: string;
  type: 'search-group';
  status: StepActivityStatus;
  displayName: string;
  queries: string[];
  sources: SearchSource[];
  rawText?: string;
  notes: string[];
  activities: StepActivity[];
};

export type RenderItem =
  | { type: 'activity'; activity: StepActivity }
  | { type: 'search-group'; group: SearchGroup };

export type AssistantTurn = {
  activities: StepActivity[];
  responseText: string;
  responseIsStreaming: boolean;
  hasPendingText: boolean;
  previewText: string;
  runningLabel: string | null;
  renderItems: RenderItem[];
  // Cowork collapse-header summary inputs (S2): "Worked Xs · N steps · 改 K 文件".
  /** Sum of per-tool elapsed seconds (from tool_progress); 0 when unavailable. */
  elapsedSeconds: number;
  /** Number of work steps shown when expanded (tool rows + each search group). */
  stepCount: number;
  /** Distinct files touched by Write/Edit/MultiEdit/NotebookEdit in this turn. */
  changedFileCount: number;
};

export function stripMarkdown(text: string): string {
  return text
    .replace(/```(?:\w+)?\n?[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

export function formatArgsSummary(args: Record<string, unknown>): string {
  if (typeof args.query === 'string') return truncate(args.query, 80);
  if (typeof (args as { q?: string }).q === 'string') return truncate((args as { q?: string }).q || '', 80);
  if (typeof args.prompt === 'string') return truncate(args.prompt, 80);
  if (typeof args.pattern === 'string') return `"${truncate(args.pattern, 60)}"`;
  if (typeof args.file_path === 'string') {
    const parts = args.file_path.split('/');
    return parts[parts.length - 1] || args.file_path;
  }
  if (typeof args.path === 'string') {
    const parts = args.path.split('/');
    return parts[parts.length - 1] || args.path;
  }
  if (typeof args.command === 'string') return truncate(args.command, 80);
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  if (keys.length === 1) {
    const value = args[keys[0]];
    if (typeof value === 'string') return truncate(value, 60);
    if (Array.isArray(value)) return `${value.length} items`;
    if (typeof value === 'object' && value) return `{${Object.keys(value as object).length} fields}`;
  }
  return `${keys.length} params`;
}

function isSearchToolName(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower.includes('search');
}

function extractQuery(args: Record<string, unknown>): string | null {
  if (typeof args.query === 'string') return args.query;
  if (typeof (args as { q?: string }).q === 'string') return (args as { q?: string }).q || null;
  if (typeof args.prompt === 'string') return args.prompt;
  if (typeof args.text === 'string') return args.text;
  return null;
}

function mapToolStatus(part: ToolCallContentPart, isRunning: boolean): StepActivityStatus {
  if (part.toolStatus === 'backgrounded') return 'backgrounded';
  if (part.toolStatus === 'error' || part.isError) return 'error';
  if (part.toolStatus === 'completed') return 'completed';
  if (part.result !== undefined) return part.isError ? 'error' : 'completed';
  return isRunning ? 'running' : 'completed';
}

function buildTurnData(content: ContentPart[] | undefined, isRunning: boolean) {
  const activities: StepActivity[] = [];
  const responseParts: TextContentPart[] = [];

  if (!content) {
    return { activities, responseText: '', responseIsStreaming: false, hasPendingText: false };
  }

  // Dedup consecutive duplicate thinking rows (S2.2): the SDK / historical merge
  // can surface the same reasoning text twice in a row. Track the previous
  // reasoning/intermediate text; a tool call or final-answer text resets the run.
  let lastThoughtKey: string | null = null;

  for (let i = 0; i < content.length; i++) {
    const part = content[i];
    if (part.type === 'text') {
      const textPart = part as TextContentPart;
      if (textPart.isIntermediate || textPart.isPending) {
        const key = textPart.text.trim();
        if (key && key === lastThoughtKey) continue;
        if (key) lastThoughtKey = key;
        activities.push({
          id: `intermediate-${i}`,
          kind: 'intermediate',
          text: textPart.text,
          status: textPart.isPending ? 'running' : 'completed',
        });
      } else {
        lastThoughtKey = null;
        responseParts.push(textPart);
      }
    } else if (part.type === 'reasoning') {
      const key = part.text.trim();
      if (key && key === lastThoughtKey) continue;
      if (key) lastThoughtKey = key;
      activities.push({
        id: `reasoning-${i}`,
        kind: 'reasoning',
        text: part.text,
        status: isRunning ? 'running' : 'completed',
      });
    } else if (part.type === 'tool-call') {
      lastThoughtKey = null;
      const toolPart = part as ToolCallContentPart;
      const displayName = formatToolDisplayName(toolPart.toolName);
      activities.push({
        id: toolPart.toolCallId,
        kind: 'tool',
        toolName: toolPart.toolName,
        displayName,
        args: toolPart.args,
        argsText: toolPart.argsText,
        result: toolPart.result,
        status: mapToolStatus(toolPart, isRunning),
        isError: toolPart.isError,
        elapsedSeconds: toolPart.elapsedSeconds,
      });
    }
  }

  const responseText = responseParts.map((part) => part.text).join('\n\n').trim();
  const hasPendingText = content.some((part) => part.type === 'text' && (part as TextContentPart).isPending);

  let finalResponse = responseText;
  if (!finalResponse && !isRunning && activities.length > 0) {
    // Promote last intermediate text when no explicit final response exists
    const lastIntermediate = [...activities].reverse().find((activity) => activity.kind === 'intermediate' && activity.text.trim());
    if (lastIntermediate && 'text' in lastIntermediate) {
      finalResponse = lastIntermediate.text;
    }
  }

  return {
    activities,
    responseText: finalResponse,
    responseIsStreaming: isRunning && Boolean(finalResponse),
    hasPendingText,
  };
}

function buildRenderItems(activities: StepActivity[]): RenderItem[] {
  const items: RenderItem[] = [];
  let currentGroup: SearchGroup | null = null;

  const flushGroup = () => {
    if (!currentGroup) return;
    items.push({ type: 'search-group', group: currentGroup });
    currentGroup = null;
  };

  for (const activity of activities) {
    if (activity.kind === 'tool' && isSearchToolName(activity.toolName)) {
      if (!currentGroup) {
        currentGroup = {
          id: `search-group-${activity.id}`,
          type: 'search-group',
          status: activity.status,
          displayName: activity.displayName || 'Web Search',
          queries: [],
          sources: [],
          rawText: '',
          notes: [],
          activities: [],
        };
      }

      currentGroup.activities.push(activity);
      if (activity.status === 'error') {
        currentGroup.status = 'error';
      } else if (activity.status === 'running' || currentGroup.status === 'running') {
        currentGroup.status = 'running';
      } else {
        currentGroup.status = 'completed';
      }

      const query = extractQuery(activity.args);
      if (query && !currentGroup.queries.includes(query)) {
        currentGroup.queries.push(query);
      }

      if (activity.result !== undefined) {
        const parsed = parseSearchResult(activity.result);
        if (parsed.sources.length > 0) {
          for (const source of parsed.sources) {
            const exists = currentGroup.sources.some((item) => item.url === source.url && item.title === source.title);
            if (!exists) {
              currentGroup.sources.push(source);
            }
          }
        }
        if (parsed.rawText) {
          currentGroup.rawText = currentGroup.rawText
            ? `${currentGroup.rawText}\n\n${parsed.rawText}`
            : parsed.rawText;
        }
      }

      continue;
    }

    if (currentGroup && (activity.kind === 'intermediate' || activity.kind === 'reasoning')) {
      if (activity.text.trim()) {
        currentGroup.notes.push(activity.text);
      }
      continue;
    }

    flushGroup();
    items.push({ type: 'activity', activity });
  }

  flushGroup();
  return items;
}

function getRunningLabel(activities: StepActivity[], isRunning: boolean): string | null {
  if (!isRunning) return null;
  const runningSearch = activities.find(
    (activity) => activity.kind === 'tool' && activity.status === 'running' && isSearchToolName(activity.toolName)
  );
  if (runningSearch) return 'Reviewing sources';
  const runningTool = activities.find((activity) => activity.kind === 'tool' && activity.status === 'running');
  if (runningTool) return 'Processing';
  return 'Thinking';
}

function getPreviewText(activities: StepActivity[], isRunning: boolean, hasResponse: boolean): string {
  if (isRunning && hasResponse) return '正在生成答案…';

  const searchSources = activities
    .filter((activity) => activity.kind === 'tool' && isSearchToolName(activity.toolName))
    .flatMap((activity) => parseSearchResult(activity.result).sources);
  if (searchSources.length > 0) {
    return `Reviewed ${searchSources.length} sources`;
  }

  const hasSearchActivity = activities.some((activity) => activity.kind === 'tool' && isSearchToolName(activity.toolName));
  if (hasSearchActivity) {
    return isRunning ? 'Reviewing sources' : 'Search completed';
  }

  const latestIntermediate = [...activities]
    .reverse()
    .find((activity) => activity.kind === 'intermediate' && activity.text.trim());
  if (latestIntermediate && 'text' in latestIntermediate) {
    return truncate(stripMarkdown(latestIntermediate.text), 80);
  }

  const runningTool = activities.find((activity) => activity.kind === 'tool' && activity.status === 'running');
  if (runningTool && 'displayName' in runningTool) {
    return `${formatToolNameForSummary(runningTool.displayName)}…`;
  }

  const errorCount = activities.filter((activity) => activity.status === 'error').length;
  if (activities.length > 0) {
    return errorCount > 0 ? `步骤已完成 · ${errorCount} 个错误` : '步骤已完成';
  }

  return '开始中…';
}

const FILE_EDIT_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit']);

/** Distinct files touched by Write/Edit/MultiEdit/NotebookEdit tool steps. */
function countChangedFiles(activities: StepActivity[]): number {
  const files = new Set<string>();
  for (const activity of activities) {
    if (activity.kind !== 'tool') continue;
    if (!FILE_EDIT_TOOLS.has(activity.toolName.toLowerCase())) continue;
    const args = (activity.args ?? {}) as Record<string, unknown>;
    const fp =
      (typeof args.file_path === 'string' && args.file_path) ||
      (typeof args.path === 'string' && args.path) ||
      (typeof args.notebook_path === 'string' && args.notebook_path) ||
      '';
    if (fp) files.add(fp);
  }
  return files.size;
}

/** Number of work steps to advertise in the header: tool rows + each search group. */
function countSteps(renderItems: RenderItem[]): number {
  return renderItems.filter(
    (item) => item.type === 'search-group' || (item.type === 'activity' && item.activity.kind === 'tool')
  ).length;
}

export function buildAssistantTurn(content: ContentPart[] | undefined, isRunning: boolean): AssistantTurn {
  const { activities, responseText, responseIsStreaming, hasPendingText } = buildTurnData(content, isRunning);
  const hasResponse = Boolean(responseText);
  const renderItems = buildRenderItems(activities);
  const elapsedSeconds = activities.reduce(
    (sum, activity) => sum + (activity.kind === 'tool' && activity.elapsedSeconds ? activity.elapsedSeconds : 0),
    0
  );
  return {
    activities,
    responseText,
    responseIsStreaming,
    hasPendingText,
    previewText: getPreviewText(activities, isRunning, hasResponse),
    runningLabel: getRunningLabel(activities, isRunning),
    renderItems,
    elapsedSeconds,
    stepCount: countSteps(renderItems),
    changedFileCount: countChangedFiles(activities),
  };
}
