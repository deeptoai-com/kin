/**
 * StreamingMarkdown - Optimized markdown rendering for streaming content
 *
 * Features:
 * - Block-based memoization for streaming performance
 * - Consistent rendering for streaming and historical content
 * - Support for render modes (terminal, minimal, full)
 * - File path and URL click handling
 *
 * Aligned with Craft's StreamingMarkdown.tsx implementation.
 */

import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  markdownRemarkPlugins,
  createMarkdownComponents,
  preprocessLinks,
  type RenderMode,
} from '~/components/claude-chat/markdown-components';
import { KbCitation, type KbSource } from '~/components/claude-chat/kb-search-sources';

/**
 * Turn bare [n] citation markers (from kb_search answers) into anchor links the `a`
 * override below renders as clickable source chips. Only applied when the turn actually
 * has kb sources. Handles runs like [2][3] (matched as a whole, then split), skips
 * markdown links `[x](...)`/`[x][y]`, index access `arr[1]`, and code spans/fences.
 */
function preprocessKbCitations(content: string): string {
  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(/(?<![\w\]])((?:\[\d{1,2}\])+)(?!\()/g, (run) =>
            run.replace(/\[(\d{1,2})\]/g, '[$1](#kb-cite-$1)'),
          ),
    )
    .join('');
}

type StreamingMarkdownProps = {
  content: string;
  isStreaming: boolean;
  /**
   * Render mode controlling formatting level
   * @default 'minimal'
   */
  mode?: RenderMode;
  /**
   * Callback when a URL is clicked
   */
  onUrlClick?: (url: string) => void;
  /**
   * Callback when a file path is clicked
   */
  onFileClick?: (path: string) => void;
  /**
   * kb_search sources for this turn — enables rendering bare [n] markers as
   * clickable citation chips (hover/click → source passage popover).
   */
  kbSources?: KbSource[];
};

type Block = {
  content: string;
  isCodeBlock: boolean;
};

function simpleHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function splitIntoBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let currentBlock = '';
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        if (currentBlock.trim()) {
          blocks.push({ content: currentBlock.trim(), isCodeBlock: false });
          currentBlock = '';
        }
        inCodeBlock = true;
        currentBlock = `${line}\n`;
      } else {
        currentBlock += line;
        blocks.push({ content: currentBlock, isCodeBlock: true });
        currentBlock = '';
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      currentBlock += `${line}\n`;
      continue;
    }

    if (line === '') {
      if (currentBlock.trim()) {
        blocks.push({ content: currentBlock.trim(), isCodeBlock: false });
        currentBlock = '';
      }
      continue;
    }

    currentBlock = currentBlock ? `${currentBlock}\n${line}` : line;
  }

  if (currentBlock) {
    blocks.push({
      content: inCodeBlock ? currentBlock : currentBlock.trim(),
      isCodeBlock: inCodeBlock,
    });
  }

  return blocks;
}

interface MemoizedBlockProps {
  content: string;
  mode?: RenderMode;
  onUrlClick?: (url: string) => void;
  onFileClick?: (path: string) => void;
  kbSources?: KbSource[];
}

const MemoizedBlock = memo(
  function MemoizedBlock({ content, mode = 'minimal', onUrlClick, onFileClick, kbSources }: MemoizedBlockProps) {
    const hasCitations = !!kbSources?.length;
    // Preprocess content to convert raw URLs and file paths to markdown links
    const processedContent = useMemo(() => {
      const linked = preprocessLinks(content);
      return hasCitations ? preprocessKbCitations(linked) : linked;
    }, [content, hasCitations]);

    // Create components with callbacks; with kb sources, the `a` override renders
    // #kb-cite-n anchors as source chips (hover/click → passage popover).
    const components = useMemo<Components>(() => {
      const base = createMarkdownComponents({ mode, onUrlClick, onFileClick });
      if (!hasCitations) return base;
      const BaseA = base.a as React.ComponentType<Record<string, unknown>> | undefined;
      const CitationAwareA = (props: { href?: string; children?: React.ReactNode } & Record<string, unknown>) => {
        const href = props.href ?? '';
        if (href.startsWith('#kb-cite-')) {
          const n = Number(href.slice('#kb-cite-'.length));
          return <KbCitation n={n} source={kbSources!.find((s) => s.n === n)} />;
        }
        return BaseA ? <BaseA {...props} /> : <a {...(props as React.ComponentProps<'a'>)} />;
      };
      return { ...base, a: CitationAwareA as Components['a'] };
    }, [mode, onUrlClick, onFileClick, hasCitations, kbSources]);

    return (
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.mode === next.mode &&
    prev.onUrlClick === next.onUrlClick &&
    prev.onFileClick === next.onFileClick &&
    prev.kbSources === next.kbSources
);

export const StreamingMarkdown = ({
  content,
  isStreaming,
  mode = 'minimal',
  onUrlClick,
  onFileClick,
  kbSources,
}: StreamingMarkdownProps) => {
  const blocks = useMemo(
    () => (isStreaming ? splitIntoBlocks(content) : []),
    [content, isStreaming]
  );

  if (!isStreaming) {
    return (
      <MemoizedBlock
        content={content}
        mode={mode}
        onUrlClick={onUrlClick}
        onFileClick={onFileClick}
        kbSources={kbSources}
      />
    );
  }

  return (
    <>
      {blocks.map((block, index) => {
        const isLastBlock = index === blocks.length - 1;
        const key = isLastBlock ? `active-${index}` : `block-${simpleHash(block.content)}`;
        return (
          <MemoizedBlock
            key={key}
            content={block.content}
            mode={mode}
            onUrlClick={onUrlClick}
            onFileClick={onFileClick}
            kbSources={block.isCodeBlock ? undefined : kbSources}
          />
        );
      })}
    </>
  );
};
