import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

const documentsContent = {
  content: {
    // Sidebar navigation
    sidebar: {
      title: t({ en: 'Files', zh: '文件' }),
      allFiles: t({ en: 'All Files', zh: 'All Files' }),
      documents: t({ en: 'Documents', zh: 'Documents' }),
      images: t({ en: 'Images', zh: 'Images' }),
      audio: t({ en: 'Audio', zh: 'Audio' }),
      videos: t({ en: 'Videos', zh: 'Videos' }),
      knowledgeBase: t({ en: 'Knowledge Base', zh: '知识库' }),
      allKbFiles: t({ en: 'All KB Files', zh: 'All KB Files' }),
      createKb: t({ en: 'Create new knowledge base', zh: '创建新知识库' }),
    },

    // Main toolbar
    toolbar: {
      searchPlaceholder: t({ en: 'Search files', zh: '搜索文件' }),
      uploadButton: t({ en: 'Upload', zh: '上传' }),
      editButton: t({ en: 'Edit', zh: '编辑' }),
      deleteButton: t({ en: 'Delete', zh: '删除' }),
      deleting: t({ en: 'Deleting…', zh: '删除中…' }),
    },

    // Delete confirmation
    deleteConfirm: {
      kb: t({
        en: 'Delete "{name}"? This will not delete the documents themselves.',
        zh: '删除 "{name}"？这不会删除文档本身。',
      }),
      removeDoc: t({
        en: 'Remove "{name}" from this knowledge base?',
        zh: '从知识库中移除 "{name}"？',
      }),
    },

    // Header row
    header: {
      allFiles: t({ en: 'All Files', zh: 'All Files' }),
      total: t({ en: 'Total {count}', zh: '共 {count}' }),
      kbDocuments: t({ en: 'Documents in this KB', zh: '此知识库中的文档' }),
      addDocuments: t({ en: 'Add Documents', zh: '添加文档' }),
      showInKb: t({ en: 'Show content in Knowledge Base', zh: '在知识库中显示内容' }),
    },

    // File table
    table: {
      file: t({ en: 'File', zh: '文件' }),
      createdAt: t({ en: 'Created At', zh: '创建时间' }),
      size: t({ en: 'Size', zh: '大小' }),
      noDocuments: t({ en: 'No documents found.', zh: '未找到文档。' }),
      selectAll: t({ en: 'Select all', zh: '全选' }),
      selectFile: t({ en: 'Select {name}', zh: '选择 {name}' }),
    },

    // KB document list
    kbList: {
      noDocuments: t({ en: 'No documents in this knowledge base', zh: '此知识库中没有文档' }),
      getStarted: t({ en: 'Click "Add Documents" to get started', zh: '点击"添加文档"开始' }),
      removeFromKb: t({ en: 'Remove from KB', zh: '从知识库移除' }),
      unknownType: t({ en: 'Unknown type', zh: '未知类型' }),
    },

    // Selected files bar
    selectedBar: {
      selected: t({ en: '{count} selected', zh: '已选择 {count}' }),
      clear: t({ en: 'Clear', zh: '清除' }),
      delete: t({ en: 'Delete', zh: '删除' }),
    },

    // Upload dialog
    upload: {
      title: t({ en: 'Upload document', zh: '上传文档' }),
      titleLabel: t({ en: 'Title', zh: '标题' }),
      titlePlaceholder: t({ en: 'Title', zh: '标题' }),
      textLabel: t({ en: 'Document Text', zh: '文档文本' }),
      textPlaceholder: t({ en: 'Paste text here…', zh: '在此粘贴文本…' }),
      attachFiles: t({ en: 'Attach files', zh: '附加文件' }),
      selectFiles: t({ en: 'Select Files', zh: '选择文件' }),
      clearAll: t({ en: 'Clear All', zh: '全部清除' }),
      uploading: t({ en: 'Uploading…', zh: '上传中…' }),
      upload: t({ en: 'Upload', zh: '上传' }),
      unknownError: t({ en: 'An unknown error occurred during upload.', zh: '上传时发生未知错误。' }),
    },

    // Create KB dialog
    createKb: {
      title: t({ en: 'Create Knowledge Base', zh: '创建知识库' }),
      nameLabel: t({ en: 'Name', zh: '名称' }),
      namePlaceholder: t({ en: 'e.g., Python Programming', zh: '例如：Python 编程' }),
      descriptionLabel: t({ en: 'Description', zh: '描述' }),
      descriptionPlaceholder: t({ en: 'Optional description...', zh: '可选描述...' }),
      create: t({ en: 'Create', zh: '创建' }),
      creating: t({ en: 'Creating…', zh: '创建中…' }),
      error: t({ en: 'Failed to create knowledge base', zh: '创建知识库失败' }),
    },

    // Edit KB dialog
    editKb: {
      title: t({ en: 'Edit Knowledge Base', zh: '编辑知识库' }),
      nameLabel: t({ en: 'Name', zh: '名称' }),
      namePlaceholder: t({ en: 'e.g., Python Programming', zh: '例如：Python 编程' }),
      descriptionLabel: t({ en: 'Description', zh: '描述' }),
      descriptionPlaceholder: t({ en: 'Optional description...', zh: '可选描述...' }),
      save: t({ en: 'Save', zh: '保存' }),
      saving: t({ en: 'Saving…', zh: '保存中…' }),
      error: t({ en: 'Failed to update knowledge base', zh: '更新知识库失败' }),
    },

    // Document Selector Modal (used in KB and Claude Chat)
    selector: {
      title: t({ en: 'Select documents to add to knowledge base', zh: '选择文档添加到知识库' }),
      close: t({ en: 'Close', zh: '关闭' }),
      searchPlaceholder: t({ en: 'Search documents...', zh: '搜索文档...' }),
      loading: t({ en: 'Loading...', zh: '加载中...' }),
      loadError: t({ en: 'Failed to load documents', zh: '加载文档失败' }),
      noDocuments: t({ en: 'No available documents', zh: '暂无可用文档' }),
      noResults: t({ en: 'No matching documents found', zh: '未找到匹配的文档' }),
      selectAll: t({ en: 'Select All', zh: '全选' }),
      deselectAll: t({ en: 'Deselect All', zh: '取消全选' }),
      selected: t({ en: '{count} selected', zh: '已选择 {count}' }),
      cancel: t({ en: 'Cancel', zh: '取消' }),
      adding: t({ en: 'Adding...', zh: '添加中...' }),
      addToSession: t({ en: 'Add to Session', zh: '添加到会话' }),
      addFailed: t({ en: 'Failed to add documents. Please try again.', zh: '添加文档失败，请重试。' }),
    },

    // Navigation sidebar (NavDocuments component)
    navDocuments: {
      title: t({ en: 'Documents', zh: 'Documents' }),
      more: t({ en: 'More', zh: '更多' }),
      open: t({ en: 'Open', zh: '打开' }),
      share: t({ en: 'Share', zh: '分享' }),
      delete: t({ en: 'Delete', zh: '删除' }),
    },
  },
  key: 'documents',
} satisfies Dictionary;

export default documentsContent;
