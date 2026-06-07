import { createStart } from '@tanstack/react-start';
import { logMiddleware, requestLoggerMiddleware } from '~/utils/loggingMiddleware';

if (import.meta.env.SSR) {
  // Server init (await ensures module executes before request handling)
  await import('~/lib/observability/sentry.server')
  
  // Run database migrations on server startup (if auto-migration is enabled)
  try {
    const { autoMigrate } = await import('~/db/migrate');
    await autoMigrate();
  } catch (error) {
    // Log error but don't block startup in production (migrations should be run separately)
    console.error('[Startup] Failed to run auto-migrations:', error);
    if (process.env.NODE_ENV !== 'production') {
      // In development, fail fast if migrations fail
      throw error;
    }
  }

  // Seed the multi-model registry from OXY_MODELS_SEED (or the legacy ANTHROPIC_*
  // fallback) into the DB. Idempotent (onConflictDoNothing) — admin edits win.
  // Best-effort: never block startup if seeding fails.
  try {
    const { seedModelsFromEnv } = await import('~/server/models/registry');
    await seedModelsFromEnv();
  } catch (error) {
    console.error('[Startup] Model registry seed failed (non-fatal):', error);
  }
} else {
  // Client init (captures console + network)
  await import('~/lib/observability/sentry.client')
  await import('~/lib/observability/posthog.client')
}

export const startInstance = createStart(() => ({
  // Runs for ALL server requests (SSR, routes, serverFns). Logs method/url/duration and captures errors.
  requestMiddleware: [requestLoggerMiddleware],
  // Runs around ALL server functions. Maintains your client↔server timing logs + adds breadcrumbs.
  functionMiddleware: [logMiddleware],
}))

export const start = startInstance;
