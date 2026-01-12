import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { reactStartCookies } from 'better-auth/react-start';
import { magicLink } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins';
import { Polar } from '@polar-sh/sdk';
import { polar, checkout, portal, webhooks } from '@polar-sh/better-auth';
import { sql, eq } from 'drizzle-orm';

import { db } from '~/db/db-config';
import { sendEmail } from './email';
import { polarEnv } from '~/conf/polar';
import { polarWebhookHandlers } from '~/server/polar-webhooks';

const isProd = process.env.NODE_ENV === 'production';
const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? 'ex0_session';

const isEmailVerificationEnabled = process.env.ENABLE_EMAIL_VERIFICATION === 'true';

// Polar is optional - only initialize if access token is configured
const isPolarEnabled = Boolean(polarEnv.POLAR_ACCESS_TOKEN);

const polarClient = isPolarEnabled
  ? new Polar({
      accessToken: polarEnv.POLAR_ACCESS_TOKEN,
      server: polarEnv.POLAR_SERVER,
    })
  : null;

const checkoutProducts = isPolarEnabled
  ? ([
      polarEnv.POLAR_PRODUCT_PRO_MONTHLY
        ? { productId: polarEnv.POLAR_PRODUCT_PRO_MONTHLY, slug: 'pro' as const }
        : null,
      polarEnv.POLAR_PRODUCT_BUSINESS_MONTHLY
        ? { productId: polarEnv.POLAR_PRODUCT_BUSINESS_MONTHLY, slug: 'business' as const }
        : null,
      polarEnv.POLAR_PRODUCT_CREDITS_50
        ? { productId: polarEnv.POLAR_PRODUCT_CREDITS_50, slug: 'credits-50' as const }
        : null,
      polarEnv.POLAR_PRODUCT_CREDITS_100
        ? { productId: polarEnv.POLAR_PRODUCT_CREDITS_100, slug: 'credits-100' as const }
        : null,
    ].filter(Boolean) as Array<{ productId: string; slug: string }>)
  : [];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  user: {
    deleteUser: {
      enabled: true,
      afterDelete: async (deletedUser) => {
        // Only try to delete Polar customer if Polar is enabled
        if (!polarClient) return;
        try {
          await polarClient.customers.deleteExternal({ externalId: deletedUser.id });
        } catch (error: any) {
          if (error?.error !== 'ResourceNotFound') {
            console.error('[polar] failed to delete external customer', error);
          }
        }
      },
    },
    // Add hook to set first user as system admin
    onCreate: async (user) => {
      try {
        // Check if this is the first user in the system
        const { user: userTable } = await import('~/db/schema');
        const users = await db.select({ count: sql<number>`count(*)::int` })
          .from(userTable);

        const userCount = users[0]?.count || 0;

        // If this is the first user (count is 1 because the user was just created),
        // set them as system admin
        if (userCount === 1) {
          await db.update(userTable)
            .set({ systemRole: 'admin' })
            .where(eq(userTable.id, user.id));
          console.log('[auth] First user registered, set as system admin:', user.email);
        }
      } catch (error) {
        console.error('[auth] Failed to set first user as admin:', error);
        // Don't throw - let registration succeed
      }
    },
  },
    useSecureCookies: isProd,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
    },
    cookies: {
      session_token: {
        name: sessionCookieName,
      },
      session_data: {
        attributes: {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProd,
          path: '/',
        },
      },
    },
    // Allow cross-origin requests from development ports
    trustedOrigins: isProd
      ? []  // In production, configure your actual domains
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5050'],
  },
  user: {
    deleteUser: {
      enabled: true,
      afterDelete: async (deletedUser) => {
        // Only try to delete Polar customer if Polar is enabled
        if (!polarClient) return;
        try {
          await polarClient.customers.deleteExternal({ externalId: deletedUser.id });
        } catch (error: any) {
          if (error?.error !== 'ResourceNotFound') {
            console.error('[polar] failed to delete external customer', error);
          }
        }
      },
    },
  },
  plugins: [
    reactStartCookies(),
    magicLink({
      async sendMagicLink({ email, url }) {
        await sendEmail({
          to: email,
          subject: 'Sign in to Constructa',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Sign in to Constructa</h2>
              <p>Click the button below to sign in. This link will expire in 5 minutes.</p>
              <a href="${url}" style="display:inline-block;padding:12px 24px;background-color:#4F46E5;color:white;text-decoration:none;border-radius:6px;">Sign In</a>
              <p style="margin-top:20px;color:#666;">If the button above does not work, copy and paste the following link into your browser:</p>
              <p style="word-break:break-all;color:#666;">${url}</p>
              <p style="margin-top:30px;color:#999;font-size:14px;">If you did not request this email, you can safely ignore it.</p>
            </div>
          `,
        });
      },
    }),
    // Organization plugin for multi-tenant permissions
    organization({
      // Allow any user to create an organization (can be restricted later)
      allowUserToCreateOrganization: true,
      // Role of the organization creator
      creatorRole: 'owner',
      // Maximum members per organization (100 by default)
      membershipLimit: 100,
    }),
    // Only include Polar plugin if Polar is configured
    ...(isPolarEnabled && polarClient
      ? [
          polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            use: [
              checkout({
                products: checkoutProducts,
                successUrl: polarEnv.CHECKOUT_SUCCESS_URL,
                authenticatedUsersOnly: true,
              }),
              portal(),
              webhooks({
                secret: polarEnv.POLAR_WEBHOOK_SECRET,
                ...polarWebhookHandlers,
              }),
            ],
          }),
        ]
      : []),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isEmailVerificationEnabled,
    sendResetPassword: async ({ user, url }) => {
      try {
        await sendEmail({
          to: user.email,
          subject: 'Reset your password',
          html: `
						<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
							<h2>Reset Your Password</h2>
							<p>You requested to reset your password. Click the button below to continue:</p>
							<a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 6px;">Reset Password</a>
							<p style="margin-top: 20px; color: #666;">Or copy and paste this link into your browser:</p>
							<p style="word-break: break-all; color: #666;">${url}</p>
							<p style="margin-top: 30px; color: #999; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
						</div>
					`,
        });
      } catch (error) {
        console.error('Failed to send password reset email:', error);
        throw error; // We want password reset failures to propagate
      }
    },
  },
  emailVerification: {
    // Only send verification emails if verification is enabled
    sendOnSignUp: isEmailVerificationEnabled,
    autoSignInAfterVerification: true,
    sendVerificationEmail: isEmailVerificationEnabled
      ? async ({ user, url }) => {
          try {
            await sendEmail({
              to: user.email as string,
              subject: 'Verify your email address',
              html: `
						<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
							<h2>Verify your email address</h2>
							<p>Please click the button below to verify your email address:</p>
							<a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 6px;">Verify Email</a>
							<p style="margin-top: 20px; color: #666;">Or copy and paste this link into your browser:</p>
							<p style="word-break: break-all; color: #666;">${url}</p>
							<p style="margin-top: 30px; color: #999; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
						</div>
					`,
            });
          } catch (error) {
            console.error('Failed to send verification email:', error);
            // Don't throw here to prevent sign-up from failing
          }
        }
      : undefined,
  },
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    }),
  },
  // 2️⃣  Enable in-memory rate limiting for integration tests and local dev
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 300, // relax to tolerate webhook bursts while keeping baseline protection
  },
});

export default auth;
