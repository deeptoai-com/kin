/**
 * RAG golden set v1 (R4-①) — synthetic but adversarial: every question targets ONE
 * section, with distractor sections nearby. Question types are tagged so the eval can
 * show WHERE each pipeline stage earns its keep:
 *  - keyword:   exact terms present in the target (BM25's home turf)
 *  - paraphrase: no lexical overlap with the target (embedding's home turf)
 *  - entity:    rare proper noun / code (hybrid tie-breaker)
 *
 * v2 swaps/augments these with real team documents + real queries mined from
 * rag_search_trace. Keep questions ≥10 per doc when adding.
 */

export interface GoldenDoc {
  title: string;
  markdown: string;
}

export interface GoldenCase {
  doc: string;
  query: string;
  /** Substring that must appear in the hit's sectionPath to count as correct. */
  expectSection: string;
  type: 'keyword' | 'paraphrase' | 'entity';
}

const pad = (topic: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `${topic}的常规说明第${i + 1}条：本段为流程性描述，用于模拟真实文档的篇幅与噪声。`,
  ).join('\n\n');

export const GOLDEN_DOCS: GoldenDoc[] = [
  {
    title: '雾海号货轮运营手册',
    markdown: [
      '# 第一章 船舶概况', pad('概况', 30),
      '## 1.1 主机参数', '主机为 MX-9000 型低速柴油机，额定功率两万一千千瓦。', pad('主机', 20),
      '# 第二章 燃油管理', '远洋航段使用低硫燃油，含硫量不得高于百分之零点五。', pad('燃油', 30),
      '# 第三章 压载水', '压载水置换必须在距最近陆地两百海里以外的深水区进行。', pad('压载', 30),
      '# 第四章 冷链货舱', '冷链货舱的温度容差为正负零点八摄氏度，超出即触发声光报警。', pad('冷链', 30),
      '# 第五章 应急程序', '弃船警报为连续七短声加一长声，全员须于八分钟内到达集合站。', pad('应急', 30),
    ].join('\n\n'),
  },
  {
    title: '北辰数据中心运维规范',
    markdown: [
      '# 第一章 机房环境', pad('环境', 30),
      '## 1.1 温湿度', '冷通道目标温度为二十二摄氏度，相对湿度保持在百分之四十至六十。', pad('温湿', 20),
      '# 第二章 供电体系', 'UPS 电池组在满载情况下可支撑十七分钟，柴油发电机须在九十秒内并网。', pad('供电', 30),
      '# 第三章 网络架构', '核心交换采用双活架构，骨干链路代号 POLARIS-7，带宽四百G。', pad('网络', 30),
      '# 第四章 变更管理', '高危变更窗口固定为周四凌晨一点至五点，须双人复核后执行。', pad('变更', 30),
      '# 第五章 灾备演练', '全量灾备切换演练每季度执行一次，目标恢复时间不超过四十五分钟。', pad('灾备', 30),
    ].join('\n\n'),
  },
];

export const GOLDEN_CASES: GoldenCase[] = [
  // ── 雾海号 ──────────────────────────────────────────────────────────────
  { doc: '雾海号货轮运营手册', query: '主机的额定功率是多少', expectSection: '主机参数', type: 'keyword' },
  { doc: '雾海号货轮运营手册', query: 'MX-9000 是什么', expectSection: '主机参数', type: 'entity' },
  { doc: '雾海号货轮运营手册', query: '船用油的硫含量上限', expectSection: '燃油管理', type: 'paraphrase' },
  { doc: '雾海号货轮运营手册', query: '离岸多远才能换压载水', expectSection: '压载水', type: 'paraphrase' },
  { doc: '雾海号货轮运营手册', query: '冷藏舱温度允许波动范围', expectSection: '冷链货舱', type: 'paraphrase' },
  { doc: '雾海号货轮运营手册', query: '弃船警报的声音信号', expectSection: '应急程序', type: 'keyword' },
  { doc: '雾海号货轮运营手册', query: '撤离时多久要到集合点', expectSection: '应急程序', type: 'paraphrase' },
  // ── 北辰 ────────────────────────────────────────────────────────────────
  { doc: '北辰数据中心运维规范', query: '冷通道应该设定几度', expectSection: '温湿度', type: 'paraphrase' },
  { doc: '北辰数据中心运维规范', query: 'UPS 满载能撑多久', expectSection: '供电体系', type: 'keyword' },
  { doc: '北辰数据中心运维规范', query: '断电后备用发电机多快接管', expectSection: '供电体系', type: 'paraphrase' },
  { doc: '北辰数据中心运维规范', query: 'POLARIS-7 是什么', expectSection: '网络架构', type: 'entity' },
  { doc: '北辰数据中心运维规范', query: '什么时间可以做高风险变更', expectSection: '变更管理', type: 'paraphrase' },
  { doc: '北辰数据中心运维规范', query: '灾备演练多久一次', expectSection: '灾备演练', type: 'keyword' },
  { doc: '北辰数据中心运维规范', query: '故障恢复的时间目标', expectSection: '灾备演练', type: 'paraphrase' },
];

