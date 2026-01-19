export type McpCategory =
  | 'general'
  | 'development'
  | 'integration'
  | 'data';

export type McpConfig = {
  type: 'sdk' | 'stdio' | 'sse' | 'http';
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

export type CredentialField = {
  key: string;
  label: string;
  description: string | null;
  required: boolean;
  sensitive: boolean;
};

export type McpInfo = {
  slug: string;
  name: string;
  description: string | null;
  category: McpCategory | string;
  defaultEnabled?: boolean;
  mcp: McpConfig | null;
  allowedTools?: string[] | null;
  credentials?: CredentialField[] | null;
};

export type ExtendedMcpInfo = McpInfo & {
  store: 'official' | 'system' | 'user';
  enabled: boolean;
};

export type McpFile = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  content?: string;
  size?: number;
  isBinary?: boolean;
  isTooLarge?: boolean;
  children?: McpFile[];
};

export type McpDetail = {
  slug: string;
  name: string;
  description: string | null;
  category: string;
  files: McpFile[];
  /** MCP connection configuration */
  mcp: McpConfig | null;
  /** Credential field definitions */
  credentials?: CredentialField[] | null;
  /** Allowed tools from MCP.md definition */
  allowedTools?: string[] | null;
  /** Store type: official, system, or user */
  store: 'official' | 'system' | 'user';
  /** Whether MCP is enabled for current user */
  enabled: boolean;
  /** Markdown content from MCP.md for About tab */
  readme?: string | null;
};

/**
 * Input for adding a custom MCP
 */
export type AddCustomMcpInput = {
  /** Unique slug identifier */
  slug: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string | null;
  /** Category */
  category?: McpCategory | string;
  /** MCP connection configuration */
  mcp: McpConfig;
  /** Allowed tools (optional, defaults to all) */
  allowedTools?: string[] | null;
  /** Credential field definitions */
  credentials?: CredentialField[] | null;
};

/**
 * Result of MCP store listing with system and user custom MCPs
 */
export type McpStoreResult = {
  official: ExtendedMcpInfo[];
  system: ExtendedMcpInfo[];
  user: ExtendedMcpInfo[];
};

/**
 * npm package info for auto-detection
 */
export type NpmPackageInfo = {
  name: string;
  version: string;
  description?: string;
  bin?: Record<string, string>;
  keywords?: string[];
};
