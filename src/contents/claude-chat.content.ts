import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * Claude Chat interface content dictionary
 * Contains all text labels for the Claude Agent Chat interface
 */
const claudeChatContent = {
  content: {
    header: {
      title: t({
        en: 'Claude Chat',
        zh: 'Claude Chat',
      }),
      newChat: t({
        en: 'New Chat',
        zh: '新建聊天',
      }),
      clearHistory: t({
        en: 'Clear History',
        zh: '清除历史',
      }),
    },
    sidebar: {
      sessions: t({
        en: 'Sessions',
        zh: '会话',
      }),
      today: t({
        en: 'Today',
        zh: '今天',
      }),
      yesterday: t({
        en: 'Yesterday',
        zh: '昨天',
      }),
      lastWeek: t({
        en: 'Last 7 Days',
        zh: '过去 7 天',
      }),
      lastMonth: t({
        en: 'Last 30 Days',
        zh: '过去 30 天',
      }),
      noSessions: t({
        en: 'No sessions yet',
        zh: '暂无会话',
      }),
      expand: t({
        en: 'Expand session list',
        zh: '展开会话列表',
      }),
      collapse: t({
        en: 'Collapse session list',
        zh: '收起会话列表',
      }),
    },
    chatInput: {
      placeholder: t({
        en: 'Send a message to Claude...',
        zh: '向 Claude 发送消息...',
      }),
      placeholderGreeting: t({
        en: 'How can I help you today?',
        zh: '今天我能帮你什么？',
      }),
      attachFile: t({
        en: 'Attach file',
        zh: '附件',
      }),
      send: t({
        en: 'Send',
        zh: '发送',
      }),
      stop: t({
        en: 'Stop',
        zh: '停止',
      }),
    },
    message: {
      user: t({
        en: 'You',
        zh: '你',
      }),
      assistant: t({
        en: 'Claude',
        zh: 'Claude',
      }),
      copy: t({
        en: 'Copy',
        zh: '复制',
      }),
      copied: t({
        en: 'Copied!',
        zh: '已复制！',
      }),
      regenerate: t({
        en: 'Regenerate',
        zh: '重新生成',
      }),
      delete: t({
        en: 'Delete',
        zh: '删除',
      }),
      copyCode: t({
        en: 'Copy code',
        zh: '复制代码',
      }),
      copyNew: t({
        en: 'Copy New',
        zh: '复制新内容',
      }),
    },
    overlay: {
      close: t({
        en: 'Close',
        zh: '关闭',
      }),
      copied: t({
        en: 'Copied',
        zh: '已复制',
      }),
      copy: t({
        en: 'Copy',
        zh: '复制',
      }),
      command: t({
        en: 'Command',
        zh: '命令',
      }),
      output: t({
        en: 'Output',
        zh: '输出',
      }),
    },
    workspacePanel: {
      title: t({
        en: 'Workspace',
        zh: '工作区',
      }),
      filesLabel: t({
        en: 'FILES',
        zh: '文件',
      }),
      filesCount: t({
        en: '{count} files',
        zh: '{count} 个文件',
      }),
      workspaceSkills: t({
        en: 'Workspace Skills',
        zh: '工作区技能',
      }),
      noSkillFound: t({
        en: 'No SKILL.md found',
        zh: '未找到 SKILL.md',
      }),
      downloadWorkspace: t({
        en: 'Download workspace',
        zh: '下载工作区',
      }),
      loadingWorkspace: t({
        en: 'Loading workspace...',
        zh: '正在加载工作区...',
      }),
      noFilesYet: t({
        en: 'No files in workspace yet. Start chatting to create files!',
        zh: '工作区暂无文件，开始对话以创建文件！',
      }),
    },
    contextBadges: {
      viewSkillsExample: t({
        en: 'View Skills examples',
        zh: '查看 Skills 示例',
      }),
      openSkillsStore: t({
        en: 'Open Skills Store',
        zh: '打开 Skills Store',
      }),
      currentSessionSkills: t({
        en: 'Skills available in this session',
        zh: '当前会话可用 Skills',
      }),
      moreSkills: t({
        en: 'More Skills',
        zh: '更多 Skills',
      }),
      loadingExamples: t({
        en: 'Loading examples...',
        zh: '正在加载示例...',
      }),
      noSkillsEnabled: t({
        en: 'No Skills enabled',
        zh: '暂无启用的 Skills',
      }),
      exampleIndex: t({
        en: 'Example {n}',
        zh: '示例 {n}',
      }),
      noExamples: t({
        en: 'No examples',
        zh: '暂无示例',
      }),
    },
    sessionMenu: {
      rename: t({
        en: 'Rename',
        zh: '重命名',
      }),
      delete: t({
        en: 'Delete',
        zh: '删除',
      }),
      export: t({
        en: 'Export',
        zh: '导出',
      }),
      share: t({
        en: 'Share',
        zh: '分享',
      }),
    },
    sessionSwitch: {
      title: t({
        en: 'Session In Progress',
        zh: '会话进行中',
      }),
      message: t({
        en: 'A query is currently running. Please wait for it to complete before switching sessions.',
        zh: '当前有查询正在运行。请等待完成后再切换会话。',
      }),
      confirm: t({
        en: 'OK',
        zh: '确定',
      }),
    },
    artifacts: {
      title: t({
        en: 'Artifacts',
        zh: '成果物',
      }),
      noArtifacts: t({
        en: 'No artifacts generated yet',
        zh: '尚未生成成果物',
      }),
      openPreview: t({
        en: 'Open Preview',
        zh: '打开预览',
      }),
      openInNewTab: t({
        en: 'Open in New Tab',
        zh: '在新标签页中打开',
      }),
    },
    tools: {
      title: t({
        en: 'Tools',
        zh: '工具',
      }),
      running: t({
        en: 'Running',
        zh: '运行中',
      }),
      completed: t({
        en: 'Completed',
        zh: '已完成',
      }),
      failed: t({
        en: 'Failed',
        zh: '失败',
      }),
      viewDetails: t({
        en: 'View Details',
        zh: '查看详情',
      }),
    },
    buttons: {
      loading: t({
        en: 'Creating...',
        zh: '创建中...',
      }),
    },
    actions: {
      viewStats: t({
        en: 'View statistics',
        zh: '查看统计信息',
      }),
      helpful: t({
        en: 'Helpful',
        zh: '有帮助',
      }),
      notHelpful: t({
        en: 'Not helpful',
        zh: '没帮助',
      }),
      viewFileChanges: t({
        en: 'View all {count} file changes',
        zh: '查看全部 {count} 个文件变更',
      }),
    },
    status: {
      connecting: t({
        en: 'Connecting to Claude...',
        zh: '正在连接 Claude...',
      }),
      connected: t({
        en: 'Connected',
        zh: '已连接',
      }),
      disconnected: t({
        en: 'Disconnected',
        zh: '已断开',
      }),
      reconnecting: t({
        en: 'Reconnecting...',
        zh: '正在重新连接...',
      }),
      error: t({
        en: 'Connection Error',
        zh: '连接错误',
      }),
      initializing: t({
        en: 'Initializing session',
        zh: '正在初始化会话',
      }),
      pleaseWait: t({
        en: 'Setting up your Claude environment...',
        zh: '正在配置 Claude 环境...',
      }),
      escInterrupt: t({
        en: 'Press Esc again to interrupt Claude',
        zh: '再次按 Esc 键中断 Claude',
      }),
      stopEsc: t({
        en: 'Stop (Esc)',
        zh: '停止生成 (Esc)',
      }),
      stop: t({
        en: 'Stop',
        zh: '停止',
      }),
    },
    errors: {
      notConnected: t({
        en: 'Not connected to Claude. Please wait or refresh.',
        zh: '未连接到 Claude。请等待或刷新页面。',
      }),
      messageFailed: t({
        en: 'Failed to send message. Please try again.',
        zh: '发送消息失败。请重试。',
      }),
      sessionNotFound: t({
        en: 'Session not found. It may have been deleted.',
        zh: '未找到会话。可能已被删除。',
      }),
      quotaExceeded: t({
        en: 'Quota exceeded. Please upgrade your plan.',
        zh: '配额已用完。请升级您的计划。',
      }),
      noSession: t({
        en: 'Please create a session first to view files',
        zh: '请先创建会话后再查看文件',
      }),
      fileNotFound: t({
        en: 'File not found: {path}',
        zh: '文件未找到：{path}',
      }),
      readFailed: t({
        en: 'Failed to read file',
        zh: '读取文件失败',
      }),
    },
    auth: {
      checkingSession: t({
        en: 'Checking your session...',
        zh: '正在验证会话...',
      }),
    },
    disclaimer: t({
      en: 'Claude can make mistakes. Please double-check responses.',
      zh: 'Claude 可能会出错，请仔细核对回复内容。',
    }),
    emptyState: {
      title: t({
        en: 'Start a conversation with Claude',
        zh: '开始与 Claude 对话',
      }),
      subtitle: t({
        en: 'Claude can help you with coding, writing, analysis, and more.',
        zh: 'Claude 可以帮助您进行编码、写作、分析等。',
      }),
      startChat: t({
        en: 'Start New Session',
        zh: '新建会话',
      }),
      suggestions: {
        coding: t({
          en: 'Help me write a function to',
          zh: '帮我写一个函数来',
        }),
        writing: t({
          en: 'Draft an email about',
          zh: '起草一封关于...的邮件',
        }),
        analysis: t({
          en: 'Analyze this data and',
          zh: '分析这些数据并',
        }),
        creative: t({
          en: 'Brainstorm ideas for',
          zh: '为...进行头脑风暴',
        }),
      },
    },

    // Session List Component
    sessionList: {
      newChat: t({
        en: 'New Chat',
        zh: '新建聊天',
      }),
      loading: t({
        en: 'Loading sessions...',
        zh: '加载会话中...',
      }),
      loadError: t({
        en: 'Failed to load sessions',
        zh: '加载会话失败',
      }),
      noConversations: t({
        en: 'No conversations yet',
        zh: '暂无对话',
      }),
      startNewChat: t({
        en: 'Start a new chat to begin',
        zh: '点击上方按钮开始新对话',
      }),
      conversations: t({
        en: '{count} conversation',
        zh: '{count} 个对话',
      }),
    },

    sessionItem: {
      editTitle: t({
        en: 'Edit title',
        zh: '编辑标题',
      }),
      deleteConversation: t({
        en: 'Delete conversation',
        zh: '删除对话',
      }),
      newChat: t({
        en: 'New Chat',
        zh: '新建聊天',
      }),
    },

    // Artifacts Panel Component
    artifactsPanel: {
      title: t({
        en: 'Artifact',
        zh: '成果物',
      }),
      preview: t({
        en: '(preview)',
        zh: '(预览)',
      }),
      close: t({
        en: 'Close',
        zh: '关闭',
      }),
      skillActions: t({
        en: 'Skill actions',
        zh: '技能操作',
      }),
      downloadSkill: t({
        en: 'Download .skill',
        zh: '下载 .skill',
      }),
      importToSkills: t({
        en: 'Import to Skills',
        zh: '导入到技能',
      }),
      downloadArtifact: t({
        en: 'Download artifact',
        zh: '下载成果物',
      }),
      source: t({
        en: 'Source: {tool}',
        zh: '来源：{tool}',
      }),
      updated: t({
        en: 'Updated: {time}',
        zh: '更新：{time}',
      }),
      file: t({
        en: 'File: {name}',
        zh: '文件：{name}',
      }),
      toast: {
        sessionUnavailable: t({
          en: 'Current session unavailable, cannot read skill files',
          zh: '当前会话不可用，无法读取技能文件',
        }),
        workspaceUnavailable: t({
          en: 'Workspace unavailable, only SKILL.md packaged',
          zh: '工作区不可用，已仅打包 SKILL.md',
        }),
        noFilesFound: t({
          en: 'No workspace files found, only SKILL.md packaged',
          zh: '未找到工作区文件，已仅打包 SKILL.md',
        }),
        noSkillFiles: t({
          en: 'No skill files found to package',
          zh: '未找到可打包的技能文件',
        }),
        tooManyFiles: t({
          en: 'File count exceeds limit (max 100 files)',
          zh: '文件数量超过限制（最多 100 个文件）',
        }),
        sizeLimitExceeded: t({
          en: 'Skill package size exceeds 10 MB limit',
          zh: '技能包大小超过 10 MB 限制',
        }),
        exportSuccess: t({
          en: 'Exported {name}.skill',
          zh: '已导出 {name}.skill',
        }),
        exportFailed: t({
          en: 'Failed to package skill',
          zh: '技能打包失败',
        }),
        importSuccess: t({
          en: 'Imported skill: {name}',
          zh: '已导入技能：{name}',
        }),
        importFailed: t({
          en: 'Failed to import skill',
          zh: '技能导入失败',
        }),
      },
    },

    // Knowledge Base Panel Component
    knowledgeBase: {
      description: t({
        en: 'Select documents from the library to add to the current session. Claude can use grep/read tools to search and reference these documents.',
        zh: '从文档库中选择文档添加到当前会话，Claude 可以使用 grep/read 工具搜索和引用这些文档。',
      }),
      addDocuments: t({
        en: 'Add Documents',
        zh: '添加文档',
      }),
      addKb: t({
        en: 'Add KB',
        zh: '添加 KB',
      }),
      loading: t({
        en: 'Loading documents...',
        zh: '加载文档中...',
      }),
      loadFailed: t({
        en: 'Failed to load',
        zh: '加载失败',
      }),
      noDocuments: t({
        en: 'No documents yet',
        zh: '暂无文档',
      }),
      clickToAdd: t({
        en: 'Click buttons above to add documents',
        zh: '点击上方按钮添加文档',
      }),
      added: t({
        en: '{count} documents added',
        zh: '已添加 {count} 个文档',
      }),
      sync: t({
        en: 'Resync',
        zh: '重新同步',
      }),
      remove: t({
        en: 'Remove',
        zh: '移除',
      }),
      syncedAt: t({
        en: 'Synced {time}',
        zh: '同步于 {time}',
      }),
      timeJustNow: t({
        en: 'Just now',
        zh: '刚刚',
      }),
      timeMinutesAgo: t({
        en: '{count}m ago',
        zh: '{count}分钟前',
      }),
      timeHoursAgo: t({
        en: '{count}h ago',
        zh: '{count}小时前',
      }),
      timeYesterday: t({
        en: 'Yesterday',
        zh: '昨天',
      }),
      timeDaysAgo: t({
        en: '{count}d ago',
        zh: '{count}天前',
      }),
      syncUnchanged: t({
        en: '"{name}" file unchanged, no need to sync',
        zh: '"{name}" 文件未修改，无需同步',
      }),
      syncSuccess: t({
        en: '"{name}" synced successfully!',
        zh: '"{name}" 同步成功！',
      }),
      syncFailed: t({
        en: 'Sync failed, please try again',
        zh: '同步失败，请重试',
      }),
      removeConfirm: t({
        en: 'Are you sure you want to remove "{name}" from the knowledge base?\n\nThe file will not be deleted from the library.',
        zh: '确定要从知识库中移除 "{name}"？\n\n文件不会从文档库中删除。',
      }),
      removeFailed: t({
        en: 'Failed to remove, please try again',
        zh: '移除失败，请重试',
      }),
      addKbTitle: t({
        en: 'Add Knowledge Base',
        zh: '添加 Knowledge Base',
      }),
      addKbDescription: t({
        en: 'Select a Knowledge Base, all documents will be automatically added to the current session.',
        zh: '选择一个 Knowledge Base，所有文档将自动添加到当前会话。',
      }),
      noKb: t({
        en: 'No Knowledge Base yet',
        zh: '暂无 Knowledge Base',
      }),
      createKbFirst: t({
        en: 'Please create a Knowledge Base in the Documents page first',
        zh: '请先在 Documents 页面创建 Knowledge Base',
      }),
      kbDocuments: t({
        en: '{count} documents',
        zh: '{count} 个文档',
      }),
      addSuccess: t({
        en: 'Successfully added Knowledge Base "{name}", {count} documents in total',
        zh: '成功添加 Knowledge Base "{name}"，共 {count} 个文档',
      }),
      addKbFailed: t({
        en: 'Failed to add Knowledge Base, please try again',
        zh: '添加 Knowledge Base 失败，请重试',
      }),
      cancel: t({
        en: 'Cancel',
        zh: '取消',
      }),
    },

    // Skills Manager Panel Component
    skillsManager: {
      title: t({
        en: '🔧 Skills Manager',
        zh: '🔧 Skills 管理',
      }),
      close: t({
        en: 'Close',
        zh: '关闭',
      }),
      loading: t({
        en: 'Loading...',
        zh: '加载中...',
      }),
      noSkills: t({
        en: 'No Skills available',
        zh: '暂无可用的 Skills',
      }),
      enabled: t({
        en: 'Enabled: {count} / {total}',
        zh: '已启用：{count} / {total}',
      }),
      hint: t({
        en: 'Note: Restart conversation after enabling new Skills for them to take effect',
        zh: '提示：开启后需重新发起对话才能使用新 Skills',
      }),
      enable: t({
        en: 'Enable',
        zh: '开启',
      }),
      disable: t({
        en: 'Disable',
        zh: '关闭',
      }),
      toast: {
        enableFailed: t({
          en: 'Failed to enable skill',
          zh: '启用技能失败',
        }),
        notSynced: t({
          en: 'Skill not synced to runtime directory: {slug}. Current enable will not take effect.',
          zh: '技能未同步到运行时目录：{slug}。当前启用不会生效。',
        }),
        globalEnabled: t({
          en: 'This skill has been globally enabled by admin and cannot be disabled.',
          zh: '该技能已被管理员全局启用，无法关闭。',
        }),
      },
    },

    // Chat Composer Component
    composer: {
      placeholder: t({
        en: 'How can I help you today?',
        zh: 'How can I help you today?',
      }),
      uploadFile: t({
        en: 'Upload file',
        zh: '上传文件',
      }),
      clearInput: t({
        en: 'Clear input',
        zh: '清空输入',
      }),
      currentModel: t({
        en: 'Current model',
        zh: '当前模型',
      }),
      toggleWorkspace: t({
        en: 'Toggle workspace',
        zh: '切换工作空间',
      }),
      workspaceTitle: t({
        en: 'Knowledge Base / Workspace',
        zh: '知识库 / 工作区',
      }),
      sessionFiles: t({
        en: 'Session files',
        zh: '会话文件',
      }),
      sessionFilesTitle: t({
        en: 'Session Files',
        zh: '会话文件',
      }),
      sessionInfo: t({
        en: 'View session info',
        zh: '查看会话信息',
      }),
      sessionInfoTitle: t({
        en: 'Session Info',
        zh: '会话信息',
      }),
      sendMessage: t({
        en: 'Send message',
        zh: '发送消息',
      }),
      generating: t({
        en: 'Generating, stop or wait',
        zh: '正在生成，先停止或等待',
      }),
      uploading: t({
        en: 'Uploading files...',
        zh: '正在上传文件...',
      }),
      errors: {
        noSession: t({
          en: 'Please send a message to create a session first, then upload files.',
          zh: '请先发送一条消息以创建会话，再上传文件。',
        }),
        uploadFailed: t({
          en: 'Upload failed',
          zh: '上传失败',
        }),
        noInput: t({
          en: 'Please enter content before sending.',
          zh: '请先输入内容再发送。',
        }),
        createSessionFirst: t({
          en: 'Please create a session first to upload files',
          zh: '请先创建会话再上传文件',
        }),
      },
      ariaLabels: {
        uploadButton: t({
          en: 'Upload file',
          zh: '上传文件',
        }),
        uploadButtonDisabled: t({
          en: 'Create a session first before uploading files',
          zh: '请先创建会话再上传文件',
        }),
        uploadButtonTitle: t({
          en: 'Upload file to workspace',
          zh: '上传文件到工作区',
        }),
        clearButton: t({
          en: 'Clear input',
          zh: '清空输入',
        }),
        closeButton: t({
          en: 'Close',
          zh: '关闭',
        }),
        removeAttachment: t({
          en: 'Remove attachment',
          zh: '移除附件',
        }),
      },
    },

    // Session Files Panel Component
    sessionFiles: {
      title: t({
        en: 'Session Files',
        zh: '会话文件',
      }),
      loading: t({
        en: 'Loading files...',
        zh: '加载文件中...',
      }),
      loadError: t({
        en: 'Failed to load files',
        zh: '加载文件失败',
      }),
      noFiles: t({
        en: 'No files in this session yet',
        zh: '此会话中暂无文件',
      }),
      writeFile: t({
        en: 'Write file',
        zh: '写入文件',
      }),
      refresh: t({
        en: 'Refresh',
        zh: '刷新',
      }),
    },

    // Session Info Panel Component
    sessionInfo: {
      title: t({
        en: 'Session Information',
        zh: '会话信息',
      }),
      sessionId: t({
        en: 'Session ID',
        zh: '会话 ID',
      }),
      copySessionId: t({
        en: 'Copy Session ID',
        zh: '复制 Session ID',
      }),
      createdAt: t({
        en: 'Created',
        zh: '创建时间',
      }),
      lastActivity: t({
        en: 'Last Activity',
        zh: '最后活动',
      }),
      messageCount: t({
        en: 'Messages',
        zh: '消息数',
      }),
      skills: t({
        en: 'Active Skills',
        zh: '启用的技能',
      }),
      mcpServers: t({
        en: 'MCP Servers',
        zh: 'MCP 服务器',
      }),
      permissions: t({
        en: 'Permissions',
        zh: '权限',
      }),
      noSkills: t({
        en: 'No skills enabled',
        zh: '未启用技能',
      }),
      noMcpServers: t({
        en: 'No MCP servers configured',
        zh: '未配置 MCP 服务器',
      }),
    },

    // Permission Badge Component
    permission: {
      full: t({
        en: 'Full Access',
        zh: '完全访问',
      }),
      restricted: t({
        en: 'Restricted',
        zh: '受限',
      }),
      bashDisabled: t({
        en: 'Bash tool disabled',
        zh: 'Bash 工具已禁用',
      }),
      title: t({
        en: 'Session Permissions',
        zh: '会话权限',
      }),
    },

    // MCP Status Indicator Component
    mcpStatus: {
      connected: t({
        en: 'MCP Connected',
        zh: 'MCP 已连接',
      }),
      disconnected: t({
        en: 'MCP Disconnected',
        zh: 'MCP 未连接',
      }),
      servers: t({
        en: '{count} server(s)',
        zh: '{count} 个服务器',
      }),
    },
  },
  key: 'claude-chat',
} satisfies Dictionary;

export default claudeChatContent;
