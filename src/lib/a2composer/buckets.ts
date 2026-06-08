/**
 * A2Composer task buckets — 5 面向任务的大类，映射自技能 `skill_catalog.category`
 * 的 7 个值。展示层映射；不改技能底层 category。
 * See docs/project/prd/2026-06-a2composer-prd.md §0.
 */

export type BucketId = 'writing' | 'design' | 'automation' | 'research' | 'ai_eng';

export type A2Bucket = {
  id: BucketId;
  /** lucide icon name (resolved to a component in the panel) */
  icon: string;
  /** display label (zh) */
  label: string;
  /** skill_catalog.category values that fall into this bucket */
  categories: string[];
};

export const A2_BUCKETS: A2Bucket[] = [
  { id: 'writing', icon: 'PenLine', label: '写作与内容', categories: ['writing'] },
  { id: 'design', icon: 'Shapes', label: '设计与前端', categories: ['design_frontend'] },
  { id: 'automation', icon: 'Workflow', label: '自动化与集成', categories: ['automation', 'security'] },
  { id: 'research', icon: 'Compass', label: '研究与策略', categories: ['research', 'learning'] },
  { id: 'ai_eng', icon: 'Cpu', label: 'AI 工程', categories: ['ai_engineering'] },
];

/** category → bucketId */
export const CATEGORY_TO_BUCKET: Record<string, BucketId> = A2_BUCKETS.reduce(
  (acc, bucket) => {
    for (const cat of bucket.categories) acc[cat] = bucket.id;
    return acc;
  },
  {} as Record<string, BucketId>,
);
