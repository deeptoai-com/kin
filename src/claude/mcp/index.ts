/**
 * Claude MCP Module
 *
 * Exports MCP management utilities.
 */

export type {
  McpInfo,
  McpDetail,
  McpFile,
  ExtendedMcpInfo,
  McpConfig,
  CredentialField,
  AddCustomMcpInput,
  McpStoreResult,
  NpmPackageInfo,
} from './types';

export {
  normalizeMcpName,
  getUserClaudeHome,
  getMcpStore,
  getUserEnabledMcpServers,
  enableMcpServer,
  disableMcpServer,
  resolveMcpServerConfigs,
  getMcpDetail,
  getMcpCredentials,
  setMcpCredentials,
  getMcpAllowedToolsOverride,
  setMcpAllowedToolsOverride,
  // Custom MCP management (personal)
  getUserCustomMcpDir,
  getUserCustomMcps,
  saveCustomMcp,
  deleteCustomMcp,
  customMcpExists,
  getCustomMcpDetail,
  parseMcpConfigFromContent,
  // System MCP management (global)
  getSystemMcpDir,
  getSystemMcps,
  saveSystemMcp,
  deleteSystemMcp,
  systemMcpExists,
} from './manager.js';

export { fileExists, parseMcpMetadata } from './metadata.js';
