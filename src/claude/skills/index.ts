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
} from './manager';

// Metadata functions
export { fileExists, parseSkillMetadata } from './metadata';

// Detail functions
export { getSkillDetail } from './detail';

// Note: getSkillDetail now accepts an optional second parameter `userId`
// to support retrieving user-uploaded skills
// Usage: await getSkillDetail(skillSlug, userId?)
