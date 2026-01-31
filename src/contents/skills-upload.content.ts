import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

const skillsUploadContent = {
  content: {
    // Page header
    header: {
      backLink: t({ en: 'Back to Skills List', zh: '返回技能列表' }),
      title: t({ en: 'Upload Custom Skill', zh: '上传自定义 Skill' }),
      description: t({
        en: 'Create and upload your own AI skill. Skills will be stored in your private space.',
        zh: '创建并上传您自己的 AI 技能。技能将存储在您的私有空间中。',
      }),
    },

    // Info alert
    info: {
      title: t({ en: 'About Skills', zh: '关于 Skills' }),
      point1: t({
        en: 'Skills are code packages containing a SKILL.md file',
        zh: 'Skills 是包含 SKILL.md 文件的代码包',
      }),
      point2: t({
        en: 'Automatically enabled after upload, ready to use immediately',
        zh: '上传后自动启用，立即可用',
      }),
      point3: t({
        en: 'Stored in your private space (.claude/skills/user/)',
        zh: '存储在您的私有空间（.claude/skills/user/）',
      }),
      point4: t({
        en: 'Supports code files, config files, documentation, and more',
        zh: '支持代码文件、配置文件、文档等多种文件类型',
      }),
    },

    // Help section
    help: {
      title: t({ en: 'Need Help?', zh: '需要帮助？' }),
      skillMdFormat: t({
        en: 'SKILL.md Format: Each skill must include a SKILL.md file with YAML frontmatter for metadata.',
        zh: 'SKILL.md 格式：每个技能必须包含 SKILL.md 文件，使用 YAML frontmatter 定义元数据。',
      }),
      fileStructure: t({
        en: 'File Structure: Supports multi-level directory structures, e.g. src/utils/helper.ts',
        zh: '文件结构：支持多级目录结构，例如 src/utils/helper.ts',
      }),
      resourceLimits: t({
        en: 'Resource Limits: Maximum 100 files per skill, total size not exceeding 10 MB.',
        zh: '资源限制：每个技能最多 100 个文件，总大小不超过 10 MB。',
      }),
      securityTip: t({
        en: 'Security Tip: Only run skills from trusted sources in your environment.',
        zh: '安全提示：上传的技能仅在您的环境中运行，请勿上传来自不可信来源的代码。',
      }),
    },

    // Form metadata card
    metadata: {
      title: t({ en: 'Skill Metadata', zh: '技能元数据' }),
      description: t({
        en: 'Fill in the basic information about the skill',
        zh: '填写技能的基本信息',
      }),
      nameLabel: t({ en: 'Skill Name', zh: '技能名称' }),
      nameRequired: t({ en: 'Skill Name', zh: '技能名称' }),
      namePlaceholder: t({ en: 'e.g., my-custom-skill', zh: '例如：my-custom-skill' }),
      nameCounter: t({ en: '{count}/50 characters', zh: '{count}/50 字符' }),
      descriptionLabel: t({ en: 'Description', zh: '描述' }),
      descriptionPlaceholder: t({
        en: 'Describe what this skill does...',
        zh: '描述这个技能的功能...',
      }),
      categoryLabel: t({ en: 'Category', zh: '分类' }),
    },

    // Categories
    categories: {
      development: t({ en: 'Development', zh: 'Development' }),
      productivity: t({ en: 'Productivity', zh: 'Productivity' }),
      design: t({ en: 'Design', zh: 'Design' }),
      integration: t({ en: 'Integration', zh: 'Integration' }),
    },

    // Form files card
    files: {
      title: t({ en: 'Skill Files', zh: '技能文件' }),
      description: t({
        en: 'Define the code and configuration files for the skill (must include at least SKILL.md)',
        zh: '定义技能的代码和配置文件（至少需要一个 SKILL.md）',
      }),
      addButton: t({ en: 'Add File', zh: '添加文件' }),
      filePlaceholder: t({ en: 'file-path.md', zh: 'file-path.md' }),
      contentPlaceholder: t({ en: 'File content for {path}...', zh: '{path} 的文件内容...' }),
      totalSize: t({
        en: 'Total Size: {size} KB / 10 MB • Files: {count} / 100',
        zh: '总大小：{size} KB / 10 MB • 文件数：{count} / 100',
      }),
    },

    // Form validation errors
    errors: {
      minOneFile: t({ en: 'At least one file is required', zh: '至少需要保留一个文件' }),
      nameRequired: t({ en: 'Skill name cannot be empty', zh: '技能名称不能为空' }),
      nameTooLong: t({
        en: 'Skill name cannot exceed 50 characters',
        zh: '技能名称不能超过50个字符',
      }),
      minOneFileRequired: t({ en: 'At least one file is required', zh: '至少需要一个文件' }),
      maxFilesExceeded: t({ en: 'Cannot exceed 100 files', zh: '文件数量不能超过100个' }),
      maxSizeExceeded: t({
        en: 'Total size cannot exceed 10 MB (current: {size} MB)',
        zh: '技能总大小不能超过10 MB（当前：{size} MB）',
      }),
      emptyPath: t({ en: 'File path cannot be empty', zh: '文件路径不能为空' }),
      noParentDir: t({ en: 'File path cannot contain ".."', zh: '文件路径不能包含 ".."' }),
      uploadFailed: t({ en: 'Upload failed', zh: '上传失败' }),
    },

    // Buttons
    buttons: {
      cancel: t({ en: 'Cancel', zh: '取消' }),
      uploading: t({ en: 'Uploading...', zh: '上传中...' }),
      submit: t({ en: 'Upload Skill', zh: '上传技能' }),
    },
  },
  key: 'skills-upload',
} satisfies Dictionary;

export default skillsUploadContent;
