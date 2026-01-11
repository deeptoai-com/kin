import { FC } from 'react';
import type { ExtendedSkillInfo } from '~/claude/skills';
import { SkillCard } from './skill-card';

interface SkillsGridProps {
  skills: ExtendedSkillInfo[];
  enabledSkills: string[];
  onToggleSkill: (skillSlug: string) => void;
  onViewDetails: (skillSlug: string) => void;
  onDeleteSkill?: (skillSlug: string) => void;
}

export const SkillsGrid: FC<SkillsGridProps> = ({
  skills,
  enabledSkills,
  onToggleSkill,
  onViewDetails,
  onDeleteSkill,
}) => {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => (
        <SkillCard
          key={skill.slug}
          skill={skill}
          isEnabled={enabledSkills.includes(skill.slug)}
          onToggle={() => onToggleSkill(skill.slug)}
          onViewDetails={() => onViewDetails(skill.slug)}
          onDeleteSkill={onDeleteSkill}
        />
      ))}
    </div>
  );
};
