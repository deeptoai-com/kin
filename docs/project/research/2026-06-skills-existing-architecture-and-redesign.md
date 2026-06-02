# Skills 子系统：现状拆解 + 重构方向（统一能力中心 / DB 编目）

> 日期：2026-06-02
> 目的：在动手做「统一能力中心（Skills/MCP）+ 上游 skills-api 批量同步」之前，先把**现有 Skills 子系统**研究透，特别是 owner 在 skill 之上加的「可填充变量」**包裹层**到底影响多大；并记录已拍板的两个架构决策与由此推导出的关键约束。
> 状态：研究 + 设计方向（非实施计划）。落地以后续 PRD/任务指派为准。
> 关联文档：`2026-06-mcp-skills-reference-survey.md`（外部参考产品调研）。

---

## 一、现状：三层结构，全部基于文件系统（无 DB）

| 层 | 是什么 | 存放位置 |
|----|--------|----------|
| **① Skill 内容** | `SKILL.md`（YAML frontmatter: name/description/category）+ `references/` + `prompts/` | `src/skills-store/<slug>/`（内置）→ seed 到 `SKILLS_STORE_DIR`（数据卷）→ copy 到用户 `~/.claude/skills/<slug>/` |
| **② 包裹层（owner 加的）** | `.schema.json`（**可填充变量** = `inputs[]`，加 `examples`/`tags`/`hint`）+ `.schema.meta.json`（hash/version/needsReview） | 每个 skill 目录内的 sidecar 文件 |
| **③ 启用状态** | `.global-skills.json`（管理员全局）、`.disabled-skills.json`（每用户禁用）、`.enabled`（上传技能标记）、`.source.json`（GitHub 来源） | 散落的 JSON 文件 |

**关键事实：当前没有任何 skills 数据库表。** 一切都是目录 + JSON sidecar + 启用时 copy / 禁用时 delete。

### 关键文件
- `src/claude/skills/manager.ts` — 路径解析、`getSkillsStore()`、`enableSkill/disableSkill`、`syncUserSkills()`（global ∪ user − disabled，启用时整目录 copy 到 `~/.claude/skills/`）、用户上传技能管理、GitHub 技能删除。
- `src/claude/skills/store-seeder.ts` — 启动时把内置 `src/skills-store/` 增量覆盖同步到 `SKILLS_STORE_DIR`（仅生产，设了 env 才跑）。
- `src/claude/skills/github-installer.ts` — 管理员从 GitHub repo 下载 zip → 找到 skill → 落地到 store（写 `.source.json`）。
- `src/claude/skills/schema-generator.ts` — **包裹层生成器**（详见下）。
- `src/claude/skills/metadata.ts` / `icon-generator.ts` / `command-parser.ts` / `compatibility.ts` / `detail.ts` / `template-generator.ts`。
- `src/server/function/skills.server.ts` — 全部 server functions（list/enable/disable/upload/schema/icon/github-install…）。
- `src/server/function/a2composer.server.ts` — 用 `readExistingSchema()` 做模板自动填充。
- `ws-server.mjs` / `ws-query-worker.mjs` — 运行时把 skills 喂给 SDK（见下）。
- 前端：`components/claude-chat/skills-manager-panel.tsx`、`skill-chip.tsx`；`components/skills/*`（skills-page/grid/card/detail-dialog/schema-manage-dialog/upload/github-installer）；`routes/agents/skills/route.tsx`。

---

## 二、② 包裹层（`.schema.json`）到底影响多大 —— 核心结论

**它是一个 form-schema sidecar。** 由 `schema-generator.ts` 通过一次**独立的 Claude SDK 调用**（`tools: []`、Structured Outputs、2 分钟超时、generator 版本 `1.1.0`）读取 `SKILL.md`，抽取最多 6 个可填充输入字段 + examples + tags + hint。代码里有大量归一化逻辑（处理约 15 种 wrapper/variant 形态，因为 LLM 输出不稳定），并用 `skillMdHash` 做陈旧检测、`needsReview` 标记。

**对 owner 最关心的「影响多大」的回答：包裹层对「技能运行」是非侵入的。**
- 运行时，skill 完全靠 `settingSources: ['project']` + symlink 的 `~/.claude/skills/` + 把原始 `SKILL.md` 注入 system prompt（`ws-query-worker.mjs` 的 `loadSkillContext`，注入格式 `[Explicit Skill Selected: <slug>] … [End Skill]`）。**schema 从不参与 skill 的执行。**
- `.schema.json` 只驱动三件**可选**的事：(a) composer 的**可填充变量表单**；(b) A2Composer **模板自动填充**（`a2composer.server.ts` → `readExistingSchema` → `generateTemplateFromSchema`）；(c) **管理员 schema 管理弹窗**（`schema-manage-dialog.tsx`，状态 missing/valid/invalid/stale/failed）。

→ **结论：包裹层的爆炸半径局限在「编辑/表单 UI」。** schema 缺失/失效的 skill 在对话里照样能用，只是渲染不出结构化输入表单。**运行时风险低，但每个 skill 有一次生成成本。**

---

## 三、当前同步模型 & 为什么扛不住「大量 skills」

