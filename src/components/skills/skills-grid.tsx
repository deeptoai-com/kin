import { FC } from 'react';
import type { ExtendedSkillInfo } from '~/claude/skills';
import { SkillCard } from './skill-card';

interface SkillsGridProps {
  skills: ExtendedSkillInfo[];
  enabledSkills: string[];
  globalSkills: string[];
  isAdmin: boolean;
  onToggleSkill: (skillSlug: string) => void;
  onToggleGlobal: (skillSlug: string) => void;
  onViewDetails: (skillSlug: string) => void;
  onDeleteSkill?: (skillSlug: string) => void;
  onManageSchema?: (skillSlug: string) => void;
}

export const SkillsGrid: FC<SkillsGridProps> = ({
  skills,
  enabledSkills,
  globalSkills,
  isAdmin,
  onToggleSkill,
  onToggleGlobal,
  onViewDetails,
  onDeleteSkill,
  onManageSchema,
}) => {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => (
        <SkillCard
          key={skill.slug}
          skill={skill}
          isEnabled={enabledSkills.includes(skill.slug)}
          isGlobalEnabled={globalSkills.includes(skill.slug)}
          isAdmin={isAdmin}
          onToggle={() => onToggleSkill(skill.slug)}
          onToggleGlobal={() => onToggleGlobal(skill.slug)}
          onViewDetails={() => onViewDetails(skill.slug)}
          onDeleteSkill={onDeleteSkill}
          onManageSchema={onManageSchema}
        />
      ))}
    </div>
  );
};
