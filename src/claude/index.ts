/**
 * Claude Module
 *
 * Centralized module for all Claude Agent SDK related functionality.
 * This module provides a symmetric structure to the Mastra module.
 */

// Skills management
export {
  getSkillsStore,
  getUserEnabledSkills,
  enableSkill,
  disableSkill,
  getUserClaudeHome,
  normalizeSkillName,
  fileExists,
  parseSkillMetadata,
  getSkillDetail,
  SKILL_CATEGORIES,
  type SkillInfo,
  type SkillCategory,
  type SkillFile,
  type SkillDetail,
} from './skills';

// Client adapters (for browser-side use)
export {
  ClaudeAgentWSAdapter,
  abort,
  resumeSession,
  newSession,
  disconnect,
  getSessionId,
  setSessionId,
  clearSession,
  checkIsQueryRunning,
  onSessionInit,
} from './adapters';
