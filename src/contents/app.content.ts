import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * App-wide content dictionary
 * Contains navigation titles, button labels, and page titles used across the application
 */
const appContent = {
  content: {
    nav: {
      claudeChat: t({
        en: 'Claude Chat',
        zh: 'Claude Chat',
      }),
      skillsStore: t({
        en: 'Skills Store',
        zh: '技能商店',
      }),
      mcpStore: t({
        en: 'MCP Store',
        zh: 'MCP 商店',
      }),
      aiChat: t({
        en: 'AI Chat',
        zh: 'AI 聊天',
      }),
      aiWorkflow: t({
        en: 'AI Workflow',
        zh: 'AI 工作流',
      }),
      documents: t({
        en: 'Documents / KB',
        zh: '文档 / 知识库',
      }),
      dashboards: t({
        en: 'Dashboards',
        zh: '仪表板',
      }),
      admin: t({
        en: 'Admin',
        zh: '管理',
      }),
      adminPanel: t({
        en: 'Admin Panel',
        zh: '管理面板',
      }),
    },
    userMenu: {
      workspace: t({
        en: 'Workspace',
        zh: '工作空间',
      }),
      account: t({
        en: 'Account',
        zh: '账户',
      }),
      organization: t({
        en: 'Organization',
        zh: '组织',
      }),
      preferences: t({
        en: 'Preferences',
        zh: '偏好设置',
      }),
      billing: t({
        en: 'Billing',
        zh: '计费',
      }),
      plans: t({
        en: 'Plans & subscription',
        zh: '方案与订阅',
      }),
      billingAndInvoices: t({
        en: 'Billing & invoices',
        zh: '计费与发票',
      }),
      logout: t({
        en: 'Log out',
        zh: '退出登录',
      }),
    },
    titles: {
      documents: t({
        en: 'Documents / KB',
        zh: '文档 / 知识库',
      }),
      claudeChat: t({
        en: 'Claude Chat',
        zh: 'Claude Chat',
      }),
      aiChat: t({
        en: 'AI Chat',
        zh: 'AI 聊天',
      }),
      aiWorkflow: t({
        en: 'AI Workflow',
        zh: 'AI 工作流',
      }),
      chat: t({
        en: 'Chat',
        zh: '聊天',
      }),
      imageChat: t({
        en: 'Image Chat',
        zh: '图片聊天',
      }),
      workflow: t({
        en: 'Workflow',
        zh: '工作流',
      }),
      dashboard: t({
        en: 'Dashboard',
        zh: '仪表板',
      }),
      skills: t({
        en: 'Skills',
        zh: '技能',
      }),
      agent: t({
        en: 'Agent',
        zh: '智能体',
      }),
      billing: t({
        en: 'Billing',
        zh: '计费',
      }),
      billingSettings: t({
        en: 'Billing Settings',
        zh: '计费设置',
      }),
    },
    buttons: {
      signIn: t({
        en: 'Sign In',
        zh: '登录',
      }),
      signUp: t({
        en: 'Sign Up',
        zh: '注册',
      }),
      signOut: t({
        en: 'Sign Out',
        zh: '退出登录',
      }),
      save: t({
        en: 'Save',
        zh: '保存',
      }),
      cancel: t({
        en: 'Cancel',
        zh: '取消',
      }),
      submit: t({
        en: 'Submit',
        zh: '提交',
      }),
      delete: t({
        en: 'Delete',
        zh: '删除',
      }),
      edit: t({
        en: 'Edit',
        zh: '编辑',
      }),
      close: t({
        en: 'Close',
        zh: '关闭',
      }),
      back: t({
        en: 'Back',
        zh: '返回',
      }),
      next: t({
        en: 'Next',
        zh: '下一步',
      }),
      previous: t({
        en: 'Previous',
        zh: '上一步',
      }),
      confirm: t({
        en: 'Confirm',
        zh: '确认',
      }),
      refresh: t({
        en: 'Refresh',
        zh: '刷新',
      }),
      loading: t({
        en: 'Loading...',
        zh: '加载中...',
      }),
    },
    meta: {
      title: t({
        en: 'DeeptoAI - AI Workspace',
        zh: 'DeeptoAI - AI 工作台',
      }),
      description: t({
        en: 'AI workspace powered by Claude Agent SDK with streaming chat, skills management, artifacts, and sessions. Powered by Zhipu AI GLM-4.7',
        zh: '基于 Claude Agent SDK 的 AI 工作台，支持流式对话、Skills 管理、Artifacts 展示和会话管理。Powered by Zhipu AI GLM-4.7',
      }),
      keywords: t({
        en: 'AI, Claude Agent, Zhipu AI, GLM-4.7, Chat, Skills, Artifacts, AI Workspace',
        zh: 'AI, Claude Agent, Zhipu AI, GLM-4.7, Chat, Skills, Artifacts, AI Workspace',
      }),
    },
    charts: {
      dashboard: t({ en: 'Dashboard', zh: '仪表板' }),
      dashboardDesc: t({ en: 'Monitor your key metrics and performance indicators.', zh: '监控关键指标与表现。' }),
      totalRevenue: t({ en: 'Total Revenue', zh: '总收入' }),
      totalUsers: t({ en: 'Total Users', zh: '总用户数' }),
      activeNow: t({ en: 'Active Now', zh: '当前活跃' }),
      growthRate: t({ en: 'Growth Rate', zh: '增长率' }),
      overview: t({ en: 'Overview', zh: '概览' }),
      overviewDesc: t({ en: 'Your performance metrics for the current period', zh: '当前周期表现指标' }),
      recentActivity: t({ en: 'Recent Activity', zh: '最近动态' }),
      recentActivityDesc: t({ en: 'Latest updates and transactions', zh: '最新动态与交易' }),
    },
    aiWorkflow: {
      checkingAuth: t({ en: 'Checking sign-in status…', zh: '正在检查登录状态…' }),
      hubSubtitle: t({
        en: 'Choose a workflow to get started. Each workflow is a multi-step intelligent process.',
        zh: '选择一个工作流开始创作。每个工作流都是一个多步骤的智能流程。',
      }),
    },
    placeholders: {
      exampleCompany: t({ en: 'e.g., TechCorp', zh: '例如：TechCorp' }),
    },
    common: {
      appName: t({
        en: 'DeeptoAI',
        zh: 'DeeptoAI',
      }),
      welcome: t({
        en: 'Welcome',
        zh: '欢迎',
      }),
      welcomeTo: t({
        en: 'Welcome to {name}',
        zh: '欢迎使用 {name}',
      }),
      redirectingToAgentChat: t({
        en: 'Redirecting to Agent Chat...',
        zh: '正在跳转到智能体聊天...',
      }),
      error: t({
        en: 'Error',
        zh: '错误',
      }),
      success: t({
        en: 'Success',
        zh: '成功',
      }),
      warning: t({
        en: 'Warning',
        zh: '警告',
      }),
      info: t({
        en: 'Info',
        zh: '信息',
      }),
    },
  },
  key: 'app',
} satisfies Dictionary;

export default appContent;
