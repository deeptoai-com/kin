/**
 * Claude Skills Module
 *
 * Exports Skills management utilities.
 */

// Types
export type { SkillInfo, SkillCategory } from './types';
export { SKILL_CATEGORIES } from './types';
export type { SkillFile, SkillDetail } from './detail-types';
export type { ExtendedSkillInfo, UserSkillFile, UserSkillUploadPayload } from './types';

// Manager functions
export {
  normalizeSkillName,
  getUserClaudeHome,
  getSkillsStore,
  getUserEnabledSkills,
  enableSkill,
  disableSkill,
  // User skill management
  uploadUserSkill,
  getUserUploadedSkills,
  deleteUserSkill,
  enableUserUploadedSkill,
  disableUserUploadedSkill,
  getUserSkillFiles,
  // GitHub-installed skills management
  isGitHubInstalledSkill,
  getExtendedSkillInfo,
  deleteGitHubSkill,
} from './manager';

// Metadata functions
export { fileExists, parseSkillMetadata } from './metadata';

// Detail functions
export { getSkillDetail } from './detail';

// Compatibility check
export {
  checkSkillCompatibility,
  formatCompatibilityWarnings,
} from './compatibility';
export type { CompatibilityCheckResult } from './compatibility';

// Installer utilities
export { parseSkillsCommand, validateGitHubUrl } from './command-parser';
export { installSkillFromGitHub, downloadFromGitHub } from './github-installer';

// Schema generator (independent SDK call chain, not WS-based)
export {
  // Core generation
  generateSkillSchema,
  generateSchemaFromContent,
  // Enhanced generation with meta
  generateSkillSchemaWithMeta,
  // File operations
  readSkillMd,
  schemaExists,
  readExistingSchema,
  validateSkillSchema,
  atomicWriteSchema,
  // Meta operations
  hashSkillMd,
  readSchemaMeta,
  atomicWriteSchemaMeta,
  updateSchemaMetaError,
  // Status computation
  computeSchemaStatus,
  // Version
  SCHEMA_GENERATOR_VERSION,
} from './schema-generator';
export type {
  SkillSchema,
  SkillInputField,
  GenerateSchemaOptions,
  GenerateSchemaResult,
  // Meta types
  SchemaMeta,
  SchemaStatus,
  SchemaStatusInfo,
  GenerateSchemaWithMetaOptions,
  GenerateSchemaWithMetaResult,
} from './schema-generator';

// Note: getSkillDetail now accepts an optional second parameter `userId`
// to support retrieving user-uploaded skills
// Usage: await getSkillDetail(skillSlug, userId?)
