import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

const mcpContent = {
  content: {
    // Page header
    header: {
      title: t({ en: 'MCP Store', zh: 'MCP 商店' }),
      description: t({
        en: 'Manage MCP servers ({total} total, {custom} custom)',
        zh: '管理 MCP 服务器（共 {total} 个，{custom} 个自定义）',
      }),
    },

    // Sidebar
    sidebar: {
      title: t({ en: 'MCP Store', zh: 'MCP 商店' }),
      categories: {
        all: t({ en: 'All MCPs', zh: 'All MCPs' }),
        development: t({ en: 'Development', zh: 'Development' }),
        data: t({ en: 'Data', zh: 'Data' }),
        installed: t({ en: 'Enabled', zh: 'Enabled' }),
        system: t({ en: 'System MCPs', zh: 'System MCPs' }),
        custom: t({ en: 'My MCPs', zh: 'My MCPs' }),
      },
    },

    // Main page
    page: {
      searchPlaceholder: t({ en: 'Search MCPs...', zh: '搜索 MCPs...' }),
      addMcpButton: t({ en: 'Add MCP', zh: '添加 MCP' }),
      noResults: t({ en: 'No MCP servers found', zh: '未找到 MCP 服务器' }),
      noResultsHint: t({ en: 'Try adjusting your search or filter', zh: '尝试调整搜索条件或筛选器' }),
    },

    // Card
    card: {
      enable: t({ en: 'Enable', zh: '启用' }),
      disable: t({ en: 'Disable', zh: '禁用' }),
      viewDetails: t({ en: 'View details', zh: '查看详情' }),
      verifyMcp: t({ en: 'Verify MCP', zh: '验证 MCP' }),
      deleteMcp: t({ en: 'Delete MCP', zh: '删除 MCP' }),
      systemBadge: t({ en: 'System', zh: 'System' }),
      personalBadge: t({ en: 'Personal', zh: 'Personal' }),
    },

    // Delete confirmation
    deleteConfirm: {
      system: t({
        en: 'Are you sure you want to delete system MCP "{slug}"? This will affect all users. This action cannot be undone.',
        zh: '确定要删除系统级 MCP "{slug}" 吗？这将影响所有用户。此操作无法撤销。',
      }),
      personal: t({
        en: 'Are you sure you want to delete "{slug}"? This action cannot be undone.',
        zh: '确定要删除 "{slug}" 吗？此操作无法撤销。',
      }),
    },

    // Verify messages
    verify: {
      success: t({ en: 'MCP verified successfully.', zh: 'MCP 验证成功。' }),
      failed: t({ en: 'MCP verification failed.', zh: 'MCP 验证失败。' }),
      genericFailed: t({ en: 'MCP verification failed.', zh: 'MCP 验证失败。' }),
    },

    // Delete messages
    delete: {
      failed: t({ en: 'Failed to delete MCP.', zh: '删除 MCP 失败。' }),
    },

    // Detail Dialog
    detailDialog: {
      enabled: t({ en: 'Enabled', zh: '已启用' }),
      disabled: t({ en: 'Disabled', zh: '已禁用' }),
      refresh: t({ en: 'Refresh', zh: '刷新' }),
      storeBadge: {
        system: t({ en: 'System', zh: 'System' }),
        personal: t({ en: 'Personal', zh: 'Personal' }),
      },
      tabs: {
        about: t({ en: 'About', zh: '关于' }),
        configure: t({ en: 'Configure', zh: '配置' }),
        tools: t({ en: 'Tools', zh: '工具' }),
      },
      about: {
        noDocs: t({ en: 'No documentation available for this MCP.', zh: '此 MCP 没有可用文档。' }),
        configuration: t({ en: 'Configuration', zh: '配置' }),
        tools: t({ en: 'Tools', zh: '工具' }),
      },
      configure: {
        noConfig: t({ en: 'No configuration needed for {name}.', zh: '{name} 无需配置。' }),
        loading: t({ en: 'Loading configuration...', zh: '加载配置中...' }),
        enterPlaceholder: t({ en: 'Enter {label}', zh: '输入 {label}' }),
        saveButton: t({ en: 'Save Configuration', zh: '保存配置' }),
        saving: t({ en: 'Saving...', zh: '保存中...' }),
        saved: t({ en: 'Saved', zh: '已保存' }),
        saveError: t({ en: 'Failed to save credentials', zh: '保存凭据失败' }),
      },
      tools: {
        loading: t({ en: 'Loading tools...', zh: '加载工具中...' }),
        error: t({ en: 'Error loading tools', zh: '加载工具时出错' }),
        retry: t({ en: 'Retry', zh: '重试' }),
        noTools: t({ en: 'No tools available for this MCP server.', zh: '此 MCP 服务器没有可用工具。' }),
        connectionWarning: t({ en: 'Could not connect to MCP server', zh: '无法连接到 MCP 服务器' }),
        connectionWarningHint: t({
          en: 'Showing predefined tools from configuration. You may need to configure credentials or install the MCP package.',
          zh: '显示配置中的预定义工具。您可能需要配置凭据或安装 MCP 包。',
        }),
        stats: t({
          en: '{count} tools · {enabled} enabled',
          zh: '{count} 个工具 · {enabled} 个已启用',
        }),
        saveChanges: t({ en: 'Save Changes', zh: '保存更改' }),
        saving: t({ en: 'Saving...', zh: '保存中...' }),
        saved: t({ en: 'Saved', zh: '已保存' }),
        saveError: t({ en: 'Failed to save', zh: '保存失败' }),
        loadError: t({ en: 'Failed to load MCP info', zh: '加载 MCP 信息失败' }),
        connectionError: t({ en: 'Failed to connect to MCP server', zh: '连接到 MCP 服务器失败' }),
      },
    },

    // Add Custom MCP Dialog
    addDialog: {
      title: t({ en: 'Add Custom MCP Server', zh: '添加自定义 MCP 服务器' }),
      description: t({
        en: 'Add a custom MCP server using one of the methods below.',
        zh: '使用以下任一方法添加自定义 MCP 服务器。',
      }),
      tabs: {
        form: t({ en: 'Form', zh: '表单' }),
        yamlJson: t({ en: 'YAML/JSON', zh: 'YAML/JSON' }),
        url: t({ en: 'URL', zh: 'URL' }),
        npm: t({ en: 'npm', zh: 'npm' }),
      },
      form: {
        manual: t({ en: 'Fill in the configuration manually', zh: '手动填写配置' }),
        example: t({ en: 'Example', zh: '示例' }),
        useExample: t({ en: 'Use Example', zh: '使用示例' }),
        exampleTitle: t({ en: 'Z.AI Vision Server', zh: 'Z.AI 视觉服务器' }),
        exampleDescription: t({
          en: 'Example: Adding a vision understanding MCP server',
          zh: '示例：添加视觉理解 MCP 服务器',
        }),
        nameLabel: t({ en: 'Name', zh: '名称' }),
        namePlaceholder: t({ en: 'My MCP Server', zh: '我的 MCP 服务器' }),
        slugLabel: t({ en: 'Slug', zh: '标识符' }),
        slugPlaceholder: t({ en: 'my-mcp-server', zh: 'my-mcp-server' }),
        descriptionLabel: t({ en: 'Description', zh: '描述' }),
        descriptionPlaceholder: t({
          en: 'What does this MCP server do?',
          zh: '此 MCP 服务器的功能是什么？',
        }),
        categoryLabel: t({ en: 'Category', zh: '分类' }),
        categoryGeneral: t({ en: 'General', zh: 'General' }),
        categoryDevelopment: t({ en: 'Development', zh: 'Development' }),
        categoryData: t({ en: 'Data', zh: 'Data' }),
        categoryIntegration: t({ en: 'Integration', zh: 'Integration' }),
        connectionTypeLabel: t({ en: 'Connection Type', zh: '连接类型' }),
        typeStdio: t({ en: 'stdio (Local Process)', zh: 'stdio（本地进程）' }),
        typeHttp: t({ en: 'HTTP', zh: 'HTTP' }),
        typeSse: t({ en: 'SSE (Server-Sent Events)', zh: 'SSE（服务器发送事件）' }),
        commandLabel: t({ en: 'Command', zh: '命令' }),
        commandPlaceholder: t({ en: 'npx', zh: 'npx' }),
        argsLabel: t({ en: 'Arguments (space or comma separated)', zh: '参数（空格或逗号分隔）' }),
        argsPlaceholder: t({ en: '-y @org/mcp-server', zh: '-y @org/mcp-server' }),
        envVarsLabel: t({ en: 'Environment Variables', zh: '环境变量' }),
        addEnvVar: t({ en: 'Add', zh: '添加' }),
        keyPlaceholder: t({ en: 'KEY', zh: 'KEY' }),
        valuePlaceholder: t({ en: '${KEY} or value', zh: '${KEY} 或值' }),
        urlLabel: t({ en: 'URL', zh: 'URL' }),
        urlPlaceholder: t({ en: 'https://api.example.com/mcp', zh: 'https://api.example.com/mcp' }),
        credentialsLabel: t({ en: 'Credential Fields (for user to fill)', zh: '凭据字段（供用户填写）' }),
        credentialsHint: t({
          en: 'Define fields that users need to provide (like API keys)',
          zh: '定义用户需要提供的字段（如 API 密钥）',
        }),
        keyPlaceholderShort: t({ en: 'KEY', zh: 'KEY' }),
        labelPlaceholder: t({ en: 'Label', zh: '标签' }),
        required: t({ en: 'Required', zh: '必需' }),
        visibility: t({ en: 'Visibility', zh: '可见性' }),
        visibilityPersonal: t({ en: 'Personal', zh: '个人' }),
        visibilityPersonalDesc: t({
          en: 'Only visible to you. You can modify or delete it anytime.',
          zh: '仅您可见。您可以随时修改或删除。',
        }),
        visibilitySystem: t({ en: 'System', zh: '系统' }),
        visibilitySystemDesc: t({
          en: 'Visible to all users. Only administrators can modify or delete.',
          zh: '所有用户可见。只有管理员可以修改或删除。',
        }),
        cancelButton: t({ en: 'Cancel', zh: '取消' }),
        addButton: t({ en: 'Add MCP', zh: '添加 MCP' }),
        adding: t({ en: 'Adding...', zh: '添加中...' }),
      },
      json: {
        title: t({ en: 'Paste Configuration', zh: '粘贴配置' }),
        description: t({ en: 'Paste YAML or JSON configuration', zh: '粘贴 YAML 或 JSON 配置' }),
        viewExample: t({ en: 'View example format', zh: '查看示例格式' }),
        configLabel: t({ en: 'Configuration (YAML or JSON)', zh: '配置（YAML 或 JSON）' }),
        configPlaceholder: t({ en: 'Paste your YAML or JSON configuration here...', zh: '在此处粘贴您的 YAML 或 JSON 配置...' }),
        parseButton: t({ en: 'Parse & Continue', zh: '解析并继续' }),
        parsing: t({ en: 'Parsing...', zh: '解析中...' }),
      },
      url: {
        title: t({ en: 'Import from URL', zh: '从 URL 导入' }),
        description: t({ en: 'Import MCP configuration from a URL', zh: '从 URL 导入 MCP 配置' }),
        example: t({ en: 'https://raw.githubusercontent.com/user/repo/main/MCP.md', zh: 'https://raw.githubusercontent.com/user/repo/main/MCP.md' }),
        urlLabel: t({ en: 'MCP Configuration URL', zh: 'MCP 配置 URL' }),
        urlPlaceholder: t({ en: 'https://...', zh: 'https://...' }),
        urlHint: t({
          en: 'URL should point to an MCP.md file or a raw YAML/JSON configuration',
          zh: 'URL 应指向 MCP.md 文件或原始 YAML/JSON 配置',
        }),
        fetchButton: t({ en: 'Fetch & Continue', zh: '获取并继续' }),
        fetching: t({ en: 'Fetching...', zh: '获取中...' }),
      },
      npm: {
        title: t({ en: 'npm Package', zh: 'npm 包' }),
        description: t({ en: 'Auto-detect from npm package', zh: '从 npm 包自动检测' }),
        example: t({ en: '@modelcontextprotocol/server-github', zh: '@modelcontextprotocol/server-github' }),
        packageLabel: t({ en: 'npm Package Name', zh: 'npm 包名' }),
        packagePlaceholder: t({ en: '@org/mcp-server', zh: '@org/mcp-server' }),
        packageHint: t({
          en: 'The package info will be fetched and a configuration will be auto-generated',
          zh: '将获取包信息并自动生成配置',
        }),
        detectButton: t({ en: 'Detect & Continue', zh: '检测并继续' }),
        detecting: t({ en: 'Detecting...', zh: '检测中...' }),
      },
      errors: {
        slugNameRequired: t({ en: 'Slug and Name are required.', zh: '标识符和名称为必填项。' }),
        commandRequired: t({ en: 'Command is required for stdio type.', zh: 'stdio 类型需要命令。' }),
        urlRequired: t({ en: 'URL is required for HTTP/SSE type.', zh: 'HTTP/SSE 类型需要 URL。' }),
        failedToAdd: t({ en: 'Failed to add MCP.', zh: '添加 MCP 失败。' }),
        anErrorOccurred: t({ en: 'An error occurred.', zh: '发生错误。' }),
        pasteContent: t({ en: 'Please paste configuration content.', zh: '请粘贴配置内容。' }),
        parseFailed: t({ en: 'Failed to parse configuration.', zh: '解析配置失败。' }),
        parseError: t({ en: 'Parse error.', zh: '解析错误。' }),
        enterUrl: t({ en: 'Please enter a URL.', zh: '请输入 URL。' }),
        fetchFailed: t({ en: 'Failed to fetch from URL.', zh: '从 URL 获取失败。' }),
        fetchError: t({ en: 'Fetch error.', zh: '获取错误。' }),
        enterPackage: t({ en: 'Please enter an npm package name.', zh: '请输入 npm 包名。' }),
        npmParseFailed: t({ en: 'Failed to parse npm package.', zh: '解析 npm 包失败。' }),
        npmError: t({ en: 'npm error.', zh: 'npm 错误。' }),
      },
      success: {
        added: t({ en: 'MCP "{slug}" added as {scope} successfully!', zh: 'MCP "{slug}" 已成功添加为 {scope}！' }),
        scopePersonal: t({ en: 'personal', zh: '个人' }),
        scopeSystem: t({ en: 'system', zh: '系统' }),
        parsed: t({ en: 'Configuration parsed! Review and submit.', zh: '配置已解析！请检查并提交。' }),
        imported: t({ en: 'Configuration imported! Review and submit.', zh: '配置已导入！请检查并提交。' }),
        packageLoaded: t({ en: 'Package info loaded! Review and submit.', zh: '包信息已加载！请检查并提交。' }),
      },
    },
  },
  key: 'mcp',
} satisfies Dictionary;

export default mcpContent;
