/**
 * JSON Artifact Component
 *
 * Renders JSON content with syntax highlighting and collapsible tree view.
 */

import type { FC } from 'react';
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

interface JSONArtifactProps {
  content: string;
  title?: string;
}

/**
 * JSON Tree Node component for recursive rendering
 */
const JSONNode: FC<{
  keyName?: string;
  value: unknown;
  depth: number;
}> = ({ keyName, value, depth }) => {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  const valueType = typeof value;
  const isObject = value !== null && valueType === 'object';
  const isArray = Array.isArray(value);
  const entries = isObject ? Object.entries(value as Record<string, unknown>) : [];

  // Color coding for different types
  const getValueColor = () => {
    if (value === null) return 'text-gray-500';
    if (valueType === 'boolean') return 'text-purple-500';
    if (valueType === 'number') return 'text-blue-500';
    if (valueType === 'string') return 'text-green-600 dark:text-green-400';
    return 'text-foreground';
  };

  // Render primitive values
  if (!isObject) {
    return (
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-amber-600 dark:text-amber-400">"{keyName}":</span>
        )}
        <span className={getValueColor()}>
          {valueType === 'string' ? `"${value}"` : String(value)}
        </span>
      </div>
    );
  }

  // Render objects and arrays
  const bracket = isArray ? ['[', ']'] : ['{', '}'];
  const isEmpty = entries.length === 0;

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-center gap-1">
        {!isEmpty && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-0.5 hover:bg-muted/50 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
        {keyName !== undefined && (
          <span className="text-amber-600 dark:text-amber-400">"{keyName}":</span>
        )}
        <span className="text-muted-foreground">{bracket[0]}</span>
        {!isExpanded && !isEmpty && (
          <>
            <span className="text-xs text-muted-foreground mx-1">
              {entries.length} {isArray ? 'items' : 'keys'}
            </span>
            <span className="text-muted-foreground">{bracket[1]}</span>
          </>
        )}
        {isEmpty && <span className="text-muted-foreground">{bracket[1]}</span>}
      </div>

      {isExpanded && !isEmpty && (
        <div>
          {entries.map(([key, val], index) => (
            <JSONNode
              key={`${key}-${index}`}
              keyName={isArray ? undefined : key}
              value={val}
              depth={depth + 1}
            />
          ))}
          <div style={{ paddingLeft: 16 }}>
            <span className="text-muted-foreground">{bracket[1]}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const JSONArtifact: FC<JSONArtifactProps> = ({ content, title }) => {
  const [copied, setCopied] = useState(false);

  const { parsed, error, formatted } = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      return { parsed, error: null, formatted };
    } catch (e) {
      return { parsed: null, error: e instanceof Error ? e.message : 'Invalid JSON', formatted: content };
    }
  }, [content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">JSON</span>
          {error && (
            <span className="text-xs text-destructive">Parse Error: {error}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span className="text-xs">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="text-xs">复制</span>
            </>
          )}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        {error ? (
          <pre className="whitespace-pre-wrap break-all text-muted-foreground">
            {content}
          </pre>
        ) : (
          <JSONNode value={parsed} depth={0} />
        )}
      </div>
    </div>
  );
};

export default JSONArtifact;
