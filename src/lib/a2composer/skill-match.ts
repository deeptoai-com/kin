import type { ExtendedSkillInfo } from '~/claude/skills';
import type { A2Template } from './types';

const normalizeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const buildSearchText = (skill: ExtendedSkillInfo): string => {
  const parts = [
    skill.slug,
    skill.name,
    skill.description ?? '',
    skill.category,
  ];
  return parts.join(' ').toLowerCase();
};

export function resolveSkillMatch(
  template: A2Template,
  skills: ExtendedSkillInfo[],
): ExtendedSkillInfo | null {
  if (!skills.length) return null;

  if (template.skillId) {
    const normalized = normalizeToken(template.skillId);
    const direct = skills.find((skill) => {
      const slug = normalizeToken(skill.slug);
      return slug === normalized;
    });
    if (direct) return direct;
  }

  if (template.skillHint) {
    const hint = normalizeToken(template.skillHint);
    const directMatch = skills.find((skill) => {
      const slug = normalizeToken(skill.slug);
      const name = normalizeToken(skill.name);
      return slug === hint || name === hint;
    });
    if (directMatch) return directMatch;
  }

  if (template.skillTags?.length) {
    const tags = template.skillTags.map((tag) => tag.toLowerCase());
    const tagMatch = skills.find((skill) => {
      const haystack = buildSearchText(skill);
      return tags.some((tag) => haystack.includes(tag));
    });
    if (tagMatch) return tagMatch;
  }

  return null;
}
