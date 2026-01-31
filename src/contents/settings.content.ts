import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * Settings page content dictionary
 * Contains labels and messages for user settings and preferences
 */
const settingsContent = {
  content: {
    page: {
      title: t({
        en: 'Settings',
        zh: '设置',
      }),
      breadcrumb: t({
        en: 'Settings',
        zh: '设置',
      }),
      dialogDescription: t({
        en: 'Project and chat settings',
        zh: '项目与聊天设置',
      }),
    },
    dialog: {
      title: t({ en: 'Settings', zh: '设置' }),
      description: t({ en: 'Project and chat settings', zh: '项目与聊天设置' }),
    },
    permissionModes: {
      standard: t({ en: 'Standard', zh: '标准' }),
      plan: t({ en: 'Plan', zh: '计划' }),
      dontAsk: t({ en: "Don't Ask", zh: '不再询问' }),
      acceptEdits: t({ en: 'Accept Edits', zh: '接受编辑' }),
      delegate: t({ en: 'Delegate', zh: '委托' }),
      bypass: t({ en: 'Bypass', zh: '绕过' }),
      descStandard: t({ en: 'Safe mode: requires permission confirmation', zh: '安全模式：需要权限确认' }),
      descPlan: t({ en: 'Plan mode: prefers EnterPlanMode', zh: '规划模式：优先使用 EnterPlanMode' }),
      descDontAsk: t({ en: 'Auto mode: executes safe actions automatically', zh: '自动模式：自动执行安全操作' }),
      descAcceptEdits: t({ en: 'Edit mode: auto-accepts file edits', zh: '编辑模式：自动接受文件编辑' }),
      descDelegate: t({ en: 'Delegate mode: allows task delegation', zh: '委托模式：允许委派任务' }),
      descBypass: t({ en: 'Advanced mode: no permission confirmation', zh: '高级模式：无权限确认' }),
    },
    navigation: {
      workspace: t({
        en: 'Workspace',
        zh: '工作空间',
      }),
      billing: t({
        en: 'Billing',
        zh: '账单',
      }),
    },
    sections: {
      profile: {
        title: t({
          en: 'Profile',
          zh: '个人资料',
        }),
        description: t({
          en: 'Update your personal information',
          zh: '更新您的个人信息',
        }),
      },
      account: {
        title: t({
          en: 'Account',
          zh: '账户',
        }),
        description: t({
          en: 'Manage profile details and security credentials',
          zh: '管理个人资料详情和安全凭证',
        }),
      },
      organization: {
        title: t({
          en: 'Organization',
          zh: '组织',
        }),
        description: t({
          en: 'Create and manage your organization',
          zh: '创建和管理您的组织',
        }),
      },
      preferences: {
        title: t({
          en: 'Preferences',
          zh: '偏好设置',
        }),
        description: t({
          en: 'Interface and theme settings',
          zh: '界面和主题设置',
        }),
      },
      plans: {
        title: t({
          en: 'Plans',
          zh: '计划',
        }),
        description: t({
          en: 'Manage your subscription tiers and credit packs',
          zh: '管理您的订阅计划和信用包',
        }),
      },
      billing: {
        title: t({
          en: 'Billing & Invoices',
          zh: '账单与发票',
        }),
        description: t({
          en: 'Payment details, billing profile, and invoices',
          zh: '付款详情、账单资料和发票',
        }),
        page: {
          title: t({
            en: 'Billing settings',
            zh: '账单设置',
          }),
          subtitle: t({
            en: 'Update invoice details, download receipts, and manage your subscription',
            zh: '更新发票详情、下载收据并管理您的订阅',
          }),
        },
      },
      permissions: {
        title: t({
          en: 'Permissions',
          zh: '权限',
        }),
        description: t({
          en: 'Configure organization permission modes and tool access control',
          zh: '配置组织的权限模式和工具访问控制',
        }),
      },
      security: {
        title: t({
          en: 'Security',
          zh: '安全',
        }),
        description: t({
          en: 'Manage your security settings',
          zh: '管理您的安全设置',
        }),
      },
      notifications: {
        title: t({
          en: 'Notifications',
          zh: '通知',
        }),
        description: t({
          en: 'Manage your notification preferences',
          zh: '管理您的通知偏好',
        }),
      },
      apiKeys: {
        title: t({
          en: 'API Keys',
          zh: 'API 密钥',
        }),
        description: t({
          en: 'Manage your API keys',
          zh: '管理您的 API 密钥',
        }),
      },
    },
    profile: {
      nameLabel: t({
        en: 'Display Name',
        zh: '显示名称',
      }),
      namePlaceholder: t({
        en: 'Enter your name',
        zh: '输入您的姓名',
      }),
      emailLabel: t({
        en: 'Email',
        zh: '邮箱',
      }),
      emailLabelReadonly: t({
        en: 'Email (cannot be changed)',
        zh: '邮箱（不可更改）',
      }),
      avatarLabel: t({
        en: 'Avatar',
        zh: '头像',
      }),
      uploadAvatar: t({
        en: 'Upload new avatar',
        zh: '上传新头像',
      }),
      removeAvatar: t({
        en: 'Remove avatar',
        zh: '移除头像',
      }),
    },
    preferences: {
      theme: {
        label: t({
          en: 'Theme',
          zh: '主题',
        }),
        light: t({
          en: 'Light',
          zh: '浅色',
        }),
        dark: t({
          en: 'Dark',
          zh: '深色',
        }),
        system: t({
          en: 'System',
          zh: '跟随系统',
        }),
      },
      language: {
        label: t({
          en: 'Language',
          zh: '语言',
        }),
        english: t({
          en: 'English',
          zh: '英语',
        }),
        chinese: t({
          en: '中文',
          zh: '中文',
        }),
      },
      timezone: {
        label: t({
          en: 'Timezone',
          zh: '时区',
        }),
      },
    },
    security: {
      changePassword: {
        title: t({
          en: 'Change Password',
          zh: '更改密码',
        }),
        currentPassword: t({
          en: 'Current Password',
          zh: '当前密码',
        }),
        newPassword: t({
          en: 'New Password',
          zh: '新密码',
        }),
        confirmPassword: t({
          en: 'Confirm New Password',
          zh: '确认新密码',
        }),
        submitButton: t({
          en: 'Update Password',
          zh: '更新密码',
        }),
      },
      twoFactor: {
        title: t({
          en: 'Two-Factor Authentication',
          zh: '双因素认证',
        }),
        description: t({
          en: 'Add an extra layer of security to your account',
          zh: '为您的账户添加额外的安全层',
        }),
        enable: t({
          en: 'Enable',
          zh: '启用',
        }),
        disable: t({
          en: 'Disable',
          zh: '禁用',
        }),
        enabled: t({
          en: 'Enabled',
          zh: '已启用',
        }),
        disabled: t({
          en: 'Disabled',
          zh: '已禁用',
        }),
      },
      sessions: {
        title: t({
          en: 'Active Sessions',
          zh: '活跃会话',
        }),
        description: t({
          en: 'Manage your active sessions across devices',
          zh: '管理您在各设备上的活跃会话',
        }),
        currentSession: t({
          en: 'Current Session',
          zh: '当前会话',
        }),
        revoke: t({
          en: 'Revoke',
          zh: '撤销',
        }),
        revokeAll: t({
          en: 'Revoke All Other Sessions',
          zh: '撤销所有其他会话',
        }),
      },
    },
    notifications: {
      emailNotifications: {
        label: t({
          en: 'Email Notifications',
          zh: '邮件通知',
        }),
        description: t({
          en: 'Receive updates via email',
          zh: '通过邮件接收更新',
        }),
      },
      pushNotifications: {
        label: t({
          en: 'Push Notifications',
          zh: '推送通知',
        }),
        description: t({
          en: 'Receive push notifications in your browser',
          zh: '在浏览器中接收推送通知',
        }),
      },
      marketingEmails: {
        label: t({
          en: 'Marketing Emails',
          zh: '营销邮件',
        }),
        description: t({
          en: 'Receive news and product updates',
          zh: '接收新闻和产品更新',
        }),
      },
    },
    apiKeys: {
      createButton: t({
        en: 'Create New API Key',
        zh: '创建新的 API 密钥',
      }),
      nameLabel: t({
        en: 'Name',
        zh: '名称',
      }),
      namePlaceholder: t({
        en: 'e.g., Production API Key',
        zh: '例如：生产环境 API 密钥',
      }),
      keyCreated: t({
        en: 'Key created successfully',
        zh: '密钥创建成功',
      }),
      keyDeleted: t({
        en: 'Key deleted successfully',
        zh: '密钥删除成功',
      }),
      noKeys: t({
        en: 'No API keys yet',
        zh: '暂无 API 密钥',
      }),
      createdAt: t({
        en: 'Created',
        zh: '创建时间',
      }),
      lastUsed: t({
        en: 'Last Used',
        zh: '最后使用',
      }),
      never: t({
        en: 'Never',
        zh: '从未',
      }),
      copyKey: t({
        en: 'Copy Key',
        zh: '复制密钥',
      }),
      deleteKey: t({
        en: 'Delete Key',
        zh: '删除密钥',
      }),
    },
    actions: {
      saveChanges: t({
        en: 'Save Changes',
        zh: '保存更改',
      }),
      cancel: t({
        en: 'Cancel',
        zh: '取消',
      }),
      deleteAccount: t({
        en: 'Delete Account',
        zh: '删除账户',
      }),
    },
    success: {
      profileUpdated: t({
        en: 'Profile updated successfully',
        zh: '个人资料更新成功',
      }),
      preferencesUpdated: t({
        en: 'Preferences updated successfully',
        zh: '偏好设置更新成功',
      }),
      passwordUpdated: t({
        en: 'Password updated successfully',
        zh: '密码更新成功',
      }),
    },
    errors: {
      updateFailed: t({
        en: 'Failed to update settings',
        zh: '设置更新失败',
      }),
      invalidPassword: t({
        en: 'Current password is incorrect',
        zh: '当前密码不正确',
      }),
      weakPassword: t({
        en: 'New password is too weak',
        zh: '新密码太弱',
      }),
    },

    // Plan Settings
    plans: {
      loadingPlanDetails: t({
        en: 'Loading plan details…',
        zh: '加载计划详情中…',
      }),
      failedToLoadPlan: t({
        en: 'Failed to load plan information. Please refresh and try again.',
        zh: '加载计划信息失败，请刷新后重试。',
      }),
      planNotConfigured: t({
        en: 'Plan not configured. Set POLAR product IDs in your environment.',
        zh: '计划未配置，请在环境中设置 POLAR 产品 ID。',
      }),
      unableToStartCheckout: t({
        en: 'Unable to start checkout. Please try again.',
        zh: '无法启动结账流程，请重试。',
      }),
      creditPackNotConfigured: t({
        en: 'Credit pack not configured. Add the POLAR_PRODUCT_CREDITS_* env vars.',
        zh: '积分包未配置，请添加 POLAR_PRODUCT_CREDITS_* 环境变量。',
      }),
      manageInPortal: t({
        en: 'Manage in Portal',
        zh: '在门户中管理',
      }),
      downgradeToPro: t({
        en: 'Downgrade to Pro',
        zh: '降级到 Pro',
      }),
      upgradeToPro: t({
        en: 'Upgrade to Pro',
        zh: '升级到 Pro',
      }),
      upgradeToBusiness: t({
        en: 'Upgrade to Business',
        zh: '升级到 Business',
      }),
      chooseBusiness: t({
        en: 'Choose Business',
        zh: '选择 Business',
      }),
      needMoreCredits: t({
        en: 'Need more credits?',
        zh: '需要更多积分？',
      }),
      creditPackDescription: t({
        en: 'Purchase one-time credit packs that never expire and apply instantly.',
        zh: '购买一次性的积分包，永不过期，即时生效。',
      }),
      buy50: t({
        en: 'Buy 50',
        zh: '购买 50',
      }),
      buy100: t({
        en: 'Buy 100',
        zh: '购买 100',
      }),
      openBillingPortal: t({
        en: 'Open billing portal',
        zh: '打开账单门户',
      }),
      subscriptionUpdated: t({
        en: 'Subscription updated',
        zh: '订阅已更新',
      }),
      planRefreshed: t({
        en: 'Your plan has been refreshed. Give it a moment if credits take a few seconds to sync.',
        zh: '您的计划已刷新，如果积分需要几秒钟同步，请稍候。',
      }),
      dismissSuccessMessage: t({
        en: 'Dismiss success message',
        zh: '关闭成功消息',
      }),
      // Plan names and features
      pro: {
        name: t({ en: 'Pro', zh: 'Pro' }),
        price: t({ en: '$25 / month', zh: '$25 / 月' }),
        feature1: t({ en: '100 monthly credits', zh: '每月 100 积分' }),
        feature2: t({ en: 'Private projects', zh: '私有项目' }),
        feature3: t({ en: 'Roles & permissions', zh: '角色和权限' }),
      },
      business: {
        name: t({ en: 'Business', zh: 'Business' }),
        price: t({ en: '$50 / month', zh: '$50 / 月' }),
        feature1: t({ en: '150 monthly credits', zh: '每月 150 积分' }),
        feature2: t({ en: 'SSO & audit logs', zh: 'SSO 和审计日志' }),
        feature3: t({ en: 'Priority support', zh: '优先支持' }),
      },
      enterprise: {
        name: t({ en: 'Enterprise', zh: '企业版' }),
        price: t({ en: 'Custom', zh: '定制' }),
        feature1: t({ en: 'Dedicated support', zh: '专属支持' }),
        feature2: t({ en: 'Onboarding & SLAs', zh: '入职培训和 SLA' }),
        feature3: t({ en: 'Custom integrations', zh: '自定义集成' }),
      },
    },

    // Billing Settings
    billing: {
      loadingBillingDetails: t({
        en: 'Loading billing details…',
        zh: '加载账单详情中…',
      }),
      failedToLoadBillingProfile: t({
        en: 'Failed to load billing profile',
        zh: '加载账单资料失败',
      }),
      failedToLoadInvoices: t({
        en: 'Failed to load invoices',
        zh: '加载发票失败',
      }),
      unableToLoadBillingDetails: t({
        en: 'Unable to load billing details.',
        zh: '无法加载账单详情。',
      }),
      billingEmail: t({
        en: 'Billing email',
        zh: '账单邮箱',
      }),
      company: t({
        en: 'Company',
        zh: '公司',
      }),
      addressLine1: t({
        en: 'Address line 1',
        zh: '地址行 1',
      }),
      addressLine2: t({
        en: 'Address line 2',
        zh: '地址行 2',
      }),
      city: t({
        en: 'City',
        zh: '城市',
      }),
      stateRegion: t({
        en: 'State/Region',
        zh: '州/地区',
      }),
      postalCode: t({
        en: 'Postal code',
        zh: '邮政编码',
      }),
      countryISO: t({
        en: 'Country (ISO)',
        zh: '国家（ISO 代码）',
      }),
      vatTaxId: t({
        en: 'VAT / Tax ID',
        zh: '增值税 / 税号',
      }),
      saving: t({
        en: 'Saving…',
        zh: '保存中…',
      }),
      saveBillingDetails: t({
        en: 'Save billing details',
        zh: '保存账单详情',
      }),
      unableToOpenPortal: t({
        en: 'Unable to open customer portal. Please try again.',
        zh: '无法打开客户门户，请重试。',
      }),
      openCustomerPortal: t({
        en: 'Open customer portal',
        zh: '打开客户门户',
      }),
      failedToSaveBilling: t({
        en: 'Failed to save billing settings',
        zh: '保存账单设置失败',
      }),
      invoices: t({
        en: 'Invoices',
        zh: '发票',
      }),
      invoicesDescription: t({
        en: 'Download receipts or generate invoices for recent purchases.',
        zh: '下载收据或为最近的购买生成发票。',
      }),
      failedToGenerateInvoice: t({
        en: 'Failed to generate invoice.',
        zh: '生成发票失败。',
      }),
    },

    // Organization Settings
    organization: {
      nameRequired: t({
        en: 'Organization name is required',
        zh: '组织名称必填',
      }),
      slugRequired: t({
        en: 'Slug is required',
        zh: 'Slug 必填',
      }),
      slugInvalid: t({
        en: 'Slug must contain only lowercase letters, numbers, and hyphens',
        zh: 'Slug 只能包含小写字母、数字和连字符',
      }),
      failedToLoadOrganizations: t({
        en: 'Failed to load organizations',
        zh: '加载组织失败',
      }),
      failedToCreateOrganization: t({
        en: 'Failed to create organization',
        zh: '创建组织失败',
      }),
      owner: t({
        en: 'Owner',
        zh: '所有者',
      }),
      admin: t({
        en: 'Admin',
        zh: '管理员',
      }),
      member: t({
        en: 'Member',
        zh: '成员',
      }),
      createOrganization: t({
        en: 'Create Organization',
        zh: '创建组织',
      }),
      createOrgDescription: t({
        en: 'Create an organization to manage permissions and collaborate with your team. You will automatically become the owner of the organization.',
        zh: '创建组织以管理权限并与团队协作。您将自动成为组织的所有者。',
      }),
      orgNameLabel: t({
        en: 'Organization Name *',
        zh: '组织名称 *',
      }),
      orgNamePlaceholder: t({
        en: 'My Organization',
        zh: '我的组织',
      }),
      slugLabel: t({
        en: 'Slug (Optional)',
        zh: 'Slug（可选）',
      }),
      slugPlaceholder: t({
        en: 'my-org',
        zh: 'my-org',
      }),
      slugHelpText: t({
        en: 'Unique identifier for your organization. Leave empty to auto-generate.',
        zh: '组织的唯一标识符，留空以自动生成。',
      }),
      orgCreatedSuccess: t({
        en: 'Organization created successfully! You are now the owner.',
        zh: '组织创建成功！您现在是所有者。',
      }),
      creating: t({
        en: 'Creating...',
        zh: '创建中...',
      }),
      createOrgButton: t({
        en: 'Create Organization',
        zh: '创建组织',
      }),
      yourOrganizations: t({
        en: 'Your Organizations',
        zh: '您的组织',
      }),
      yourOrgsDescription: t({
        en: 'Organizations you are a member of',
        zh: '您所属的组织',
      }),
      loading: t({
        en: 'Loading...',
        zh: '加载中...',
      }),
      noOrganizations: t({
        en: 'You are not a member of any organization yet. Create one above to get started.',
        zh: '您还不是任何组织的成员，请在上方创建一个以开始。',
      }),
      slug: t({
        en: 'Slug: {slug}',
        zh: 'Slug：{slug}',
      }),
      orgOwnerBenefits: t({
        en: 'Organization Owner Benefits: As an organization owner, you can configure permission modes, enable Bash tool access, and manage team members. Visit the Permissions settings after creating an organization.',
        zh: '组织所有者权益：作为组织所有者，您可以配置权限模式、启用 Bash 工具访问并管理团队成员。创建组织后请访问权限设置。',
      }),
    },

    // Preferences Settings
    ui: {
      interfaceTheme: t({
        en: 'Interface & Theme',
        zh: '界面与主题',
      }),
      customizeAppearance: t({
        en: 'Customize the appearance of your Codefetch interface',
        zh: '自定义 Codefetch 界面的外观',
      }),
      theme: t({
        en: 'Theme',
        zh: '主题',
      }),
      light: t({
        en: 'Light',
        zh: '浅色',
      }),
      dark: t({
        en: 'Dark',
        zh: '深色',
      }),
      system: t({
        en: 'System',
        zh: '系统',
      }),
      lightDescription: t({
        en: 'Bright and clean interface',
        zh: '明亮清爽的界面',
      }),
      darkDescription: t({
        en: 'Easy on the eyes in low light',
        zh: '弱光下保护眼睛',
      }),
      systemDescription: t({
        en: 'Follow your system preference',
        zh: '跟随系统偏好',
      }),
      currentTheme: t({
        en: 'Current Theme',
        zh: '当前主题',
      }),
      mode: t({
        en: '{theme} mode',
        zh: '{theme} 模式',
      }),
      languageTitle: t({
        en: 'Language',
        zh: '语言',
      }),
      languageDescription: t({
        en: 'Choose the display language for the interface',
        zh: '选择界面显示语言',
      }),
      currentLanguage: t({
        en: 'Current Language',
        zh: '当前语言',
      }),
    },
  },
  key: 'settings',
} satisfies Dictionary;

export default settingsContent;
