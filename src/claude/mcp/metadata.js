/**
 * MCP Metadata Parser
 *
 * Extracts metadata from MCP packages (MCP.md with YAML frontmatter).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Check if a file exists
 */
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeMcpConfig(rawConfig, fallbackName) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return null;
  }

  const type = String(rawConfig.type || '').toLowerCase();
  if (!['sdk', 'stdio', 'sse', 'http'].includes(type)) {
    return null;
  }

  const name = typeof rawConfig.name === 'string' && rawConfig.name.trim()
    ? rawConfig.name.trim()
    : fallbackName;

  const config = { type, name };

  if (type === 'stdio') {
    if (typeof rawConfig.command !== 'string' || !rawConfig.command.trim()) {
      return null;
    }
    config.command = rawConfig.command;
    if (Array.isArray(rawConfig.args)) config.args = rawConfig.args;
    if (rawConfig.env && typeof rawConfig.env === 'object') config.env = rawConfig.env;
    return config;
  }

  if (type === 'sse' || type === 'http') {
    if (typeof rawConfig.url !== 'string' || !rawConfig.url.trim()) {
      return null;
    }
    config.url = rawConfig.url;
    if (rawConfig.headers && typeof rawConfig.headers === 'object') config.headers = rawConfig.headers;
    return config;
  }

  return config;
}

/**
 * Parse MCP metadata from a directory
 */
export async function parseMcpMetadata(mcpPath, fallbackName) {
  const manifestPath = path.join(mcpPath, 'MCP.md');

  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return extractMcpMetadataFromMarkdown(content, fallbackName);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[MCP] Failed to read MCP.md:', error);
    }
    return null;
  }
}

function extractMcpMetadataFromMarkdown(content, fallbackName) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);

  if (match) {
    try {
      const frontmatter = yaml.load(match[1]);
      if (frontmatter && typeof frontmatter === 'object') {
        const name = typeof frontmatter.name === 'string' ? frontmatter.name : fallbackName;
        const description = typeof frontmatter.description === 'string' ? frontmatter.description : null;
        const category = typeof frontmatter.category === 'string' ? frontmatter.category : 'general';
        const defaultEnabled = Boolean(frontmatter.defaultEnabled);
        const mcp = normalizeMcpConfig(frontmatter.mcp, fallbackName);

        // Parse allowedTools (array of tool name patterns)
        let allowedTools = null;
        if (Array.isArray(frontmatter.allowedTools)) {
          allowedTools = frontmatter.allowedTools.filter(t => typeof t === 'string');
        }

        // Parse credentials (array of credential field definitions)
        let credentials = null;
        if (Array.isArray(frontmatter.credentials)) {
          credentials = frontmatter.credentials
            .map(c => ({
              key: typeof c.key === 'string' ? c.key : null,
              label: typeof c.label === 'string' ? c.label : c.key || '',
              description: typeof c.description === 'string' ? c.description : null,
              required: Boolean(c.required),
              sensitive: Boolean(c.sensitive ?? true),
            }))
            .filter(c => c.key !== null);
        }

        return {
          slug: fallbackName,
          name,
          description,
          category,
          defaultEnabled,
          mcp,
          allowedTools,
          credentials,
        };
      }
    } catch (error) {
      console.warn('[MCP] Failed to parse MCP frontmatter:', error);
    }
  }

  // Fallback: parse from markdown heading
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  const name = headingIndex >= 0
    ? lines[headingIndex].replace(/^#\s+/, '').trim() || fallbackName
    : fallbackName;

  let description = null;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    if (line.startsWith('#')) break;
    description = line;
    break;
  }

  return {
    slug: fallbackName,
    name,
    description,
    category: 'general',
    defaultEnabled: false,
    mcp: null,
    allowedTools: null,
    credentials: null,
  };
}
