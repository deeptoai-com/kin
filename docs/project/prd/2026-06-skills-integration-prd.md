# PRD：Skills 集成（精选 catalog + 上游 skills-api + 本地执行层）

> 日期：2026-06-02 ｜ 状态：草案待评审
> 关联：`research/2026-06-skills-existing-architecture-and-redesign.md`（现状 + 决策）、`research/2026-06-mcp-skills-reference-survey.md`、`mcp-capability-center-prd.md`（同构的能力中心）、`VISION.md`（私有部署定位）。
> 两个上游源（owner 指定，均为其自有）：
> - **`skills-api`** `/Users/peng/Jumpxai/Github/skills-api` —— ~9,600 GitHub skills 的抓取式注册表（原材料）。
> - **curated-100** `/Users/peng/Jumpxai/Github/platform/.../lib/skills.ts` 的 `CURATED_SKILLS`（人工精选 100，编辑层）。

---

## 1. 背景与三层模型（调研已确认）

- **`skills-api`（原材料）**：Hono 服务 + R2，抓取 ~9612 个 GitHub skills。列表很瘦（`source/owner/repo/skillId/name/installs/displayName/isOfficial`，**无 category/description/icon/content**）；**SKILL.md 内容按需从 GitHub 取**（`GET /api/skills/:owner/:repo/:skillId/content` → `{metadata(frontmatter), instructions(body), raw}`）+ `/files`；**无可填充变量、无图标**；`scrapedAt` + ETag 做变更检测;可选 `x-api-key`。
- **curated-100（产品/编辑层）**：platform 里硬编码的 `CURATED_SKILLS`（100 条 `CuratedSkillSeed`），**不来自 skills-api**。加：category / level / tags / 中文标题摘要 / 适合谁 / 解决什么问题 / 第一个任务 / 风险提示 / 复用度 / sortWeight / iconEmoji + 上游引用（githubUrl / installCommand）。详情页才用 skills-api 取内容。
- **OxyGenie 比 platform 多做两件事**：platform 只**展示** skill（显示 SKILL.md + 复制安装指令）；**OxyGenie 要真的在 agent 里跑 skill**，所以多了：① 启用时把 SKILL.md **物化到磁盘**（SDK 靠 `~/.claude/skills/<slug>/SKILL.md` 运行）；② 从 SKILL.md **本地生成可填充变量 schema**（composer 表单）。

**两边都没有「可填充变量 schema」与「图标内容」** → 印证既有结论：`.schema.json` 是 OxyGenie 独有、本地生成；图标本地（emoji / AI 生成）。

---

## 2. 目标 / 非目标

**目标**
- G1 **DB catalog**：以 platform 的 **curated-100 为种子**建立 OxyGenie 自有的精选 skill 目录（编辑元数据 + 上游引用），DB 为真相。
- G2 **内容来自 skills-api**：按上游引用取 SKILL.md（+ files），**落库缓存**，因为要物化到磁盘给 SDK 跑。
- G3 **执行层**：启用 → 物化到 `~/.claude/skills/<slug>/`（DB→FS 投影）→ SDK 运行；**本地生成 schema**（已修好的 generator，移出同步路径/后台）→ composer 可填充表单。
- G4 **能力中心 Skills tab**：精选 catalog 的浏览/搜索/分类/启用/详情（复用现有 skills-page + capability center）。
- G5 **上游搜索发现**：另给「从上游搜索/添加」入口（`skills-api /api/skills?query=`），用户可把 9600 里的某个 skill 拉成自己的（user-scoped catalog 条目 + 取内容 + 生成 schema）。

**非目标（本期不做）**
- 把 9600 全量灌库（上游是原材料，不是产品）。
- 公开市场/评分/付费/技能包 bundle。
- 跨机/团队共享 skill（org 级）—— 后续。
- 用上游的「安装指令(npx skills add)」做安装（那是 CLI 心智；我们走 DB→FS 物化）。

---

## 3. 关键决策（owner 拍板）

| # | 决策 | 依据 |
|---|------|------|
| D1 | **精选 catalog 以 platform curated-100 为种子**（复用编辑工作），内容从 skills-api 取 | owner 拍板 |
| D2 | **精选为主 + 上游搜索发现并存**：Skills tab 展精选;另设「从上游搜索/添加」 | owner 拍板 |
| D3 | **DB 为真相**（catalog/启用/内容缓存/schema 缓存）；**FS 为运行时投影**（启用时物化到 `~/.claude/skills/`） | 既有「DB 编目」+ 会话持久化研究的同一原则 |
| D4 | **内容落库**（不纯按需）：因为 SDK 必须从磁盘读 SKILL.md 才能跑 | §1 OxyGenie 执行层 |
| D5 | **schema 本地生成、移出同步路径**（后台/懒生成，按 content-hash 缓存，needsReview 人工复核） | 架构文档 §六约束 A + schema-generator 修复 |

---

## 4. 数据模型（DB）

新增 Drizzle 表（命名/字段以实现为准）：

```text
skill_catalog                 -- 精选 + 用户从上游添加的 skill（产品层）
  id, slug (unique), name,
  -- 编辑层(对齐 CuratedSkillSeed; 双语用 intlayer/JSON)
  title, summary, category, level, tags jsonb, reusability_status,
  suitable_for, problem, first_task, risk_notes, icon_emoji, sort_weight,
  -- 上游引用(从 skills-api 取内容)
  source enum('curated','upstream','builtin'),
  upstream { owner, repo, skillId } (jsonb) nullable,
  github_url, source_label,
  -- 范围
  scope enum('official','user'), owner_user_id nullable,
  created_at, updated_at

skill_content_cache           -- 从 skills-api 取来的 SKILL.md(+files), 落库
  catalog_id, skill_md text, files jsonb nullable,
  content_hash text, fetched_at, upstream_scraped_at
  PK(catalog_id)

skill_schema_cache            -- 本地从 SKILL.md 生成的可填充变量 schema
  catalog_id, content_hash, schema jsonb, status enum(missing/valid/stale/failed/needs_review),
  generated_at, generator_version, last_error
  PK(catalog_id, content_hash)

skill_enablement              -- 谁启用了哪个
  user_id, catalog_id, enabled bool, updated_at  PK(user_id, catalog_id)
```

