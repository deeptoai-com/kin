/**
 * Skills Types
 *
 * Type definitions for Skills management
 */

export interface SkillInfo {
  slug: string           // 目录名（唯一标识）
  name: string           // 显示名称
  description: string | null  // 描述
  category: string       // 分类
}

/**
 * Extended Skill Info with store source and enabled status
 */
export interface ExtendedSkillInfo extends SkillInfo {
  store: 'official' | 'user'  // 技能来源
  enabled?: boolean           // 启用状态（仅用户技能）
  globalEnabled?: boolean     // 是否全局启用（管理员设置）
  deletable?: boolean         // 是否可删除（管理员可删除 GitHub 安装的技能）
  author?: string             // 作者 ID（仅用户技能）
  createdAt?: string          // 创建时间（仅用户技能）
  fileCount?: number          // 文件数量（仅用户技能）
  iconUrl?: string            // 图标 URL（AI 生成）
}

// Category constants
export const SKILL_CATEGORIES = {
  DEVELOPMENT: 'development',
  DESIGN: 'design',
  PRODUCTIVITY: 'productivity',
  INTEGRATION: 'integration',
  GENERAL: 'general',
} as const;

export type SkillCategory = typeof SKILL_CATEGORIES[keyof typeof SKILL_CATEGORIES];

/**
 * User skill file for upload
 */
export interface UserSkillFile {
  path: string      // 文件路径（相对于技能根目录）
  content: string  // 文件内容
}

/**
 * User skill metadata for upload
 */
export interface UserSkillMetadata {
  name: string
  description?: string
  category?: string
}

/**
 * User skill upload payload
 */
export interface UserSkillUploadPayload {
  name: string
  description?: string
  category?: string
  files: UserSkillFile[]
}
