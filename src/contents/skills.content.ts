import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

const skillsContent = {
  content: {
    // Route header
    header: {
      title: t({ en: 'Skills Management', zh: 'Skills 管理' }),
      description: t({
        en: 'Manage your AI skills ({count} skills)',
        zh: '管理您的 AI 技能（{count} 个）',
      }),
      uploadButton: t({ en: 'Upload New Skill', zh: '上传新技能' }),
      githubInstallButton: t({ en: 'GitHub Install', zh: 'GitHub 安装' }),
    },

    // Categories
    categories: {
      all: t({ en: 'All Skills', zh: 'All Skills' }),
      development: t({ en: 'Development', zh: 'Development' }),
      design: t({ en: 'Design', zh: 'Design' }),
      productivity: t({ en: 'Productivity', zh: 'Productivity' }),
      integration: t({ en: 'Integration', zh: 'Integration' }),
      installed: t({ en: 'Installed', zh: 'Installed' }),
    },

    // Sidebar
    sidebar: {
      title: t({ en: 'Skills', zh: 'Skills' }),
    },

    // Toolbar
    toolbar: {
      searchPlaceholder: t({ en: 'Search skills...', zh: '搜索技能...' }),
      allSkills: t({ en: 'All Skills', zh: 'All Skills' }),
    },

    // Empty state
    empty: {
      title: t({ en: 'No skills found', zh: '未找到技能' }),
      subtitle: t({ en: 'Try adjusting your search or filter', zh: '尝试调整搜索或筛选条件' }),
    },

    // Skill card
    card: {
      globalEnabled: t({ en: 'Globally Enabled', zh: '全局启用中' }),
      custom: t({ en: 'Custom', zh: '自定义' }),
      github: t({ en: 'GitHub', zh: 'GitHub' }),
      enableButton: t({ en: 'Enable', zh: '启用' }),
      disableButton: t({ en: 'Disable', zh: '禁用' }),
      globalLabel: t({ en: 'Global', zh: '全局' }),
      manageSchemaTitle: t({ en: 'Manage Schema', zh: '管理 Schema' }),
      viewDetailsTitle: t({ en: 'View Details', zh: '查看详情' }),
      deleteCustomTitle: t({ en: 'Delete Custom Skill', zh: '删除自定义技能' }),
      deleteGithubTitle: t({ en: 'Delete GitHub-installed Skill', zh: '删除 GitHub 安装的技能' }),
      enabledTooltip: t({ en: 'Globally enabled, cannot disable', zh: '已全局启用，无法关闭' }),
      schemaStatus: {
        missing: t({ en: 'Missing', zh: 'Missing' }),
        valid: t({ en: 'Valid', zh: 'Valid' }),
        invalid: t({ en: 'Invalid', zh: 'Invalid' }),
        stale: t({ en: 'Stale', zh: 'Stale' }),
        failed: t({ en: 'Failed', zh: 'Failed' }),
        loading: t({ en: 'Loading', zh: 'Loading' }),
      },
    },

    // Toast messages
    toast: {
      skillNotFound: t({ en: 'Skill not found', zh: '未找到技能' }),
      globalEnabledError: t({
        en: 'This skill has been globally enabled by administrator and cannot be disabled.',
        zh: '该技能已被管理员全局启用，无法关闭。',
      }),
      toggleFailed: t({ en: 'Failed to toggle skill', zh: '启用技能失败' }),
      skillNotSynced: t({
        en: 'Skill not synced to runtime directory: {slug}. Current enable will not take effect.',
        zh: '技能未同步到运行时目录：{slug}。当前启用不会生效。',
      }),
      globalEnableFailed: t({ en: 'Failed to enable globally', zh: '全局启用失败' }),
      cannotDeleteOfficial: t({
        en: 'This is a built-in skill and cannot be deleted.',
        zh: '这是内置技能，无法删除',
      }),
      deleteConfirmCustom: t({
        en: 'Are you sure you want to delete this custom skill? This action cannot be undone.',
        zh: '确定要删除这个自定义技能吗？此操作无法撤销。',
      }),
      deleteConfirmGithub: t({
        en: 'Are you sure you want to delete this GitHub skill from the global store? All users will no longer see this skill.',
        zh: '确定要从全局技能库删除这个 GitHub 技能吗？所有用户将无法再看到此技能。',
      }),
      deleteFailed: t({ en: 'Failed to delete skill', zh: '删除技能失败' }),
    },

    // Upload dialog
    upload: {
      title: t({ en: 'Upload Skill', zh: '上传技能' }),
      description: t({
        en: 'Upload a skill package containing SKILL.md, supports .zip or .skill format',
        zh: '上传包含 SKILL.md 的技能包，支持 .zip 或 .skill 格式',
      }),
      dragPrompt: t({
        en: 'Drag and drop file here, or',
        zh: '拖拽文件到此处，或',
      }),
      clickToSelect: t({ en: 'Click to select file', zh: '点击选择文件' }),
      formatHelp: t({
        en: 'Supports .zip or .skill format, max 10 MB. Must contain SKILL.md file.',
        zh: 'Supports .zip or .skill format, max 10 MB<br />Must contain SKILL.md file',
      }),
      parsing: t({ en: 'Parsing file...', zh: '解析文件中...' }),
      filesCount: t({ en: '{count} files', zh: '{count} 个文件' }),
      reselect: t({ en: 'Reselect', zh: '重新选择' }),
      compatibilityWarning: t({ en: 'Compatibility Warning', zh: '兼容性警告' }),
      compatibilityAdvice: t({
        en: 'Install with caution. If you still want to upload, click "Upload" again to continue.',
        zh: '建议谨慎安装。如仍要上传，请再次点击"上传"按钮继续。',
      }),
      recheck: t({ en: 'Recheck', zh: '重新检查' }),
      cancel: t({ en: 'Cancel', zh: '取消' }),
      uploadButton: t({ en: 'Upload', zh: '上传' }),
      checking: t({ en: 'Checking...', zh: '检查中...' }),
      uploading: t({ en: 'Uploading...', zh: '上传中...' }),
      stillUpload: t({ en: 'Upload Anyway', zh: '仍然上传' }),
      errorInvalidFormat: t({
        en: 'Only .zip or .skill format files are supported',
        zh: '仅支持 .zip 或 .skill 格式的文件',
      }),
      errorFileSize: t({ en: 'File size cannot exceed 10 MB', zh: '文件大小不能超过 10 MB' }),
      errorTooManyFiles: t({ en: 'File count exceeds limit (max 100 files)', zh: '文件数量超过限制（最多 100 个文件）' }),
      errorNoSkillMd: t({ en: 'Skill package must contain SKILL.md file', zh: '技能包必须包含 SKILL.md 文件' }),
      errorParseFailed: t({ en: 'Failed to parse file', zh: '解析文件失败' }),
      errorSelectFile: t({ en: 'Please select a valid skill package first', zh: '请先选择有效的技能包' }),
      errorCompatCheck: t({ en: 'Compatibility check failed', zh: '兼容性检查失败' }),
      errorUploadFailed: t({ en: 'Upload failed', zh: '上传失败' }),
      errorNoSkillMdFound: t({ en: 'SKILL.md file not found', zh: '未找到 SKILL.md 文件' }),
    },

    // GitHub installer
    github: {
      title: t({ en: 'Install from GitHub', zh: '从 GitHub 安装技能' }),
      description: t({
        en: 'Install skills from GitHub repositories using npx skills add command format',
        zh: '使用 npx skills add 命令格式从 GitHub 仓库安装技能',
      }),
      commandLabel: t({ en: 'Install Command', zh: '安装命令' }),
      commandPlaceholder: t({ en: 'npx skills add owner/repo --skill skill-name', zh: 'npx skills add owner/repo --skill skill-name' }),
      formatHelp: t({ en: 'Supported formats:', zh: '支持的格式：' }),
      parseSuccess: t({ en: 'Parse Successful', zh: '解析成功' }),
      repoLabel: t({ en: 'Repository:', zh: '仓库：' }),
      skillNameLabel: t({ en: 'Skill Name:', zh: '技能名称：' }),
      parseError: t({
        en: 'Invalid command format. Use: npx skills add <repo-url> --skill <skill-name>',
        zh: '命令格式无效。请使用：npx skills add <仓库地址> --skill <技能名称>',
      }),
      installSuccess: t({ en: 'Installation Successful', zh: '安装成功' }),
      installedMessage: t({
        en: 'Skill <strong>{name}</strong> has been added to the skill store',
        zh: '技能 <strong>{name}</strong> 已添加到技能库',
      }),
      installFailed: t({ en: 'Installation Failed', zh: '安装失败' }),
      invalidCommand: t({ en: 'Please enter a valid install command', zh: '请输入有效的安装命令' }),
      recheck: t({ en: 'Recheck', zh: '重新检查' }),
      cancel: t({ en: 'Cancel', zh: '取消' }),
      checking: t({ en: 'Checking...', zh: '检查中...' }),
      installing: t({ en: 'Installing...', zh: '安装中...' }),
      complete: t({ en: 'Complete', zh: '完成' }),
      installAnyway: t({ en: 'Install Anyway', zh: '仍然安装' }),
      install: t({ en: 'Install', zh: '安装' }),
      compatCheckFailed: t({ en: 'Compatibility check failed', zh: '兼容性检查失败' }),
    },

    // Skill detail dialog
    detail: {
      filesLabel: t({ en: 'Files', zh: 'Files' }),
      selectFile: t({ en: 'Select a file to view its content', zh: 'Select a file to view its content' }),
      noContent: t({ en: 'No content available', zh: 'No content available' }),
      binaryFile: t({ en: 'Binary file - preview not available', zh: 'Binary file - preview not available' }),
      tooLarge: t({ en: 'File too large for preview (>1MB)', zh: 'File too large for preview (>1MB)' }),
      directoryNoContent: t({ en: 'Directories have no content preview', zh: 'Directories have no content preview' }),
    },

    // Schema manage dialog
    schema: {
      title: t({ en: 'Schema Management', zh: 'Schema 管理' }),
      description: t({ en: 'Manage JSON Schema for <code>{name}</code>', zh: '管理 <code>{name}</code> 的 JSON Schema' }),
      loading: t({ en: 'Loading...', zh: '加载中...' }),
      statusLabel: t({ en: 'Status:', zh: '状态：' }),
      needsReview: t({ en: 'Needs Manual Review', zh: '需人工校验' }),
      metadata: t({ en: 'Metadata', zh: '元数据' }),
      generatedAt: t({ en: 'Generated:', zh: '生成时间：' }),
      lastAttempt: t({ en: 'Last Attempt:', zh: '上次尝试：' }),
      generatedBy: t({ en: 'Generated By:', zh: '生成者：' }),
      model: t({ en: 'Model:', zh: '模型：' }),
      skillMdHash: t({ en: 'SKILL.md Hash:', zh: 'SKILL.md Hash:' }),
      lastError: t({ en: 'Last Error:', zh: '上次错误:' }),
      reviewWarning: t({
        en: 'This schema was generated in fallback mode. Please verify manually before using.',
        zh: '该 Schema 由容错模式生成，请人工核对后再使用。',
      }),
      formPreview: t({ en: 'Form Preview', zh: '表单预览' }),
      jsonPreview: t({ en: 'JSON Preview', zh: 'JSON 预览' }),
      fieldCount: t({ en: 'Fields: {count} ({required} required)', zh: '字段数: {count}（必填 {required}）' }),
      noFields: t({ en: 'No input fields', zh: '暂无输入字段' }),
      noFieldsPreview: t({ en: 'No input fields to preview', zh: '暂无可预览的输入字段' }),
      required: t({ en: 'Required', zh: '必填' }),
      placeholderLabel: t({ en: 'Placeholder:', zh: '占位提示：' }),
      selectPlaceholder: t({ en: 'Please select', zh: '请选择' }),
      noOptions: t({ en: 'No options available', zh: '无可选项' }),
      booleanLabel: t({ en: 'Yes / No', zh: '是 / 否' }),
      optionLabel: t({ en: 'Option', zh: '选项' }),
      closeButton: t({ en: 'Close', zh: '关闭' }),
      saveButton: t({ en: 'Save Changes', zh: '保存修改' }),
      saving: t({ en: 'Saving...', zh: '保存中...' }),
      generateButton: t({ en: 'Generate Schema', zh: '生成 Schema' }),
      regenerateButton: t({ en: 'Regenerate', zh: '重新生成' }),
      generating: t({ en: 'Generating...', zh: '生成中...' }),
      costWarning: t({
        en: 'Note: Generating/regenerating Schema will call AI API and incur costs. Only operate when necessary.',
        zh: '注意：生成/重新生成 Schema 会调用 AI API，会产生费用。建议仅在必要时操作。',
      }),
      statusDescriptions: {
        missing: t({ en: 'Schema not generated', zh: 'Schema 未生成' }),
        valid: t({ en: 'Schema is valid and up to date', zh: 'Schema 有效且最新' }),
        invalid: t({ en: 'Schema exists but failed to parse', zh: 'Schema 存在但解析失败' }),
        stale: t({ en: 'Schema is stale, SKILL.md has been updated', zh: 'Schema 过期，SKILL.md 已更新' }),
        failed: t({ en: 'Last generation failed', zh: '上次生成失败' }),
        generating: t({ en: 'Generating Schema...', zh: '正在生成 Schema...' }),
        unknown: t({ en: 'Schema status unknown', zh: 'Schema 状态未知' }),
      },
      unknown: t({ en: 'Unknown', zh: '未知' }),
    },
  },
  key: 'skills',
} satisfies Dictionary;

export default skillsContent;