- **content_hash** 串起 content↔schema：内容变(上游 re-scrape)→ hash 变 → schema 标记 stale → 后台重生成。
- 既有 `src/skills-store/<slug>/`（8 个 baoyu）→ `source='builtin'` 灌入 catalog，内容直接读源码(不走 skills-api)。

---

## 5. 架构 / 数据流

```
[播种] platform curated-100 manifest ──seed──▶ skill_catalog(source=curated, scope=official)
[内容] skills-api /content + /files ──fetch──▶ skill_content_cache (按 content_hash)
[schema] 本地 schema-generator(后台/懒) ─────▶ skill_schema_cache (按 content_hash, 复用 SchemaStatus)
[发现] skills-api /api/skills?query= ──user 添加──▶ skill_catalog(source=upstream, scope=user) → 取内容 → 生成 schema
[启用] skill_enablement ──物化──▶ ~/.claude/skills/<slug>/SKILL.md (+ .schema.json) ──▶ SDK 运行(settingSources:['project'])
```

- **物化(DB→FS 投影)**：会话初始化/启用时，把启用的 catalog 条目的 `skill_md`(+生成的 `.schema.json`)写到用户 `~/.claude/skills/<slug>/`；禁用时 GC。复用现有 `manager.js` 的 enable/copy 逻辑，数据源从 FS-store 改为 DB。
- **schema 生成**：绝不在播种/同步时 eager 跑(会爆 N 次 LLM)；首用懒生成 + 后台队列预热精选;UI 暴露 SchemaStatus(生成中/待复核)。复用已修好的 generator(0.1.77 后崩溃已修)。
- **内容刷新**：用 skills-api 的 `scrapedAt`/ETag 检测上游变化；变了则按需重取 + 重算 hash → schema stale → 重生成。

## 6. 能力中心 UX（Skills tab）

- 复用现有 `skills-page` + 能力中心(已收口)。卡片:icon_emoji / title / category / level / tags / 启用开关 / schema 状态 / 来源徽章(curated/upstream/builtin)。
- 详情:SKILL.md 渲染 + 编辑层(适合谁/问题/第一个任务/风险) + 可填充变量表单(schema) + 文件树。
- **上游搜索发现**:一个「从上游添加」入口/对话框 → 调 skills-api 搜索 → 选中 → 创建 user-scoped catalog 条目 + 取内容 + 触发 schema 生成。
- 调用:composer「/」引用 skill + 填表单(schema) —— 沿用现状。

## 7. 与现有 OxyGenie skills 子系统的衔接 / 迁移
- 复用:`schema-generator.ts`(已修)、`skill-marker`/`skill-match`、`skills-page`/详情组件、`manager.js` 的 enable/材料化、capability center Skills tab。
- 改:数据源从 **FS skills-store → DB catalog**;`getSkillsStore`/`syncUserSkills`/`resolve... ` 改读 DB;内容来源加 skills-api。
- 迁移:现有 8 个 builtin skill → catalog(source=builtin);现有用户已启用 → enablement 表。

## 8. 配置 / 环境
- `SKILLS_API_URL`(默认上游部署,如 `https://skills-api.deeptoai.com`)+ 可选 `SKILLS_API_KEY`(x-api-key)。仅服务端调用。
- curated-100 种子:把 platform 的 `CURATED_SKILLS` 适配为 OxyGenie 的 seed(脚本/迁移),双语字段映射到 intlayer 或 JSON。

## 9. 分期
- **S1 — Catalog + 展示**：DB schema + curated-100 播种 + skills-api 取内容落库 + 能力中心 Skills tab 展精选 + 详情(SKILL.md)。**不跑、不 schema。**
- **S2 — 执行层**：启用 → DB→FS 物化 → SDK 运行;schema 后台/懒生成 + composer 表单。
- **S3 — 上游搜索发现**：skills-api 搜索 + 「从上游添加」→ user-scoped catalog + 内容 + schema。
- **S4 — 同步/维护**：按 scrapedAt 重取内容、schema stale 重算、迁移现有 builtin/用户启用、admin 策展工具。

## 10. 验收
- 精选 100 在能力中心可浏览/搜索/分类/看详情(SKILL.md 来自 skills-api,落库)。
- 启用某 skill → 该会话 SDK 能用它(物化到磁盘);composer 显示其可填充变量表单(schema 生成好后)。
- 从上游搜索一个 skill → 添加 → 能用。
- DB 为真相:换 cwd/重建不丢(对齐会话持久化原则)。

## 11. 开放问题
1. curated-100 的**双语字段**(titleZh/summaryZh…)如何并入 OxyGenie 的 i18n(intlayer vs 直接存中文+英文列)?
2. schema 生成用哪个模型(ark-code-latest vs 更快更便宜的 deepseek-v4-flash/doubao-lite)?（成本/延迟）见 SDK 备忘。
3. 上游 `installCommand`(npx skills add) 我们不用;但是否在详情页保留"也可手动安装"提示?
4. 内容落库 vs 物化时取:S1 落库;是否需要离线完全自包含(打包进镜像)?
