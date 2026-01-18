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
  getMcpCredentials,
  setMcpCredentials,
  getMcpAllowedToolsOverride,
  setMcpAllowedToolsOverride,
  // Custom MCP management (personal)
  getUserCustomMcps,
  saveCustomMcp,
  deleteCustomMcp,
  customMcpExists,
  getCustomMcpDetail,
  parseMcpConfigFromContent,
  // System MCP management (global)
  getSystemMcps,
  saveSystemMcp,
  deleteSystemMcp,
  systemMcpExists,
} from '~/claude/mcp';
import type { AddCustomMcpInput, McpConfig } from '~/claude/mcp';
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
 * List all MCP servers (official + system + user custom)
 * Returns three categories with store labels for UI differentiation
 */
export const listAllMcpsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireUser();
    const store = await getMcpStore();
    const systemMcps = await getSystemMcps();
    const customMcps = await getUserCustomMcps(user.id);
    const enabled = await getUserEnabledMcpServers(user.id);

    const official = store.map((entry) => ({
      ...entry,
      store: 'official' as const,
      enabled: enabled.includes(entry.slug),
    }));

    const system = systemMcps.map((entry) => ({
      ...entry,
      store: 'system' as const,
      enabled: enabled.includes(entry.slug),
    }));

    const userMcps = customMcps.map((entry) => ({
      ...entry,
      store: 'user' as const,
      enabled: enabled.includes(entry.slug),
    }));

    return {
      official,
      system,
      user: userMcps,
    };
  });

// ============================================================================
// Custom MCP Management
// ============================================================================

const addCustomMcpSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Slug can only contain letters, numbers, hyphens and underscores'),
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional().nullable(),
  category: z.string().max(32).optional(),
  scope: z.enum(['system', 'personal']).default('personal'),
  mcp: z.object({
    type: z.enum(['stdio', 'http', 'sse']),
    name: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
  }),
  allowedTools: z.array(z.string()).optional().nullable(),
  credentials: z.array(z.object({
    key: z.string(),
    label: z.string(),
    description: z.string().optional().nullable(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
  })).optional().nullable(),
});

/**
 * Add a custom MCP server
 * @param scope - 'system' for global MCP (visible to all users), 'personal' for user-only MCP
 */
export const addCustomMcpFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return addCustomMcpSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const slug = normalizeMcpName(data.slug);
    const scope = data.scope || 'personal';

    // Check if slug conflicts with official store
    const store = await getMcpStore();
    if (store.find((entry) => entry.slug === slug)) {
      return {
        ok: false,
        error: `Slug "${slug}" conflicts with an official MCP. Please choose a different name.`,
      };
    }

    // Check if already exists in system MCPs
    if (await systemMcpExists(slug)) {
      return {
        ok: false,
        error: `Slug "${slug}" already exists as a system MCP.`,
      };
    }

    // For personal scope, also check user's custom MCPs
    if (scope === 'personal' && await customMcpExists(user.id, slug)) {
      return {
        ok: false,
        error: `Custom MCP "${slug}" already exists. Delete it first or choose a different slug.`,
      };
    }

    // Prepare MCP data
    const mcpData: AddCustomMcpInput = {
      slug,
      name: data.name,
      description: data.description,
      category: data.category || 'general',
      mcp: data.mcp as McpConfig,
      allowedTools: data.allowedTools,
      credentials: data.credentials?.map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description ?? null,
        required: c.required ?? false,
        sensitive: c.sensitive ?? true,
      })),
    };

    // Save based on scope
    if (scope === 'system') {
      const result = await saveSystemMcp(mcpData);
      return { ok: true, slug: result.slug, scope: 'system' };
    } else {
      const result = await saveCustomMcp(user.id, mcpData);
      return { ok: true, slug: result.slug, scope: 'personal' };
    }
  });

const deleteCustomMcpSchema = z.object({
  slug: z.string().min(1),
  scope: z.enum(['system', 'personal']).optional(),
});

/**
 * Delete a custom MCP server
 * @param scope - 'system' requires admin role, 'personal' only allows owner to delete
 */
