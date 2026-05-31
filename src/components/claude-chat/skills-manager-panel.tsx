import { FC, useEffect, useState } from 'react'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useServerFn } from '@tanstack/react-start'
import {
  listSkillsStore,
  listUserSkills,
  enableUserSkill,
  disableUserSkill,
} from '~/server/function/skills.server'
import type { SkillInfo } from '~/claude/skills'

interface SkillsManagerPanelProps {
  userId: string
  onClose: () => void
}

/**
 * Skills Manager Panel
 *
 * Follows TanStack Start best practices:
 * - Server Functions for data fetching and mutations
 * - React Query for caching and synchronization
 */
export const SkillsManagerPanel: FC<SkillsManagerPanelProps> = ({ userId, onClose }) => {
  // Server Functions (type-safe RPC)
  const enableSkill = useServerFn(enableUserSkill)
  const disableSkillFn = useServerFn(disableUserSkill)

  // Fetch data using React Query
  const { data: availableSkills = [], isLoading: isLoadingSkills } = useQuery({
    queryKey: ['skills-store'],
    queryFn: () => listSkillsStore(),
  })

  const { data: enabledSkillsList = [], isLoading: isLoadingEnabled } = useQuery({
    queryKey: ['user-skills', userId],
    queryFn: () => listUserSkills(),
  })

  const enabledSkills = enabledSkillsList.map(s => s.slug)
  const isLoading = isLoadingSkills || isLoadingEnabled

  // Handle toggle switch
  const handleToggle = async (skillSlug: string) => {
    const isEnabled = enabledSkills.includes(skillSlug)
    try {
      if (isEnabled) {
        await disableSkillFn({ data: { skillName: skillSlug } })
        // Optimistic update (React Query will refetch)
      } else {
        await enableSkill({ data: { skillName: skillSlug } })
        // Optimistic update
      }
    } catch (error) {
      console.error('Failed to toggle skill:', error)
      const message = error instanceof Error ? error.message : '启用技能失败'
      if (message.startsWith('SKILL_NOT_SYNCED:')) {
        const slug = message.split(':')[1]?.trim() ?? skillSlug
        toast.error(`技能未同步到运行时目录：${slug}。当前启用不会生效。`)
      } else if (message.includes('SKILL_GLOBAL_ENABLED')) {
        toast.error('该技能已被管理员全局启用，无法关闭。')
      } else {
        toast.error(message)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20" onClick={onClose}>
      <div
        className="w-96 max-h-[80vh] overflow-y-auto rounded-lg border border-border dark:border-border bg-card dark:bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-border">
        <h3 className="text-sm font-semibold text-foreground dark:text-foreground">
          🔧 Skills 管理
        </h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
          aria-label="关闭"
        >
          <Cross2Icon width={16} height={16} />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Loading State */}
        {isLoading && (
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">加载中...</p>
        )}

        {/* Empty State */}
        {!isLoading && availableSkills.length === 0 && (
          <p className="text-xs text-muted-foreground dark:text-muted-foreground italic">
            暂无可用的 Skills
          </p>
        )}

        {/* Skills List */}
        {!isLoading && availableSkills.length > 0 && (
          <div className="space-y-2">
            {availableSkills.map((skill: SkillInfo) => {
              const isEnabled = enabledSkills.includes(skill.slug)
              return (
                <SkillToggleItem
                  key={skill.slug}
                  skill={skill}
                  isEnabled={isEnabled}
                  onToggle={() => handleToggle(skill.slug)}
                />
              )
            })}
          </div>
        )}

        {/* Footer Info */}
        <div className="pt-2 border-t border-border dark:border-border">
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            已启用: {enabledSkills.length} / {availableSkills.length}
          </p>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
            提示：开启后需重新发起对话才能使用新 Skills
          </p>
        </div>
      </div>
      </div>
    </div>
  )
}

// Skill Toggle Item Component
interface SkillToggleItemProps {
  skill: SkillInfo
  isEnabled: boolean
  onToggle: () => void
}

const SkillToggleItem: FC<SkillToggleItemProps> = ({ skill, isEnabled, onToggle }) => {
  return (
    <div className="flex items-start justify-between gap-3 p-2 rounded hover:bg-muted dark:hover:bg-muted/50">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground dark:text-foreground">
          {skill.name}
        </p>
        {skill.description && (
          <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-0.5">
            {skill.description}
          </p>
        )}
      </div>

      {/* Toggle Switch */}
      <button
        onClick={onToggle}
        className={`
          relative inline-flex h-5 w-9 items-center rounded-full transition-colors
          ${isEnabled
            ? 'bg-primary dark:bg-primary'
            : 'bg-muted dark:bg-muted'}
        `}
        aria-label={isEnabled ? '关闭' : '开启'}
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-card transition-transform
            ${isEnabled ? 'translate-x-5' : 'translate-x-0.5'}
          `}
        />
      </button>
    </div>
  )
}