// ── Golden set v2: REAL corpus (rag-test-docs/minimax.md, 716-page prospectus) ────────
// Judged by expectText-in-chunk (no section labels in real docs).
// v2.1 balance fix: v2 was paraphrase-heavy (9/12), which is embedding's home turf —
// the "BM25 leg hurts / rerank is neutral" conclusion was unfair. v2.1 adds lexical-
// anchor questions (keyword / entity / clause) whose queries share LITERAL tokens with
// the target. Anchors are deliberately script-neutral (Latin names, digits, clause
// numbers like "18C.14"): users type simplified Chinese while the corpus is
// traditional, so CJK terms never match lexically — only ASCII/digit tokens give the
// BM25 leg a fair shot.

export interface RealGoldenCase {
  query: string;
  expectText: string;
  /** clause = the query cites a rule/clause number verbatim (上市規則第X條-style). */
  type: 'keyword' | 'paraphrase' | 'entity' | 'clause';
}

/** Title used for the persistent golden document row (sourceType 'rag-golden'). */
export const REAL_GOLDEN_DOC_TITLE = 'MiniMax招股书(golden-v2)';

export const REAL_GOLDEN_CASES: RealGoldenCase[] = [
  { query: '研发团队有多少人', expectText: '約300名成員', type: 'paraphrase' },
  { query: '流动负债净额增长到了多少', expectText: '343.3', type: 'paraphrase' },
  { query: '公司预计每个月要烧多少钱', expectText: '28.1', type: 'paraphrase' },
  { query: '账上的现金结余还有多少', expectText: '1,046.2', type: 'paraphrase' },
  { query: '毛利率是怎么改善的', expectText: '24.7%', type: 'paraphrase' },
  { query: '2022年公司亏了多少钱', expectText: '73.7', type: 'paraphrase' },
  { query: '产品覆盖了多少个国家的用户', expectText: '200個國家', type: 'paraphrase' },
  { query: '月活跃用户增长情况如何', expectText: '19.1百萬', type: 'paraphrase' },
  { query: '付费用户数量达到多少', expectText: '650,300', type: 'keyword' },
  { query: '开放平台付费用户是怎么定义的', expectText: '50美元', type: 'paraphrase' },
  { query: '视频生成用的是哪个模型', expectText: 'Hailuo-02', type: 'entity' },
  { query: '语音合成模型叫什么', expectText: 'Speech-02', type: 'entity' },
  // ── v2.1: lexical-anchor cases (every anchor verified verbatim in the corpus) ──────
  // clause: query cites the rule number — BM25's home turf.
  { query: '上市规则第18C.14条的禁售规定是什么', expectText: '18C.14', type: 'clause' },
  { query: '上市规则第3.28条对公司秘书资格有什么要求', expectText: '3.28', type: 'clause' },
  { query: '第8A.24条保留事项的投票是怎么规定的', expectText: '8A.24', type: 'clause' },
  { query: '现有股东作为基石投资者认购需要根据第10.04条申请什么', expectText: '10.04', type: 'clause' },
  // keyword: query contains an exact digit token from the target passage.
  { query: '最高发售价165.00港元之外还要加收什么费用', expectText: '165.00', type: 'keyword' },
  { query: '备考每股有形资产净值按已发行305,447,288股计算的依据', expectText: '305,447,288', type: 'keyword' },
  { query: '付费用户650,300名是哪一年达到的', expectText: '650,300', type: 'keyword' },
  { query: '公司的资金能支撑运营到2030年吗', expectText: '2030年3月', type: 'keyword' },
  // entity: rare Latin proper noun shared verbatim between query and target.
  { query: 'Alisoft 持有公司多少股权', expectText: 'Alisoft China Holding Limited', type: 'entity' },
  { query: 'MiniMax M1 能处理多长的上下文', expectText: '一百萬個tokens', type: 'entity' },
  { query: 'MiniMax M2 是为什么场景设计的', expectText: '代碼和Agent任務', type: 'entity' },
  { query: 'Local Linearity 是由谁控制的实体', expectText: 'Local Linearity', type: 'entity' },
];
