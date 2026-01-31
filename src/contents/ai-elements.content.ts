import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * AI Elements interface content dictionary
 * Contains labels for AI SDK UI components (prompt-input, reasoning, tool, etc.)
 */
const aiElementsContent = {
  content: {
    // Prompt Input Component
    promptInput: {
      placeholder: t({
        en: 'What would you like to know?',
        zh: '您想了解什么？',
      }),
      addAttachments: t({
        en: 'Add photos or files',
        zh: '添加图片或文件',
      }),
      removeAttachment: t({
        en: 'Remove attachment',
        zh: '移除附件',
      }),
      uploadFiles: t({
        en: 'Upload files',
        zh: '上传文件',
      }),
      submit: t({
        en: 'Submit',
        zh: '提交',
      }),
      unknownFile: t({
        en: 'Unknown file',
        zh: '未知文件',
      }),
      errors: {
        accept: t({
          en: 'No files match the accepted types.',
          zh: '没有文件符合接受的类型。',
        }),
        maxSize: t({
          en: 'All files exceed the maximum size.',
          zh: '所有文件都超过了最大大小限制。',
        }),
        maxFiles: t({
          en: 'Too many files. Some were not added.',
          zh: '文件太多，部分未被添加。',
        }),
      },
    },

    // Reasoning Component
    reasoning: {
      thinking: t({
        en: 'Thinking...',
        zh: '思考中...',
      }),
      thoughtFewSeconds: t({
        en: 'Thought for a few seconds',
        zh: '思考了几秒',
      }),
      thoughtSeconds: t({
        en: 'Thought for {count} seconds',
        zh: '思考了 {count} 秒',
      }),
    },

    // Session Sidebar
    sessionSidebar: {
      title: t({ en: 'Sessions', zh: '会话' }),
      newSession: t({ en: 'New session', zh: '新建会话' }),
      noSessionsYet: t({ en: 'No sessions yet', zh: '暂无会话' }),
      clickToCreate: t({ en: 'Click + to create a new session', zh: '点击 + 创建新会话' }),
    },

    // Chat surface (empty state, composer)
    chatSurface: {
      startConversation: t({ en: 'Start a conversation', zh: '开始对话' }),
      askAnything: t({ en: 'Ask me anything about your codebase.', zh: '关于代码库的任何问题都可以问我。' }),
      typeYourMessage: t({ en: 'Type your message...', zh: '输入消息...' }),
      send: t({ en: 'Send', zh: '发送' }),
      retry: t({ en: 'Retry', zh: '重试' }),
      copy: t({ en: 'Copy', zh: '复制' }),
      startOrSelect: t({
        en: 'Start a conversation or select a session from the sidebar',
        zh: '开始对话或从侧栏选择会话',
      }),
    },

    // Tool Component
    tool: {
      status: {
        pending: t({
          en: 'Pending',
          zh: '等待中',
        }),
        running: t({
          en: 'Running',
          zh: '运行中',
        }),
        completed: t({
          en: 'Completed',
          zh: '已完成',
        }),
        error: t({
          en: 'Error',
          zh: '错误',
        }),
      },
      parameters: t({
        en: 'Parameters',
        zh: '参数',
      }),
      result: t({
        en: 'Result',
        zh: '结果',
      }),
      errorLabel: t({
        en: 'Error',
        zh: '错误',
      }),
    },

    // Code Block Component
    codeBlock: {
      copy: t({
        en: 'Copy',
        zh: '复制',
      }),
      copied: t({
        en: 'Copied!',
        zh: '已复制！',
      }),
    },

    // Message Component
    message: {
      user: t({
        en: 'You',
        zh: '你',
      }),
      assistant: t({
        en: 'Assistant',
        zh: '助手',
      }),
    },
  },
  key: 'ai-elements',
} satisfies Dictionary;

export default aiElementsContent;