export const deleteCustomMcpFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return deleteCustomMcpSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const slug = normalizeMcpName(data.slug);
    const scope = data.scope;

    // Ensure it's not an official MCP
    const store = await getMcpStore();
    if (store.find((entry) => entry.slug === slug)) {
      return {
        ok: false,
        error: `Cannot delete official MCP "${slug}".`,
      };
    }

    // Determine scope if not provided
    let targetScope = scope;
    if (!targetScope) {
      // Auto-detect scope
      if (await systemMcpExists(slug)) {
        targetScope = 'system';
      } else if (await customMcpExists(user.id, slug)) {
        targetScope = 'personal';
      } else {
        return {
          ok: false,
          error: `MCP "${slug}" not found.`,
        };
      }
    }

    // Handle system MCP deletion - requires admin
    if (targetScope === 'system') {
      // Check if user is admin
      const isAdmin = user.role === 'admin';
      if (!isAdmin) {
        return {
          ok: false,
          error: `Only administrators can delete system MCPs.`,
        };
      }
      await deleteSystemMcp(slug);
      return { ok: true, slug, scope: 'system' };
    }

    // Handle personal MCP deletion
    await deleteCustomMcp(user.id, slug);
    return { ok: true, slug, scope: 'personal' };
  });

/**
 * Get custom MCP detail
 */
export const getCustomMcpDetailFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const slug = searchParams?.get('slug')
      || (typeof input === 'object' && input && 'slug' in input ? (input as { slug?: string }).slug : null);
    return detailSchema.parse({ slug });
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    return await getCustomMcpDetail(user.id, data.slug);
  });

/**
 * Parse MCP config from raw content (YAML/JSON)
 */
export const parseMcpConfigFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({ content: z.string() }).parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();
    return parseMcpConfigFromContent(data.content);
  });

/**
 * Fetch MCP config from URL
 */
export const fetchMcpFromUrlFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({ url: z.string().url() }).parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(data.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Claude-Agent-Chat/1.0' },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }

      const content = await response.text();
      const parsed = parseMcpConfigFromContent(content);

      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }

      return { ok: true, data: parsed.data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to fetch URL',
      };
    }
  });

/**
 * Parse npm package info for MCP auto-detection
 */
export const parseNpmPackageFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return z.object({ packageName: z.string().min(1) }).parse(data);
  })
  .handler(async ({ data }) => {
    await requireUser();

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run npm view to get package info
      const { stdout } = await execAsync(
        `npm view "${data.packageName}" name version description bin keywords --json`,
        { timeout: 15000 }
      );

      const info = JSON.parse(stdout);

      // Generate suggested MCP config
      const suggestedConfig = {
        slug: info.name.replace(/^@/, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9-_]/g, '_'),
        name: info.name,
        description: info.description || null,
        mcp: {
          type: 'stdio' as const,
          name: info.name.replace(/^@/, '').replace(/\//g, '-'),
          command: 'npx',
          args: ['-y', info.name],
        },
      };

      return {
        ok: true,
        packageInfo: info,
        suggestedConfig,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to fetch npm package info',
      };
    }
  });

// ============================================================================
// Credentials Management
// ============================================================================

const credentialsSchema = z.object({
  slug: z.string().min(1),
  credentials: z.record(z.string()),
});

/**
 * Get MCP credentials for current user
 */
export const getMcpCredentialsFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const slug = searchParams?.get('slug')
      || (typeof input === 'object' && input && 'slug' in input ? (input as { slug?: string }).slug : null);
    return detailSchema.parse({ slug });
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const credentials = await getMcpCredentials(user.id, data.slug);
    return credentials;
  });

/**
 * Set MCP credentials for current user
 */
export const setMcpCredentialsFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return credentialsSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setMcpCredentials(user.id, data.slug, data.credentials);
    return { success: true };
  });

// ============================================================================
// Allowed Tools Override Management
// ============================================================================

const allowedToolsSchema = z.object({
  slug: z.string().min(1),
  allowedTools: z.array(z.string()).nullable(),
});

/**
 * Get allowedTools override for current user
 */
