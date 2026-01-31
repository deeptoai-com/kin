import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * Billing and payment page content dictionary
 * Contains labels and messages for subscription management and payment processing
 */
const billingContent = {
  content: {
    page: {
      title: t({
        en: 'Billing',
        zh: '计费',
      }),
      subtitle: t({
        en: 'Manage your subscription and payment methods',
        zh: '管理您的订阅和付款方式',
      }),
    },
    credits: {
      label: t({ en: 'Credits', zh: '积分' }),
      refillsDaily: t({
        en: 'Refills daily while below monthly cap.',
        zh: '低于月度上限时每日补充。',
      }),
    },
    currentPlanBadge: t({ en: 'Current plan', zh: '当前计划' }),
    currentPlan: {
      title: t({
        en: 'Current Plan',
        zh: '当前计划',
      }),
      planName: t({
        en: 'Plan Name',
        zh: '计划名称',
      }),
      status: t({
        en: 'Status',
        zh: '状态',
      }),
      active: t({
        en: 'Active',
        zh: '活跃',
      }),
      canceled: t({
        en: 'Canceled',
        zh: '已取消',
      }),
      pastDue: t({
        en: 'Past Due',
        zh: '逾期',
      }),
      trial: t({
        en: 'Trial',
        zh: '试用',
      }),
      renewsOn: t({
        en: 'Renews on',
        zh: '续费日期',
      }),
      expiresOn: t({
        en: 'Expires on',
        zh: '到期日期',
      }),
      usage: {
        title: t({
          en: 'Usage This Month',
          zh: '本月使用量',
        }),
        messages: t({
          en: 'Messages',
          zh: '消息',
        }),
        of: t({
          en: 'of',
          zh: '/',
        }),
        resetOn: t({
          en: 'Resets on',
          zh: '重置日期',
        }),
      },
    },
    plans: {
      title: t({
        en: 'Available Plans',
        zh: '可用计划',
      }),
      subtitle: t({
        en: 'Upgrade or downgrade your subscription',
        zh: '升级或降级您的订阅',
      }),
      current: t({
        en: 'Current Plan',
        zh: '当前计划',
      }),
      upgrade: t({
        en: 'Upgrade',
        zh: '升级',
      }),
      downgrade: t({
        en: 'Downgrade',
        zh: '降级',
      }),
      mostPopular: t({
        en: 'Most Popular',
        zh: '最受欢迎',
      }),
    },
    paymentMethods: {
      title: t({
        en: 'Payment Methods',
        zh: '付款方式',
      }),
      addNew: t({
        en: 'Add Payment Method',
        zh: '添加付款方式',
      }),
      default: t({
        en: 'Default',
        zh: '默认',
      }),
      cardEndingIn: t({
        en: 'Card ending in',
        zh: '卡号末四位',
      }),
      expires: t({
        en: 'Expires',
        zh: '到期',
      }),
      setAsDefault: t({
        en: 'Set as Default',
        zh: '设为默认',
      }),
      remove: t({
        en: 'Remove',
        zh: '移除',
      }),
    },
    billingHistory: {
      title: t({
        en: 'Billing History',
        zh: '账单历史',
      }),
      invoice: t({
        en: 'Invoice',
        zh: '发票',
      }),
      date: t({
        en: 'Date',
        zh: '日期',
      }),
      amount: t({
        en: 'Amount',
        zh: '金额',
      }),
      status: t({
        en: 'Status',
        zh: '状态',
      }),
      paid: t({
        en: 'Paid',
        zh: '已支付',
      }),
      pending: t({
        en: 'Pending',
        zh: '待处理',
      }),
      failed: t({
        en: 'Failed',
        zh: '失败',
      }),
      download: t({
        en: 'Download',
        zh: '下载',
      }),
    },
    invoices: {
      title: t({
        en: 'Invoices',
        zh: '发票',
      }),
      noInvoices: t({
        en: 'No invoices yet',
        zh: '暂无发票',
      }),
      downloadPdf: t({
        en: 'Download PDF',
        zh: '下载 PDF',
      }),
    },
    manageSubscription: {
      title: t({
        en: 'Manage Subscription',
        zh: '管理订阅',
      }),
      cancelSubscription: t({
        en: 'Cancel Subscription',
        zh: '取消订阅',
      }),
      reactivateSubscription: t({
        en: 'Reactivate Subscription',
        zh: '重新激活订阅',
      }),
    },
    cancelFlow: {
      title: t({
        en: 'Cancel Subscription',
        zh: '取消订阅',
      }),
      subtitle: t({
        en: 'We are sorry to see you go',
        zh: '很遗憾您要离开',
      }),
      reason: {
        title: t({
          en: 'Reason for cancellation',
          zh: '取消原因',
        }),
        required: t({
          en: 'Please select a reason',
          zh: '请选择原因',
        }),
        tooExpensive: t({
          en: 'Too expensive',
          zh: '太贵了',
        }),
        notNeeded: t({
          en: 'No longer needed',
          zh: '不再需要',
        }),
        missingFeatures: t({
          en: 'Missing features',
          zh: '缺少功能',
        }),
        foundAlternative: t({
          en: 'Found an alternative',
          zh: '找到了替代方案',
        }),
        technicalIssues: t({
          en: 'Technical issues',
          zh: '技术问题',
        }),
        other: t({
          en: 'Other',
          zh: '其他',
        }),
      },
      feedback: {
        title: t({
          en: 'Additional feedback (optional)',
          zh: '额外反馈（可选）',
        }),
        placeholder: t({
          en: 'Tell us how we can improve',
          zh: '告诉我们如何改进',
        }),
      },
      offer: {
        title: t({
          en: 'Wait! Before you go...',
          zh: '等等！在您离开之前...',
        }),
        description: t({
          en: 'Get 50% off your next 3 months',
          zh: '享受接下来 3 个月 5 折优惠',
        }),
        acceptOffer: t({
          en: 'Keep my subscription',
          zh: '保留我的订阅',
        }),
        confirmCancel: t({
          en: 'Yes, cancel my subscription',
          zh: '是的，取消我的订阅',
        }),
      },
    },
    success: {
      paymentAdded: t({
        en: 'Payment method added successfully',
        zh: '付款方式添加成功',
      }),
      paymentRemoved: t({
        en: 'Payment method removed successfully',
        zh: '付款方式移除成功',
      }),
      subscriptionUpdated: t({
        en: 'Subscription updated successfully',
        zh: '订阅更新成功',
      }),
      subscriptionCanceled: t({
        en: 'Subscription canceled successfully',
        zh: '订阅取消成功',
      }),
      subscriptionReactivated: t({
        en: 'Subscription reactivated successfully',
        zh: '订阅重新激活成功',
      }),
    },
    errors: {
      paymentFailed: t({
        en: 'Payment failed. Please try again.',
        zh: '付款失败。请重试。',
      }),
      updateFailed: t({
        en: 'Failed to update subscription. Please contact support.',
        zh: '订阅更新失败。请联系客服。',
      }),
      cancelFailed: t({
        en: 'Failed to cancel subscription. Please contact support.',
        zh: '取消订阅失败。请联系客服。',
      }),
    },
    modals: {
      addPaymentMethod: {
        title: t({
          en: 'Add Payment Method',
          zh: '添加付款方式',
        }),
        cardDetails: t({
          en: 'Card Details',
          zh: '卡详情',
        }),
        cardholderName: t({
          en: 'Cardholder Name',
          zh: '持卡人姓名',
        }),
        cardNumber: t({
          en: 'Card Number',
          zh: '卡号',
        }),
        expiryDate: t({
          en: 'Expiry Date',
          zh: '到期日期',
        }),
        cvv: t({
          en: 'CVV',
          zh: 'CVV',
        }),
        saveButton: t({
          en: 'Add Card',
          zh: '添加卡',
        }),
      },
    },
  },
  key: 'billing',
} satisfies Dictionary;

export default billingContent;
