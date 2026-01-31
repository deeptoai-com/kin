import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * Marketing page content dictionary
 * Contains landing page, pricing, and promotional content
 */
const marketingContent = {
  content: {
    hero: {
      badge: t({
        en: 'Claude Agent SDK + Zhipu AI GLM-4.7',
        zh: 'Claude Agent SDK + 智谱 AI GLM-4.7',
      }),
      title: t({
        en: 'Claude Desktop-Style Agent Chat',
        zh: 'Claude 桌面风格 Agent Chat',
      }),
      subtitle: t({
        en: 'A full-featured AI agent interface powered by Zhipu AI GLM-4.7. Features Skills Store, Artifacts, Knowledge Base, and Session Management via WebSocket.',
        zh: '由智谱 AI GLM-4.7 驱动的全功能 AI Agent 界面。支持技能商店、成果物、知识库和基于 WebSocket 的会话管理。',
      }),
      primaryButton: t({
        en: 'Try DeeptoAI',
        zh: '试用 DeeptoAI',
      }),
      secondaryButton: t({
        en: 'View on GitHub',
        zh: '在 GitHub 上查看',
      }),
      poweredBy: t({
        en: 'Powered by',
        zh: '由以下技术提供支持',
      }),
    },
    features: {
      title: t({
        en: 'Full-Featured Claude Agent Experience',
        zh: '全功能的 Claude Agent 体验',
      }),
      subtitle: t({
        en: 'Everything you need from Claude Desktop, plus Skills Store and more',
        zh: '拥有 Claude Desktop 的一切，外加技能商店等更多功能',
      }),
      deeptoaiChat: {
        title: t({
          en: 'DeeptoAI Agent Chat',
          zh: 'DeeptoAI Agent Chat',
        }),
        description: t({
          en: 'Full Claude Desktop replica with Claude Agent SDK integration',
          zh: '完全复刻 Claude Desktop，集成 Claude Agent SDK',
        }),
      },
      skillsStore: {
        title: t({
          en: 'Skills Store',
          zh: '技能商店',
        }),
        description: t({
          en: 'Enable/disable custom skills to extend agent capabilities dynamically',
          zh: '启用/禁用自定义技能以动态扩展 Agent 能力',
        }),
      },
      artifacts: {
        title: t({
          en: 'Artifacts System',
          zh: '成果物系统',
        }),
        description: t({
          en: 'Support for HTML, Markdown, React, and SVG artifacts with live preview',
          zh: '支持 HTML、Markdown、React 和 SVG 成果物，带实时预览',
        }),
      },
      knowledgeBase: {
        title: t({
          en: 'Knowledge Base',
          zh: '知识库',
        }),
        description: t({
          en: 'Upload and manage documents for context-aware conversations',
          zh: '上传和管理文档以支持上下文感知对话',
        }),
      },
      sessionManagement: {
        title: t({
          en: 'Session Management',
          zh: '会话管理',
        }),
        description: t({
          en: 'Create, resume, and switch between multiple chat sessions with full history',
          zh: '创建、恢复和切换多个聊天会话，保留完整历史',
        }),
      },
      toolVisualization: {
        title: t({
          en: 'Tool Visualization',
          zh: '工具可视化',
        }),
        description: t({
          en: 'See tool calls, arguments, and results in real-time with detailed feedback',
          zh: '实时查看工具调用、参数和结果，带详细反馈',
        }),
      },
    },
    techStack: {
      title: t({
        en: 'Production-Ready Tech Stack',
        zh: '生产就绪的技术栈',
      }),
      subtitle: t({
        en: 'Built on proven technologies for reliability and scalability',
        zh: '基于经过验证的技术构建，确保可靠性和可扩展性',
      }),
      claudeChat: {
        title: t({
          en: 'Claude Chat (Main Feature)',
          zh: 'Claude Chat（主要功能）',
        }),
        claudeAgentSDK: t({
          en: 'Claude Agent SDK',
          zh: 'Claude Agent SDK',
        }),
        zhipuAi: t({
          en: 'Zhipu AI GLM-4.7',
          zh: '智谱 AI GLM-4.7',
        }),
        websocket: t({
          en: 'WebSocket (real-time)',
          zh: 'WebSocket（实时）',
        }),
        assistantUi: t({
          en: 'Assistant UI components',
          zh: 'Assistant UI 组件',
        }),
      },
      additionalFeatures: {
        title: t({
          en: 'Additional Features',
          zh: '附加功能',
        }),
        mastraAiChat: t({
          en: 'Mastra AI Chat (SSE-based)',
          zh: 'Mastra AI Chat（基于 SSE）',
        }),
        betterAuth: t({
          en: 'Better Auth (OAuth + password)',
          zh: 'Better Auth（OAuth + 密码）',
        }),
        postgresql: t({
          en: 'PostgreSQL + Drizzle ORM',
          zh: 'PostgreSQL + Drizzle ORM',
        }),
        shadcn: t({
          en: 'shadcn/ui + Tailwind CSS v4',
          zh: 'shadcn/ui + Tailwind CSS v4',
        }),
      },
    },
    architecture: {
      title: t({
        en: 'Two Independent Chat Systems',
        zh: '两套独立的聊天系统',
      }),
      subtitle: t({
        en: 'Built for different use cases with optimal architectures',
        zh: '为不同用例构建，采用最优架构',
      }),
      deeptoai: {
        badge: t({
          en: 'Main Feature',
          zh: '主要功能',
        }),
        title: t({
          en: 'DeeptoAI Agent Chat',
          zh: 'DeeptoAI Agent Chat',
        }),
        description: t({
          en: 'Full-featured agent with WebSocket-based real-time communication',
          zh: '全功能 Agent，支持基于 WebSocket 的实时通信',
        }),
        feature1: t({
          en: 'Skills Store for dynamic capabilities',
          zh: '技能商店支持动态能力',
        }),
        feature2: t({
          en: 'Artifacts panel with multiple formats',
          zh: '成果物面板支持多种格式',
        }),
        feature3: t({
          en: 'Session management and history',
          zh: '会话管理和历史记录',
        }),
        feature4: t({
          en: 'Tool call visualization',
          zh: '工具调用可视化',
        }),
        feature5: t({
          en: 'Knowledge Base integration',
          zh: '知识库集成',
        }),
        feature6: t({
          en: 'Usage statistics tracking',
          zh: '使用统计跟踪',
        }),
      },
      mastra: {
        badge: t({
          en: 'Secondary',
          zh: '次要功能',
        }),
        title: t({
          en: 'Mastra AI Chat',
          zh: 'Mastra AI Chat',
        }),
        description: t({
          en: 'Simple chat interface using Mastra + SSE streaming',
          zh: '使用 Mastra + SSE 流式的简单聊天界面',
        }),
        feature1: t({
          en: 'Mastra Agent Framework',
          zh: 'Mastra Agent 框架',
        }),
        feature2: t({
          en: 'Zhipu AI GLM-4.7 model',
          zh: '智谱 AI GLM-4.7 模型',
        }),
        feature3: t({
          en: 'Vercel AI SDK integration',
          zh: 'Vercel AI SDK 集成',
        }),
        feature4: t({
          en: 'SSE-based streaming',
          zh: '基于 SSE 的流式',
        }),
        feature5: t({
          en: 'Modern AI Elements UI',
          zh: '现代 AI Elements UI',
        }),
        feature6: t({
          en: 'File reading capability',
          zh: '文件读取能力',
        }),
      },
    },
    cta: {
      title: t({
        en: 'Ready to Try DeeptoAI?',
        zh: '准备试用 DeeptoAI？',
      }),
      subtitle: t({
        en: 'Start chatting with the AI agent powered by Claude Agent SDK and Skills Store',
        zh: '开始与由 Claude Agent SDK 和技能商店驱动的 AI Agent 聊天',
      }),
      primaryButton: t({
        en: 'Start Claude Chat',
        zh: '开始 Claude Chat',
      }),
      secondaryButton: t({
        en: 'Browse Skills',
        zh: '浏览技能',
      }),
    },
    footer: {
      copyright: t({
        en: '© 2024 Constructa Starter. MIT License.',
        zh: '© 2024 Constructa Starter. MIT 许可证。',
      }),
      github: t({
        en: 'GitHub',
        zh: 'GitHub',
      }),
      claudeAgentSDK: t({
        en: 'Claude Agent SDK',
        zh: 'Claude Agent SDK',
      }),
      zhipuAi: t({
        en: 'Zhipu AI',
        zh: '智谱 AI',
      }),
      assistantUi: t({
        en: 'Assistant UI',
        zh: 'Assistant UI',
      }),
    },
    pricing: {
      hero: {
        badge: t({
          en: 'Simple & Transparent',
          zh: '简单透明',
        }),
        title: t({
          en: 'AI Starter SaaS Kit',
          zh: 'AI Starter SaaS Kit',
        }),
        titleHighlight: t({
          en: 'Pricing Plans',
          zh: '定价方案',
        }),
        subtitle: t({
          en: 'Choose the perfect plan for your AI development journey. From free exploration to enterprise-grade solutions.',
          zh: '为您的 AI 开发之旅选择完美的计划。从免费探索到企业级解决方案。',
        }),
      },
      plans: {
        free: {
          name: t({
            en: 'Free',
            zh: '免费',
          }),
          price: t({
            en: '$0',
            zh: '¥0',
          }),
          period: t({
            en: '',
            zh: '',
          }),
          description: t({
            en: 'Perfect for getting started with AI development',
            zh: '非常适合开始 AI 开发',
          }),
          feature1: t({
            en: 'Basic access to AI tools',
            zh: 'AI 工具的基础访问',
          }),
          feature2: t({
            en: 'Limited API usage',
            zh: '有限的 API 使用',
          }),
          feature3: t({
            en: 'Community support',
            zh: '社区支持',
          }),
          feature4: t({
            en: 'Core starter templates',
            zh: '核心启动器模板',
          }),
          feature5: t({
            en: 'Basic documentation',
            zh: '基础文档',
          }),
          buttonText: t({
            en: 'Start Free',
            zh: '免费开始',
          }),
        },
        tier1: {
          name: t({
            en: 'Tier 1',
            zh: '一级计划',
          }),
          price: t({
            en: '$350',
            zh: '¥2,500',
          }),
          period: t({
            en: '/year',
            zh: '/年',
          }),
          description: t({
            en: 'For developers ready to build production apps',
            zh: '适合准备构建生产应用的开发者',
          }),
          badge: t({
            en: 'Most Popular',
            zh: '最受欢迎',
          }),
          feature1: t({
            en: 'All Free tier features',
            zh: '免费计划的所有功能',
          }),
          feature2: t({
            en: 'Priority support',
            zh: '优先支持',
          }),
          feature3: t({
            en: 'Extended usage caps',
            zh: '扩展的使用上限',
          }),
          feature4: t({
            en: 'Advanced templates',
            zh: '高级模板',
          }),
          feature5: t({
            en: 'Premium documentation',
            zh: '优质文档',
          }),
          feature6: t({
            en: 'Community Discord access',
            zh: '访问 Discord 社区',
          }),
          feature7: t({
            en: 'Monthly office hours',
            zh: '每月办公时间',
          }),
          buttonText: t({
            en: 'Start Building',
            zh: '开始构建',
          }),
        },
        tier2: {
          name: t({
            en: 'Tier 2',
            zh: '二级计划',
          }),
          price: t({
            en: '$8,500',
            zh: '¥60,000',
          }),
          period: t({
            en: '/year + setup fee',
            zh: '/年 + 设置费',
          }),
          description: t({
            en: 'Enterprise-grade solution with dedicated support',
            zh: '企业级解决方案，配备专属支持',
          }),
          badge: t({
            en: 'Enterprise',
            zh: '企业版',
          }),
          feature1: t({
            en: 'All Tier 1 features',
            zh: '一级计划的所有功能',
          }),
          feature2: t({
            en: 'Custom integrations',
            zh: '定制集成',
          }),
          feature3: t({
            en: 'Dedicated support team',
            zh: '专属支持团队',
          }),
          feature4: t({
            en: 'Onboarding & setup assistance',
            zh: '入职和设置协助',
          }),
          feature5: t({
            en: 'Custom feature development',
            zh: '定制功能开发',
          }),
          feature6: t({
            en: 'Priority bug fixes',
            zh: '优先错误修复',
          }),
          feature7: t({
            en: 'Direct Slack channel',
            zh: '直接 Slack 频道',
          }),
          feature8: t({
            en: 'Monthly strategy calls',
            zh: '每月策略会议',
          }),
          buttonText: t({
            en: 'Contact Sales',
            zh: '联系销售',
          }),
        },
      },
      comparison: {
        title: t({
          en: 'Compare Features',
          zh: '比较功能',
        }),
        subtitle: t({
          en: 'See what\'s included in each plan to make the best choice for your needs',
          zh: '查看每个计划包含的内容，为您的需求做出最佳选择',
        }),
        communitySupport: {
          title: t({
            en: 'Community Support',
            zh: '社区支持',
          }),
          description: t({
            en: 'Get help from our growing community of AI developers',
            zh: '从我们不断增长的 AI 开发者社区获得帮助',
          }),
        },
        prioritySupport: {
          title: t({
            en: 'Priority Support',
            zh: '优先支持',
          }),
          description: t({
            en: 'Get faster responses and dedicated help when you need it',
            zh: '获得更快的响应和您需要时的专属帮助',
          }),
        },
        customIntegrations: {
          title: t({
            en: 'Custom Integrations',
            zh: '定制集成',
          }),
          description: t({
            en: 'Tailored solutions and custom feature development',
            zh: '量身定制的解决方案和定制功能开发',
          }),
        },
      },
      faq: {
        title: t({
          en: 'Pricing FAQ',
          zh: '定价常见问题',
        }),
        q1: {
          question: t({
            en: 'Can I upgrade or downgrade my plan anytime?',
            zh: '我可以随时升级或降级我的计划吗？',
          }),
          answer: t({
            en: 'Yes! You can upgrade your plan at any time. When you upgrade, you\'ll be charged the prorated amount for the remaining billing period. Downgrades take effect at the end of your current billing cycle.',
            zh: '可以！您可以随时升级计划。升级时，将按比例收取剩余计费周期的费用。降级将在当前计费周期结束时生效。',
          }),
        },
        q2: {
          question: t({
            en: 'What\'s included in the setup fee for Tier 2?',
            zh: '二级计划的设置费包含什么？',
          }),
          answer: t({
            en: 'The setup fee covers dedicated onboarding, custom configuration, team training, and initial custom integrations. Our team will work with you to ensure the platform is perfectly tailored to your needs.',
            zh: '设置费涵盖专属入职培训、定制配置、团队培训和初始定制集成。我们的团队将与您合作，确保平台完全满足您的需求。',
          }),
        },
        q3: {
          question: t({
            en: 'Do you offer refunds?',
            zh: '你们提供退款吗？',
          }),
          answer: t({
            en: 'We offer a 30-day money-back guarantee for all paid plans. If you\'re not satisfied with your purchase, contact us within 30 days for a full refund.',
            zh: '我们为所有付费计划提供 30 天退款保证。如果您对购买不满意，请在 30 天内联系我们全额退款。',
          }),
        },
        q4: {
          question: t({
            en: 'What payment methods do you accept?',
            zh: '您接受哪些付款方式？',
          }),
          answer: t({
            en: 'We accept all major credit cards (Visa, MasterCard, American Express) and PayPal. For enterprise accounts, we can also arrange bank transfers and custom billing cycles.',
            zh: '我们接受所有主要信用卡（Visa、MasterCard、American Express）和 PayPal。对于企业账户，我们还可以安排银行转账和自定义计费周期。',
          }),
        },
        q5: {
          question: t({
            en: 'Is there a discount for annual payments?',
            zh: '年度付款有折扣吗？',
          }),
          answer: t({
            en: 'Our listed prices are already for annual payments, providing significant savings compared to monthly billing. Contact us for custom enterprise pricing and multi-year discounts.',
            zh: '我们列出的价格已经是年度付款价格，与月度账单相比可节省大量费用。联系我们获取定制企业定价和多年度折扣。',
          }),
        },
      },
      cta: {
        title: t({
          en: 'Ready to Start Building?',
          zh: '准备开始构建了吗？',
        }),
        subtitle: t({
          en: 'Join thousands of developers building the future with AI-powered development',
          zh: '加入数千名使用 AI 驱动开发构建未来的开发者',
        }),
        primaryButton: t({
          en: 'Start Your Free Trial',
          zh: '开始免费试用',
        }),
        secondaryButton: t({
          en: 'Talk to Sales',
          zh: '与销售交谈',
        }),
      },
      trust: {
        security: t({
          en: 'Enterprise Security',
          zh: '企业级安全',
        }),
        support: t({
          en: '24/7 Support',
          zh: '24/7 支持',
        }),
        developers: t({
          en: '10,000+ Developers',
          zh: '10,000+ 开发者',
        }),
      },
    },
  },
  key: 'marketing',
} satisfies Dictionary;

export default marketingContent;
