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
import ReactMarkdown from 'react-markdown';
import {
  markdownRemarkPlugins,
  createMarkdownComponents,
  preprocessLinks,
  type RenderMode,
} from '~/components/claude-chat/markdown-components';

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
}

const MemoizedBlock = memo(
  function MemoizedBlock({ content, mode = 'minimal', onUrlClick, onFileClick }: MemoizedBlockProps) {
    // Preprocess content to convert raw URLs and file paths to markdown links
    const processedContent = useMemo(() => preprocessLinks(content), [content]);

    // Create components with callbacks
    const components = useMemo(
      () => createMarkdownComponents({ mode, onUrlClick, onFileClick }),
      [mode, onUrlClick, onFileClick]
    );

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
    prev.onFileClick === next.onFileClick
);

export const StreamingMarkdown = ({
  content,
  isStreaming,
  mode = 'minimal',
  onUrlClick,
  onFileClick,
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
          />
        );
      })}
    </>
  );
};