现有同步 = `store-seeder` 文件拷贝 + `syncUserSkills` 启用时拷贝 + `installSkillFromGitHub`。**每个 skill 有三项 per-skill 成本**，批量化时是瓶颈：
1. **Schema 生成** = 每 skill 1 次 LLM 调用（owner 的包裹层，最贵）。
2. **图标生成** = 每 skill 1 次 Gemini 调用（`icon-generator`）。
3. **启用即拷贝** = 把整个目录 copy 进**每个用户**的 `~/.claude/skills/`（规模化时文件系统压力大）。

---

## 四、外部参考产品（详见姊妹文档）

- **Coze.cn**（最完整）：三个面 —— **技能商店**（分类/技能包 bundle/评分/案例/作者/版本/限免）、**我的技能**（已装 + 原生能力，带来源徽章 + ⋮ 管理 + 🔒 私有）、**所有文件**（配额 906MB/50GB + 按 agent 分文件夹）；**调用** = composer 里输入「/」快速引用技能或文件。关键洞察：Coze 把「数据集连接器（≈MCP）」「prompt/工作流」「原生工具」**统一成"技能"**一个用户概念。
- **lobe-chat**：PluginStore 用 `MCP | Plugin | Installed` 分 tab —— 与 Coze 的统一思路一致。
- **CraftAgent**（owner 日常用）：只有技能侧栏，**BYO、无商店、无库**。最轻。

---

## 五、已拍板的架构决策（owner 拍板）

1. **统一能力中心（分 tab）**：用户侧 MCP 与 Skills 合为一个「能力」入口，内部分 `技能 / MCP / 已安装` tab（仿 lobe-chat + Coze 的「数据集也是技能」模型）。
2. **DB 编目（catalog）**：skills 元数据进数据库表（支持搜索/分类/分页/评分），内容按需取；**启用不再整目录拷贝到每个用户**。适配「大量 skills」与商店/库分 tab。
3. **上游 skills-api 只给内容**（SKILL.md/内容），**schema 仍本地生成**；同步方式与旧的 GitHub/内置不同。

---

## 六、由决策推导出的关键约束 & 张力（设计必须处理）

### 约束 A：Schema 生成必须移出同步路径（否则批量同步会爆 N 次 LLM）
- 决策 2（DB 编目、可能上千 skill）+ 决策 3（本地生成 schema）⇒ **不能在同步时 eager 生成所有 schema**。
- 方案：schema 生成改为 **① 懒生成（首次使用/启用时）** 或 **② 后台队列批处理**；UI 暴露 `schema 生成中 / 待复核 / 缺失` 状态（`SchemaStatus` 已有，可复用）。
- 图标同理（Gemini per-skill）：懒/批处理，或允许上游/默认图标兜底。

### 约束 B：DB 是 source-of-truth，但运行时仍需把启用的 skill「投影」到文件系统
- SDK 靠 `settingSources: ['project']` **从磁盘扫描** `~/.claude/skills/`，所以 DB 编目 **不等于**抛弃文件系统。
- 模型应为：**DB = 目录/真相；FS = 运行时投影/缓存**。用户启用/使用某 skill 时，按需把其内容物化到会话工作区的 `.claude/skills/<slug>/`（含 `.schema.json` 若已生成）。
- 这把「启用即全量拷贝到每用户」换成「**用到才物化**」，正好契合「按需引用」。

### 约束 C：状态与来源迁移
- 现有 `.global-skills.json` / `.disabled-skills.json` / `.enabled` / `.source.json` → 迁移为 DB 表（global enable、per-user enable/disable、来源 builtin/github/upload/**api**）。
- 现有 sidecar `.schema.json` → 作为 DB 字段或「已生成的缓存产物」保留（运行时投影时写回 FS 供表单/模板用）。

### 约束 D：包裹层兼容
- 因为包裹层非侵入运行时（见 §二），DB 化与懒生成**不会**破坏对话执行；最坏情况只是表单/模板暂不可用。这是低风险迁移的依据。

---

## 七、统一能力中心 — 面向用户的形态（草图，待 PRD 细化）

- 顶部 tab：`技能(Skills) | MCP | 已安装(Installed)`；右上 搜索；可选「我的/全部」。
- 技能 tab：分类（沿用现有 category）+ 卡片（icon/name/desc/来源徽章/启用开关/⋮）+ 详情弹窗（详细介绍/案例/schema 状态）。
- MCP tab：仿 LibreChat —— 服务器卡片 + 状态徽章（connecting/active/error）+ stdio/http 配置 + env `${VAR:-default}`。
- 已安装 tab：用户已启用的技能 + 已连 MCP + 原生能力（无来源徽章）。
- 调用：composer「/」快速引用（技能/文件），或预先在能力中心启用。

---

## 八、下一步（待 owner 确认后进入 PRD）

1. 确认上游 skills-api 的契约（字段、鉴权、增量/全量、是否带 category/icon hint）。
2. 设计 DB schema：`skill_catalog`（元数据）、`skill_enablement`（global/user）、`skill_source`、（可选）`skill_schema_cache`。
3. 设计 schema/icon 的**懒生成 + 后台队列**与状态机（复用 `SchemaStatus`）。
4. 设计「DB→FS 运行时投影」：会话初始化/启用时按需物化到 `.claude/skills/`。
5. 统一能力中心前端（分 tab）+ 复用现有 skills-page/manager-panel 组件。
6. 迁移脚本：现有 FS skills + sidecar + 状态文件 → DB。