export const getAllowedToolsOverrideFn = createServerFn({ method: 'GET' })
  .inputValidator((input) => {
    const searchParams = typeof input === 'string' ? new URLSearchParams(input) : null;
    const slug = searchParams?.get('slug')
      || (typeof input === 'object' && input && 'slug' in input ? (input as { slug?: string }).slug : null);
    return detailSchema.parse({ slug });
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const override = await getMcpAllowedToolsOverride(user.id, data.slug);
    return { allowedTools: override };
  });

/**
 * Set allowedTools override for current user
 */
export const setAllowedToolsOverrideFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return allowedToolsSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setMcpAllowedToolsOverride(user.id, data.slug, data.allowedTools);
    return { success: true };
  });

// ============================================================================
// MCP Tools Discovery (for allowedTools editor)
// ============================================================================

const mcpToolsSchema = z.object({
  slug: z.string().min(1),
});

/**
 * Get available tools for a specific MCP server
 * Connects to the MCP and fetches its tool list
 */
export const getMcpToolsFn = createServerFn({ method: 'POST' })
  .inputValidator((input) => {
    const payload = typeof input === 'string' ? JSON.parse(input) : input;
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: unknown }).data
      : payload;
    return mcpToolsSchema.parse(data);
  })
  .handler(async ({ data }) => {
    const user = await requireUser();
    const slug = normalizeMcpName(data.slug);

    // Get MCP config from store
    const store = await getMcpStore();
    const entry = store.find((e) => e.slug === slug);

    if (!entry || !entry.mcp) {
      return {
        ok: false,
        error: `MCP not found: ${slug}`,
        tools: [],
      };
    }

    const mcpConfig = entry.mcp;

    // Get user credentials for this MCP
    const userHome = getUserClaudeHome(user.id);
    const allCredentials = await readUserCredentials(userHome);
    const credentials = allCredentials[slug] || {};

    // Resolve environment templates
    function resolveEnvTemplate(template: Record<string, string> | undefined, creds: Record<string, string>) {
      if (!template) return {};
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(template)) {
        if (value && typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          const credKey = value.slice(2, -1);
          result[key] = creds[credKey] || '';
        } else if (value) {
          result[key] = value;
        }
      }
      return result;
    }

    const resolvedEnv = resolveEnvTemplate(mcpConfig.env, credentials);
    const resolvedHeaders = resolveEnvTemplate(mcpConfig.headers, credentials);

    try {
      // Import MCP SDK dynamically for tool discovery
      const { Client } = await import('@modelcontextprotocol/sdk/client');
      let transport;

      if (mcpConfig.type === 'stdio') {
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio');
        transport = new StdioClientTransport({
          command: mcpConfig.command,
          args: mcpConfig.args || [],
          env: { ...process.env, ...resolvedEnv },
        });
      } else if (mcpConfig.type === 'http' || mcpConfig.type === 'sse') {
        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse');
        transport = new SSEClientTransport(new URL(mcpConfig.url!), {
          requestInit: { headers: resolvedHeaders },
        });
      } else {
        return {
          ok: false,
          error: `Unsupported MCP type for tool discovery: ${mcpConfig.type}`,
          tools: [],
        };
      }

      const client = new Client({
        name: 'mcp-tools-discovery',
        version: '1.0.0',
      });

      // Set timeout for connection
      const timeoutMs = 30000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
      );

      await Promise.race([
        client.connect(transport),
        timeoutPromise,
      ]);

      const { tools } = await client.listTools();
      await client.close();

      return {
        ok: true,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description || '',
          fullName: `mcp__${slug}__${t.name}`,
        })),
      };
    } catch (error) {
      try {
        // Try to close client if it was created
        const { Client } = await import('@modelcontextprotocol/sdk/client');
        // Note: we can't close client if it wasn't fully initialized
      } catch {}
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        tools: [],
      };
    }
  });

// Helper function to read user credentials (duplicate from manager.js since not exported)
async function readUserCredentials(userHome: string) {
  const fsPromises = await import('fs/promises');
  const path = await import('path');
  const CREDENTIALS_FILENAME = 'credentials.json';

  const credPath = path.default.join(userHome, '.claude', 'mcp', CREDENTIALS_FILENAME);
  try {
    const raw = await fsPromises.default.readFile(credPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    return {};
  }
}
