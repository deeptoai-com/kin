import type { Dictionary } from 'intlayer';
import { t } from 'intlayer';

/**
 * Authentication-related content dictionary
 * Contains labels and messages for login, signup, and password recovery
 */
const authContent = {
  content: {
    signIn: {
      title: t({
        en: 'Sign In',
        zh: '登录',
      }),
      subtitle: t({
        en: 'Enter your credentials to access your account',
        zh: '输入您的凭证以访问您的账户',
      }),
      emailLabel: t({
        en: 'Email',
        zh: '邮箱',
      }),
      emailPlaceholder: t({
        en: 'Enter your email',
        zh: '请输入邮箱',
      }),
      passwordLabel: t({
        en: 'Password',
        zh: '密码',
      }),
      passwordPlaceholder: t({
        en: 'Enter your password',
        zh: '请输入密码',
      }),
      rememberMe: t({
        en: 'Remember me',
        zh: '记住我',
      }),
      forgotPassword: t({
        en: 'Forgot password?',
        zh: '忘记密码？',
      }),
      noAccount: t({
        en: "Don't have an account?",
        zh: '没有账户？',
      }),
      signUpLink: t({
        en: 'Sign up',
        zh: '注册',
      }),
      submitButton: t({
        en: 'Sign In',
        zh: '登录',
      }),
      orContinueWith: t({
        en: 'Or continue with',
        zh: '或使用以下方式继续',
      }),
    },
    signUp: {
      title: t({
        en: 'Sign Up',
        zh: '注册',
      }),
      subtitle: t({
        en: 'Create a new account to get started',
        zh: '创建新账户以开始使用',
      }),
      nameLabel: t({
        en: 'Name',
        zh: '姓名',
      }),
      namePlaceholder: t({
        en: 'Enter your name',
        zh: '请输入姓名',
      }),
      emailLabel: t({
        en: 'Email',
        zh: '邮箱',
      }),
      emailPlaceholder: t({
        en: 'Enter your email',
        zh: '请输入邮箱',
      }),
      passwordLabel: t({
        en: 'Password',
        zh: '密码',
      }),
      passwordPlaceholder: t({
        en: 'Create a password',
        zh: '创建密码',
      }),
      confirmPasswordLabel: t({
        en: 'Confirm Password',
        zh: '确认密码',
      }),
      confirmPasswordPlaceholder: t({
        en: 'Confirm your password',
        zh: '确认您的密码',
      }),
      agreeToTerms: t({
        en: 'I agree to the',
        zh: '我同意',
      }),
      termsOfService: t({
        en: 'Terms of Service',
        zh: '服务条款',
      }),
      and: t({
        en: 'and',
        zh: '和',
      }),
      privacyPolicy: t({
        en: 'Privacy Policy',
        zh: '隐私政策',
      }),
      hasAccount: t({
        en: 'Already have an account?',
        zh: '已有账户？',
      }),
      signInLink: t({
        en: 'Sign in',
        zh: '登录',
      }),
      submitButton: t({
        en: 'Create Account',
        zh: '创建账户',
      }),
    },
    forgotPassword: {
      title: t({
        en: 'Forgot Password',
        zh: '忘记密码',
      }),
      subtitle: t({
        en: 'Enter your email to receive a password reset link',
        zh: '输入您的邮箱以接收密码重置链接',
      }),
      emailLabel: t({
        en: 'Email',
        zh: '邮箱',
      }),
      emailPlaceholder: t({
        en: 'Enter your email',
        zh: '请输入邮箱',
      }),
      submitButton: t({
        en: 'Send Reset Link',
        zh: '发送重置链接',
      }),
      backToSignIn: t({
        en: 'Back to Sign In',
        zh: '返回登录',
      }),
    },
    resetPassword: {
      title: t({
        en: 'Reset Password',
        zh: '重置密码',
      }),
      subtitle: t({
        en: 'Enter your new password below',
        zh: '在下方输入您的新密码',
      }),
      newPasswordLabel: t({
        en: 'New Password',
        zh: '新密码',
      }),
      newPasswordPlaceholder: t({
        en: 'Enter new password',
        zh: '输入新密码',
      }),
      confirmPasswordLabel: t({
        en: 'Confirm Password',
        zh: '确认密码',
      }),
      confirmPasswordPlaceholder: t({
        en: 'Confirm new password',
        zh: '确认新密码',
      }),
      submitButton: t({
        en: 'Reset Password',
        zh: '重置密码',
      }),
    },
    verification: {
      title: t({
        en: 'Verify Your Email',
        zh: '验证您的邮箱',
      }),
      subtitle: t({
        en: 'We sent a verification code to your email',
        zh: '我们向您的邮箱发送了验证码',
      }),
      codeLabel: t({
        en: 'Verification Code',
        zh: '验证码',
      }),
      codePlaceholder: t({
        en: 'Enter 6-digit code',
        zh: '输入 6 位验证码',
      }),
      resendCode: t({
        en: "Didn't receive the code? Resend",
        zh: '没有收到验证码？重新发送',
      }),
      submitButton: t({
        en: 'Verify',
        zh: '验证',
      }),
    },
    errors: {
      invalidCredentials: t({
        en: 'Invalid email or password',
        zh: '邮箱或密码无效',
      }),
      emailAlreadyExists: t({
        en: 'An account with this email already exists',
        zh: '此邮箱的账户已存在',
      }),
      weakPassword: t({
        en: 'Password is too weak. Please use a stronger password.',
        zh: '密码太弱。请使用更强的密码。',
      }),
      passwordsDoNotMatch: t({
        en: 'Passwords do not match',
        zh: '密码不匹配',
      }),
      invalidVerificationCode: t({
        en: 'Invalid verification code',
        zh: '验证码无效',
      }),
      expiredCode: t({
        en: 'Verification code has expired. Please request a new one.',
        zh: '验证码已过期。请请求新的验证码。',
      }),
    },
    success: {
      passwordResetSent: t({
        en: 'Password reset link has been sent to your email',
        zh: '密码重置链接已发送到您的邮箱',
      }),
      passwordResetSuccess: t({
        en: 'Password has been reset successfully',
        zh: '密码已成功重置',
      }),
      accountCreated: t({
        en: 'Account created successfully',
        zh: '账户创建成功',
      }),
      emailVerified: t({
        en: 'Email verified successfully',
        zh: '邮箱验证成功',
      }),
    },
    emailVerificationBanner: {
      title: t({
        en: 'Verify your email address',
        zh: '请验证您的邮箱',
      }),
      message: t({
        en: 'We sent a verification link to {email}. You need to verify your email before you can access all features.',
        zh: '我们已向 {email} 发送验证链接。请先验证邮箱以使用全部功能。',
      }),
      sentMessage: t({
        en: 'Verification email sent. Check your inbox for the latest link.',
        zh: '验证邮件已发送，请查收收件箱中的最新链接。',
      }),
      close: t({
        en: 'Close',
        zh: '关闭',
      }),
    },
  },
  key: 'auth',
} satisfies Dictionary;

export default authContent;
