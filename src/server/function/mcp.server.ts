/**
 * MCP Server Functions
 *
 * Server functions for MCP management using TanStack Start.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import path from 'node:path';
import { promises as fs, constants as fsConstants } from 'node:fs';
import { auth } from '~/server/auth.server';
import {
  getMcpStore,
  getUserEnabledMcpServers,
  enableMcpServer,
  disableMcpServer,
  getMcpDetail,
  normalizeMcpName,
  getUserClaudeHome,
} from '~/claude/mcp';
import { runPython } from '~/claude/python/runner.js';

const requireUser = async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }

  return session.user;
};

const toggleSchema = z.object({
  slug: z.string().min(1),
});

const detailSchema = z.object({
  slug: z.string().min(1),
});

/**
 * List all MCP servers from the store
 */
export const listMcpStore = createServerFn({ method: 'GET' }).handler(async () => {
  return await getMcpStore();
});

/**
 * List enabled MCP servers for the current user
 */
export const listUserMcps = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const enabled = await getUserEnabledMcpServers(user.id);
  const store = await getMcpStore();
  return store.filter((entry) => enabled.includes(entry.slug));
});

/**
 * Enable MCP server
 */
export const enableMcpServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return toggleSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await enableMcpServer(user.id, data.slug);
    return { success: true };
  });

/**
 * Disable MCP server
 */
export const disableMcpServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return toggleSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await disableMcpServer(user.id, data.slug);
    return { success: true };
  });

/**
 * Get MCP detail (files + metadata)
 */
export const getMcpDetailFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const slug = searchParams?.get('slug')
      || (typeof input === 'object' && input && 'slug' in input ? (input as { slug?: string }).slug : null);
    return detailSchema.parse({ slug });
  })
  .handler(async ({ data }) => {
    return await getMcpDetail(data.slug);
  });

/**
 * Verify MCP server runtime (Python only for now)
 */
export const verifyMcpServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return toggleSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const slug = normalizeMcpName(data.slug);
    const store = await getMcpStore();
    const entry = store.find((item) => item.slug === slug);

    if (!entry) {
      return {
        ok: false,
        message: `MCP not found: ${slug}.`,
      };
    }

    if (!entry.mcp) {
      return {
        ok: false,
        message: `MCP configuration missing for ${slug}.`,
      };
    }

    const mcpConfig = entry.mcp;

    if (mcpConfig.type === 'sdk') {
      const isPython = slug === 'python' || mcpConfig.name === 'python';
      if (!isPython) {
        return {
          ok: true,
          message: 'SDK MCP configuration detected. Runtime verification not configured for this MCP.',
        };
      }

      const userHome = getUserClaudeHome(user.id);
      const cwd = path.join(userHome, 'mcp-verify');

      const code = `import importlib, json\n\nlibs = [\n  'numpy', 'pandas', 'matplotlib', 'PIL', 'yaml',\n  'scipy', 'seaborn', 'bs4', 'lxml'\n]\n\nresults = {}\nfor name in libs:\n  try:\n    module = importlib.import_module(name)\n    version = getattr(module, '__version__', None)\n    results[name] = {'ok': True, 'version': version}\n  except Exception as e:\n    results[name] = {'ok': False, 'error': str(e)}\n\nprint(json.dumps(results))\n`;

      const result = await runPython({ code, cwd, timeoutMs: 10_000, maxOutputBytes: 256_000 });

      let parsed = null;
      try {
        parsed = JSON.parse(result.stdout.trim());
      } catch {
        parsed = null;
      }

      const allOk = parsed
        ? Object.values(parsed).every((entry) => entry && entry.ok === true)
        : false;

      return {
        ok: !result.timedOut && !result.killedByLimit && result.exitCode === 0 && allOk,
        details: parsed,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
      };
    }

    if (mcpConfig.type === 'stdio') {
      const resolvedPath = await resolveCommandPath(mcpConfig.command);
      if (!resolvedPath) {
        return {
          ok: false,
          message: `Command not found on PATH: ${mcpConfig.command}`,
        };
      }
      return {
        ok: true,
        message: `Command resolved: ${resolvedPath}`,
      };
    }

    if (mcpConfig.type === 'http' || mcpConfig.type === 'sse') {
      if (!mcpConfig.url) {
        return {
          ok: false,
          message: `Missing URL for ${slug}.`,
        };
      }

      const result = await checkRemoteEndpoint(mcpConfig.url, mcpConfig.headers);
      return {
        ok: result.ok,
        message: result.message,
        status: result.status,
      };
    }

    return {
      ok: false,
      message: `Unsupported MCP type for verification: ${mcpConfig.type}`,
    };
  });

async function resolveCommandPath(command: string): Promise<string | null> {
  if (!command || typeof command !== 'string') {
    return null;
  }

  if (path.isAbsolute(command)) {
    try {
      await fs.access(command, fsConstants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function checkRemoteEndpoint(url: string, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: controller.signal,
    });
    response.body?.cancel();

    if (response.ok) {
      return { ok: true, status: response.status, message: `HTTP ${response.status}` };
    }
    return {
      ok: false,
      status: response.status,
      message: `HTTP ${response.status}`,
    };
  } catch {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      response.body?.cancel();

      if (response.ok) {
        return { ok: true, status: response.status, message: `HTTP ${response.status}` };
      }
      return {
        ok: false,
        status: response.status,
        message: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        message: error instanceof Error ? error.message : 'Request failed',
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * List all MCP servers (official + user)
 */
export const listAllMcpsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireUser();
    const store = await getMcpStore();
    const enabled = await getUserEnabledMcpServers(user.id);

    const official = store.map((entry) => ({
      ...entry,
      store: 'official' as const,
      enabled: enabled.includes(entry.slug),
    }));

    return {
      official,
      user: [],
    };
  });
