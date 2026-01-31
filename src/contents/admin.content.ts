import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * Admin panel content dictionary
 * Contains labels and messages for administrative functions
 */
const adminContent = {
  content: {
    page: {
      title: t({
        en: 'Admin Panel',
        zh: '管理面板',
      }),
      subtitle: t({
        en: 'Manage users, settings, and system configuration',
        zh: '管理用户、设置和系统配置',
      }),
    },
    navigation: {
      dashboard: t({
        en: 'Dashboard',
        zh: '仪表板',
      }),
      users: t({
        en: 'Users',
        zh: '用户',
      }),
      roles: t({
        en: 'Roles & Permissions',
        zh: '角色和权限',
      }),
      system: t({
        en: 'System Settings',
        zh: '系统设置',
      }),
      logs: t({
        en: 'Logs',
        zh: '日志',
      }),
      analytics: t({
        en: 'Analytics',
        zh: '分析',
      }),
    },
    dashboard: {
      title: t({
        en: 'Dashboard',
        zh: '仪表板',
      }),
      welcome: t({
        en: 'Welcome, {name}!',
        zh: '欢迎，{name}！',
      }),
      systemAdminDashboard: t({
        en: 'System Administrator Dashboard',
        zh: '系统管理员仪表板',
      }),
      quickActions: t({
        en: 'Quick Actions',
        zh: '快捷操作',
      }),
      manageUsers: t({
        en: 'Manage Users',
        zh: '用户管理',
      }),
      manageUsersDesc: t({
        en: 'View all users, add credits, and manage roles',
        zh: '查看用户、添加额度、管理角色',
      }),
      manageOrganizations: t({
        en: 'Manage Organizations',
        zh: '组织管理',
      }),
      manageOrgsDesc: t({
        en: 'Create organizations and manage members',
        zh: '创建组织并管理成员',
      }),
      systemRole: t({
        en: 'System Role',
        zh: '系统角色',
      }),
      overview: {
        totalUsers: t({
          en: 'Total Users',
          zh: '总用户数',
        }),
        organizations: t({
          en: 'Organizations',
          zh: '组织数',
        }),
        activeUsers: t({
          en: 'Active Users',
          zh: '活跃用户',
        }),
        totalMessages: t({
          en: 'Total Messages',
          zh: '总消息数',
        }),
        revenue: t({
          en: 'Revenue',
          zh: '收入',
        }),
        thisMonth: t({
          en: 'This Month',
          zh: '本月',
        }),
        lastMonth: t({
          en: 'Last Month',
          zh: '上月',
        }),
        growth: t({
          en: 'Growth',
          zh: '增长',
        }),
      },
      recentActivity: {
        title: t({
          en: 'Recent Activity',
          zh: '最近活动',
        }),
        userRegistered: t({
          en: 'User registered',
          zh: '用户注册',
        }),
        subscriptionUpgraded: t({
          en: 'Subscription upgraded',
          zh: '订阅升级',
        }),
        paymentReceived: t({
          en: 'Payment received',
          zh: '收到付款',
        }),
        supportTicket: t({
          en: 'Support ticket created',
          zh: '创建支持工单',
        }),
      },
    },
    users: {
      page: {
        title: t({
          en: 'User Management',
          zh: '用户管理',
        }),
        subtitle: t({
          en: 'Manage all users and their credits',
          zh: '管理所有用户及其额度',
        }),
        manageUserAccounts: t({
          en: 'Manage user accounts and permissions',
          zh: '管理用户账户和权限',
        }),
      },
      table: {
        name: t({
          en: 'Name',
          zh: '姓名',
        }),
        user: t({
          en: 'User',
          zh: '用户',
        }),
        email: t({
          en: 'Email',
          zh: '邮箱',
        }),
        role: t({
          en: 'Role',
          zh: '角色',
        }),
        systemRole: t({
          en: 'System Role',
          zh: '系统角色',
        }),
        creditsBalance: t({
          en: 'Credits Balance',
          zh: '额度余额',
        }),
        subscription: t({
          en: 'Subscription',
          zh: '订阅',
        }),
        status: t({
          en: 'Status',
          zh: '状态',
        }),
        createdAt: t({
          en: 'Joined',
          zh: '加入时间',
        }),
        joined: t({
          en: 'Joined',
          zh: '加入时间',
        }),
        lastActive: t({
          en: 'Last Active',
          zh: '最后活跃',
        }),
        actions: t({
          en: 'Actions',
          zh: '操作',
        }),
      },
      noSubscription: t({
        en: 'No subscription',
        zh: '无订阅',
      }),
      addCredits: t({
        en: 'Add Credits',
        zh: '添加额度',
      }),
      addCreditsToUser: t({
        en: "Add credits to {name}'s account",
        zh: '为 {name} 的账户添加额度',
      }),
      amount: t({
        en: 'Amount',
        zh: '数量',
      }),
      type: t({
        en: 'Type',
        zh: '类型',
      }),
      note: t({
        en: 'Note',
        zh: '备注',
      }),
      selectType: t({
        en: 'Select type',
        zh: '选择类型',
      }),
      reasonForCredits: t({
        en: 'Reason for adding credits',
        zh: '添加额度的原因',
      }),
      purchase: t({
        en: 'Purchase',
        zh: '购买',
      }),
      gift: t({
        en: 'Gift',
        zh: '赠送',
      }),
      compensation: t({
        en: 'Compensation',
        zh: '补偿',
      }),
      updateSystemRole: t({
        en: 'Update System Role',
        zh: '更新系统角色',
      }),
      changeUserRole: t({
        en: "Change {name}'s system role",
        zh: '修改 {name} 的系统角色',
      }),
      adminsWarning: t({
        en: '⚠️ Admins have full access to the system admin panel.',
        zh: '⚠️ 管理员拥有系统管理面板的完整访问权限。',
      }),
      totalUsers: t({
        en: 'Total Users',
        zh: '用户总数',
      }),
      admins: t({
        en: 'Admins',
        zh: '管理员数',
      }),
      totalCredits: t({
        en: 'Total Credits',
        zh: '额度总和',
      }),
      actions: {
        view: t({
          en: 'View',
          zh: '查看',
        }),
        edit: t({
          en: 'Edit',
          zh: '编辑',
        }),
        delete: t({
          en: 'Delete',
          zh: '删除',
        }),
        ban: t({
          en: 'Ban',
          zh: '封禁',
        }),
        unban: t({
          en: 'Unban',
          zh: '解禁',
        }),
        resetPassword: t({
          en: 'Reset Password',
          zh: '重置密码',
        }),
      },
      status: {
        active: t({
          en: 'Active',
          zh: '活跃',
        }),
        inactive: t({
          en: 'Inactive',
          zh: '非活跃',
        }),
        banned: t({
          en: 'Banned',
          zh: '已封禁',
        }),
        pending: t({
          en: 'Pending',
          zh: '待定',
        }),
      },
      roles: {
        admin: t({
          en: 'Admin',
          zh: '管理员',
        }),
        user: t({
          en: 'User',
          zh: '用户',
        }),
        moderator: t({
          en: 'Moderator',
          zh: '版主',
        }),
      },
      search: {
        placeholder: t({
          en: 'Search users...',
          zh: '搜索用户...',
        }),
        filter: t({
          en: 'Filter',
          zh: '筛选',
        }),
      },
    },
    system: {
      page: {
        title: t({
          en: 'System Settings',
          zh: '系统设置',
        }),
        subtitle: t({
          en: 'Configure system-wide settings',
          zh: '配置系统范围的设置',
        }),
      },
      sections: {
        general: {
          title: t({
            en: 'General',
            zh: '常规',
          }),
          siteName: t({
            en: 'Site Name',
            zh: '站点名称',
          }),
          siteUrl: t({
            en: 'Site URL',
            zh: '站点 URL',
          }),
          supportEmail: t({
            en: 'Support Email',
            zh: '支持邮箱',
          }),
        },
        features: {
          title: t({
            en: 'Feature Flags',
            zh: '功能开关',
          }),
          description: t({
            en: 'Enable or disable features',
            zh: '启用或禁用功能',
          }),
        },
        limits: {
          title: t({
            en: 'Usage Limits',
            zh: '使用限制',
          }),
          description: t({
            en: 'Configure default usage limits for plans',
            zh: '配置计划的默认使用限制',
          }),
        },
        integrations: {
          title: t({
            en: 'Integrations',
            zh: '集成',
          }),
          description: t({
            en: 'Configure third-party integrations',
            zh: '配置第三方集成',
          }),
        },
      },
    },
    logs: {
      page: {
        title: t({
          en: 'System Logs',
          zh: '系统日志',
        }),
        subtitle: t({
          en: 'View system activity and errors',
          zh: '查看系统活动和错误',
        }),
      },
      filters: {
        level: t({
          en: 'Log Level',
          zh: '日志级别',
        }),
        dateRange: t({
          en: 'Date Range',
          zh: '日期范围',
        }),
        user: t({
          en: 'User',
          zh: '用户',
        }),
        search: t({
          en: 'Search logs...',
          zh: '搜索日志...',
        }),
      },
      levels: {
        all: t({
          en: 'All',
          zh: '全部',
        }),
        error: t({
          en: 'Error',
          zh: '错误',
        }),
        warning: t({
          en: 'Warning',
          zh: '警告',
        }),
        info: t({
          en: 'Info',
          zh: '信息',
        }),
        debug: t({
          en: 'Debug',
          zh: '调试',
        }),
      },
      export: {
        button: t({
          en: 'Export Logs',
          zh: '导出日志',
        }),
        title: t({
          en: 'Export Logs',
          zh: '导出日志',
        }),
        format: t({
          en: 'Format',
          zh: '格式',
        }),
        json: t({
          en: 'JSON',
          zh: 'JSON',
        }),
        csv: t({
          en: 'CSV',
          zh: 'CSV',
        }),
      },
    },
    organizations: {
      pageTitle: t({
        en: 'Organization Management',
        zh: '组织管理',
      }),
      pageSubtitle: t({
        en: 'Create and manage all organizations',
        zh: '创建并管理所有组织',
      }),
      createOrganization: t({
        en: 'Create Organization',
        zh: '创建组织',
      }),
      createOrgDescription: t({
        en: 'Create a new organization and assign an owner',
        zh: '创建新组织并指定负责人',
      }),
      orgName: t({
        en: 'Organization Name *',
        zh: '组织名称 *',
      }),
      slug: t({
        en: 'Slug *',
        zh: '标识 *',
      }),
      owner: t({
        en: 'Owner *',
        zh: '负责人 *',
      }),
      permissionMode: t({
        en: 'Permission Mode',
        zh: '权限模式',
      }),
      standard: t({
        en: 'Standard',
        zh: '标准',
      }),
      bypass: t({
        en: 'Bypass',
        zh: '绕过',
      }),
      allowBashTool: t({
        en: 'Allow Bash Tool',
        zh: '允许 Bash 工具',
      }),
      yes: t({
        en: 'Yes',
        zh: '是',
      }),
      no: t({
        en: 'No',
        zh: '否',
      }),
      create: t({
        en: 'Create',
        zh: '创建',
      }),
      tableOrganization: t({
        en: 'Organization',
        zh: '组织',
      }),
      tableOwner: t({
        en: 'Owner',
        zh: '负责人',
      }),
      tableMembers: t({
        en: 'Members',
        zh: '成员',
      }),
      tablePermissionMode: t({
        en: 'Permission Mode',
        zh: '权限模式',
      }),
      tableBash: t({
        en: 'Bash',
        zh: 'Bash',
      }),
      tableCreated: t({
        en: 'Created',
        zh: '创建时间',
      }),
      tableActions: t({
        en: 'Actions',
        zh: '操作',
      }),
      noOwner: t({
        en: 'No owner',
        zh: '无负责人',
      }),
      membersCount: t({
        en: '{count} members',
        zh: '{count} 名成员',
      }),
      enabled: t({
        en: 'Enabled',
        zh: '已启用',
      }),
      disabled: t({
        en: 'Disabled',
        zh: '已禁用',
      }),
      organizationDetails: t({
        en: 'Organization Details',
        zh: '组织详情',
      }),
      totalOrganizations: t({
        en: 'Total Organizations',
        zh: '组织总数',
      }),
      totalMembers: t({
        en: 'Total Members',
        zh: '成员总数',
      }),
      placeholderMyOrg: t({
        en: 'My Organization',
        zh: '我的组织',
      }),
      placeholderSlug: t({
        en: 'my-org',
        zh: 'my-org',
      }),
      loadingUsers: t({
        en: 'Loading users...',
        zh: '加载用户中...',
      }),
      selectOwner: t({
        en: 'Select owner',
        zh: '选择负责人',
      }),
    },
    analytics: {
      page: {
        title: t({
          en: 'Analytics',
          zh: '分析',
        }),
        subtitle: t({
          en: 'View usage and performance metrics',
          zh: '查看使用情况和性能指标',
        }),
      },
      metrics: {
        totalUsers: t({
          en: 'Total Users',
          zh: '总用户数',
        }),
        newUsers: t({
          en: 'New Users',
          zh: '新用户',
        }),
        activeUsers: t({
          en: 'Active Users',
          zh: '活跃用户',
        }),
        totalMessages: t({
          en: 'Total Messages',
          zh: '总消息数',
        }),
        averageResponseTime: t({
          en: 'Avg Response Time',
          zh: '平均响应时间',
        }),
        errorRate: t({
          en: 'Error Rate',
          zh: '错误率',
        }),
        revenue: t({
          en: 'Revenue',
          zh: '收入',
        }),
      },
      charts: {
        userGrowth: t({
          en: 'User Growth',
          zh: '用户增长',
        }),
        messageVolume: t({
          en: 'Message Volume',
          zh: '消息量',
        }),
        revenueTrend: t({
          en: 'Revenue Trend',
          zh: '收入趋势',
        }),
      },
    },
    actions: {
      save: t({
        en: 'Save Changes',
        zh: '保存更改',
      }),
      cancel: t({
        en: 'Cancel',
        zh: '取消',
      }),
      delete: t({
        en: 'Delete',
        zh: '删除',
      }),
      confirm: t({
        en: 'Confirm',
        zh: '确认',
      }),
    },
    success: {
      settingsSaved: t({
        en: 'Settings saved successfully',
        zh: '设置保存成功',
      }),
      userDeleted: t({
        en: 'User deleted successfully',
        zh: '用户删除成功',
      }),
      userUpdated: t({
        en: 'User updated successfully',
        zh: '用户更新成功',
      }),
    },
    errors: {
      saveFailed: t({
        en: 'Failed to save settings',
        zh: '设置保存失败',
      }),
      deleteFailed: t({
        en: 'Failed to delete user',
        zh: '用户删除失败',
      }),
      updateFailed: t({
        en: 'Failed to update user',
        zh: '用户更新失败',
      }),
    },
    modals: {
      deleteUser: {
        title: t({
          en: 'Delete User',
          zh: '删除用户',
        }),
        message: t({
          en: 'Are you sure you want to delete this user? This action cannot be undone.',
          zh: '您确定要删除此用户吗？此操作无法撤销。',
        }),
        confirmButton: t({
          en: 'Delete',
          zh: '删除',
        }),
        cancelButton: t({
          en: 'Cancel',
          zh: '取消',
        }),
      },
      banUser: {
        title: t({
          en: 'Ban User',
          zh: '封禁用户',
        }),
        message: t({
          en: 'Are you sure you want to ban this user?',
          zh: '您确定要封禁此用户吗？',
        }),
        reason: t({
          en: 'Reason',
          zh: '原因',
        }),
        confirmButton: t({
          en: 'Ban',
          zh: '封禁',
        }),
        cancelButton: t({
          en: 'Cancel',
          zh: '取消',
        }),
      },
    },
    a2composer: {
      skillSlugPlaceholder: t({
        en: 'Enter skill slug or click to select',
        zh: '输入 skill slug 或点击选择',
      }),
      skillSearchPlaceholder: t({
        en: 'Search by skill slug, name, or description...',
        zh: '搜索技能 slug / 名称 / 描述...',
      }),
    },
  },
  key: 'admin',
} satisfies Dictionary;

export default adminContent;
