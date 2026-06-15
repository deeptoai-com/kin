/**
 * Health Check API
 *
 * GET /api/health - Check system health status
 *
 * Returns health status for various system components:
 * - Database connectivity
 * - Sessions volume writability
 */

import { createFileRoute } from '@tanstack/react-router';
import { access, constants } from 'node:fs/promises';

interface HealthCheck {
  status: 'ok' | 'error';
  message?: string;
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  /** Current running version — git SHA baked into the image at build time (FR1).
   * Used by the online auto-update flow to detect/poll the running version. */
  version: string;
  checks: {
    sessionsVolume: HealthCheck;
  };
}

async function checkSessionsVolume(): Promise<HealthCheck> {
  try {
    const root = process.env.CLAUDE_SESSIONS_ROOT || '/data/users';
    await access(root, constants.W_OK);
    return { status: 'ok' };
  } catch (error) {
    return {
      status: 'error',
      message: `Sessions volume not writable: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const checks = {
          sessionsVolume: await checkSessionsVolume(),
        };

        const isHealthy = Object.values(checks).every((c) => c.status === 'ok');

        const healthStatus: HealthStatus = {
          status: isHealthy ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          version: process.env.BUILD_SHA ?? 'dev',
          checks,
        };

        return new Response(JSON.stringify(healthStatus), {
          status: isHealthy ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  },
});
