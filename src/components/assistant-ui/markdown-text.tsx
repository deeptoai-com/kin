import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { FC } from 'react';
import { markdownComponents, markdownRemarkPlugins } from '~/components/claude-chat/markdown-components';

export const MarkdownText: FC = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={markdownRemarkPlugins}
      components={markdownComponents}
    />
  );
};
