import type { A2Category, A2Template } from './types';

export const A2_CATEGORIES: A2Category[] = [
  {
    id: 'content-creation',
    label: '内容创作',
    description: '写作与营销内容生成',
    icon: '✍️',
  },
  {
    id: 'content-organization',
    label: '内容整理',
    description: '排版、转换与格式化',
    icon: '🧩',
  },
  {
    id: 'design-presentation',
    label: '设计与呈现',
    description: '演示稿与设计文档',
    icon: '🎨',
  },
  {
    id: 'strategy-research',
    label: '策略与研究',
    description: '策略、心理与分析',
    icon: '🧠',
  },
];

export const A2_TEMPLATES: A2Template[] = [
  {
    id: 'social-content',
    categoryId: 'content-creation',
    title: '社媒内容生成',
    summary: '生成适配不同平台的内容草稿',
    template:
      '请为 {{platform}} 平台生成 {{count}} 条内容，主题：{{topic}}。风格：{{tone}}。目标受众：{{audience}}。',
    skillHint: 'social-content',
    skillTags: ['social', 'content', 'marketing'],
  },
  {
    id: 'landing-page-copy',
    categoryId: 'content-creation',
    title: '营销文案/落地页文案',
    summary: '输出核心卖点与转化导向文案',
    template:
      '请为 {{product}} 撰写落地页文案。目标受众：{{audience}}。核心卖点：{{value}}。期望行动：{{cta}}。',
    skillTags: ['copywriting', 'marketing'],
  },
  {
    id: 'wechat-format',
    categoryId: 'content-organization',
    title: '公众号排版发布',
    summary: '将内容整理为公众号可用排版',
    template:
      '请将以下内容整理为适合微信公众号发布的排版格式，包含标题、分段、小标题与重点强调：\n\n{{content}}',
    skillHint: 'baoyu-post-to-wechat',
    skillTags: ['wechat', 'format'],
  },
  {
    id: 'x-to-markdown',
    categoryId: 'content-organization',
    title: 'X/短文转 Markdown',
    summary: '将短文本整理成结构化 Markdown',
    template:
      '请将以下 X/短文本整理为结构化 Markdown（标题、要点、引用）：\n\n{{content}}',
    skillHint: 'baoyu-danger-x-to-markdown',
    skillTags: ['markdown', 'convert'],
  },
  {
    id: 'slide-deck-outline',
    categoryId: 'design-presentation',
    title: '演示稿/PPT 大纲',
    summary: '生成结构清晰的演示稿大纲',
    template:
      '请为 {{topic}} 生成一份 {{slides}} 页左右的演示稿大纲，包含每页标题与要点。',
    skillHint: 'baoyu-slide-deck',
    skillTags: ['ppt', 'slides', 'deck'],
  },
  {
    id: 'design-guidelines',
    categoryId: 'design-presentation',
    title: '设计规范/设计文档',
    summary: '输出设计规范结构与要点',
    template:
      '请基于以下产品背景生成设计规范/设计文档的目录与要点：{{context}}',
    skillHint: 'design-md',
    skillTags: ['design', 'guidelines'],
  },
  {
    id: 'marketing-psychology',
    categoryId: 'strategy-research',
    title: '营销心理分析',
    summary: '用心理学与心智模型给出建议',
    template:
      '请基于心理学/心智模型分析以下营销问题，并给出可执行建议：{{problem}}',
    skillHint: 'marketing-psychology',
    skillTags: ['psychology', 'strategy'],
  },
  {
    id: 'content-strategy',
    categoryId: 'strategy-research',
    title: '内容策略/增长策略',
    summary: '制定内容策略与阶段目标',
    template:
      '请制定 {{goal}} 的内容策略，目标受众：{{audience}}，周期：{{duration}}。',
    skillTags: ['strategy', 'growth'],
  },
];
