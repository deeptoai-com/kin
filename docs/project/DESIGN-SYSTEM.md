# OxyGenie 设计语言 & 组件组织规范（宪法）

> 我们参考很多产品（craft-agents-oss / deep-agents-ui / deer-flow / lobe-chat …），但**代码与视觉必须统一**。
> 这份文件是"统一语言"的单一事实来源；任何打磨/借鉴都要向它收敛。与 `STATUS.md`、`PHASE3-PLAN.md`、
> `research/2026-05-conversation-ux-tree.md`（逐组件 check 账本）配套。
> 日期：2026-05-31 · 状态：活文档，随约定演进就更新。

## 0. 第一原则

1. **references 是素材库，不是模板。** 借来的做法（数据结构/交互/视觉）一律先**翻译成本规范**再落地，禁止原样 copy。
2. **换皮不换骨。** 视觉靠 token，不靠改组件结构；保留 shadcn/Radix 地基。
3. **一处定义、处处消费。** 颜色/圆角/阴影/字体只在 token 层定义；组件只引用，**禁止硬编码 hex / 裸像素 / 任意色**。
4. **统一优先于局部最优。** 宁可全站一致的"良好"，不要东一块西一块的"惊艳"。

---

## 1. 设计语言（视觉）

**单一来源**：`src/styles/app.css`（shadcn 语义变量 + `@theme` + `.dark`）+ `src/styles/tokens.css`（品牌色）。

### 1.1 颜色 = 语义 token（禁硬编码）
只用：`background / foreground / card / popover / primary / secondary / muted / muted-foreground /
accent / accent-foreground / destructive / border / input / ring / sidebar*`。
- 文字次要信息 → `text-muted-foreground`；分隔/边框 → `border-border`（弱化用 `/50`）；浅底 → `bg-muted`。
- **禁止** `text-red-500 / #6b6a68 / bg-[#f8f8f6]` 这类。已修：`markdown-components`（D3.1）；待修：工具卡状态色（D2.7）。

### 1.2 状态色语义（统一映射）
| 语义 | token | 用于 |
|---|---|---|
| 运行中 running | `--primary`（陶土，或 `text-primary`） | spinner / 进行中 dot |
| 成功 done | `--primary` 或 success（暂用 primary，勿用裸 green-500） | ✓ |
| 错误 error | `text-destructive` | 失败 |
| 中性/待定 | `text-muted-foreground` | 默认 |
> 决策：状态色不引入新调色板，**复用 primary/destructive/muted**，保持克制。需要"成功绿"时再统一加一个 `--success` token，不要散落 green-500。

### 1.3 圆角刻度（已落地）
`--radius: 0.625rem`(10px) 基准 → `rounded-sm/md/lg/xl = 6/8/10/14`；`rounded-full` = 胶囊。
- 小元件(checkbox/内嵌) `sm`(6) · 按钮/输入/图标徽章 `md`(8)/`lg`(10) · 卡片 `xl`(14)/`2xl`(16) · chips/标签/状态/切换 = `full`。
- **禁止** `rounded-[5px]` 等任意值；必须落在刻度上。

### 1.4 阴影
柔和暖色刻度（app.css 已定义 `--shadow-*`）。浮层/卡片 `shadow-sm`；需与内容区隔的浮起元素（composer/skills 栏）`shadow-md`；弹出 `shadow-lg`。主按钮带 tactile（渐变 + `shadow-sm`）。

### 1.5 字体 & 排版
- 正文/UI = `font-sans`（Inter + PingFang 兜底）；**大标题 = `font-serif`**（衬线，Claude Design 签名；空态/大标题已用）。
- 字阶克制：正文 13–14px，次要 11px，小标签 10px + 大写字距（`uppercase tracking-wider`）。标题不夸张（近正文，靠字重/字体区分）。
- 待定：正式字体文件方向（衬线 Newsreader/思源宋体 + 无衬线），owner 拍板后统一加载。

### 1.6 密度（双刻度）
- **过程区紧凑**（小字/灰/紧内距），**最终答案舒适**（正文字阶/行高 `leading-relaxed`）。两套节奏，不一刀切。

### 1.7 图标
- 占位 3D 槽位（owner 提供素材前用虚线圆角方块）；功能图标统一 `lucide-react`，尺寸 `h-3.5/h-4`，色用 `text-muted-foreground`/语义。

---

## 2. 组件组织语言（代码形式）

### 2.1 分层
```
src/components/ui/*            ← shadcn/Radix 原语（Button/Dialog/…）：唯一的交互原语来源
src/components/claude-chat/*   ← 对话区业务组件（消费 ui/* + token）
src/routes/agents/claude-chat  ← 路由层：组装 + 取数（loader/store），尽量瘦
src/lib/hooks/*                ← 派生选择器/hook（如 use-session-workbench）：组件的数据来源
src/lib/*                      ← 纯逻辑（turn-builder、linkify、selectors），无 JSX
```

### 2.2 数据流
- **store（`chat-session-store`）= 当前会话的单一来源**；只持有当前会话数据（天然按会话隔离）。
- 组件取数走**选择器 hook**（`lib/hooks/use-session-*`），hook 用 `useMemo` 包纯函数（可单测，见 `use-session-workbench` + 其单测）。
- 业务组件**尽量呈现型**：数据靠 props 或选择器 hook，不在组件里直接 fetch。
- 多租户/隔离：任何新数据读取都确认按 `user/session` 域。

### 2.3 样式规则（强制）
- 只用 Tailwind 工具类 + **语义 token**；用 `cn()` 合并；**禁** inline hex/任意色、禁裸 px 圆角（落刻度）。
- 主操作按钮一律用 `ui/button` 的 `default` 变体（已是 tactile 陶土）；**不要再手写 `bg-primary rounded-lg` 的一次性按钮**（历史遗留逐步收口）。
- 状态 → 颜色：照 §1.2 映射，集中在一个 helper，不在各组件各写一套。

### 2.4 约定
- 不重复变体：一个职责一个组件（历史欠债：`markdown-components` 有 terminal/minimal/full 三套——保留是有意的渲染模式，但样式 token 必须一致）。
- 命名：组件 `PascalCase.tsx`，hook `use-*.ts`，纯逻辑 `kebab.ts`。
- 文件头注释写清职责 + 关联节点（如 workbench-panel 头部）。
- 每个有逻辑的选择器配单测（`tests/unit/*`）。

---

## 3. 把"对标"翻译进来的流程（配合 check 账本）

每次 check（见 `research/2026-05-conversation-ux-tree.md`）得出"采纳对方 X"时，按此落地：
1. 提炼对方的**模式**（不是它的类名/调色板）：数据结构？交互模型？信息层级？
2. 用**本规范**重述：颜色→§1.1 token、圆角→§1.3 刻度、按钮→§2.3、数据→§2.2 hook。
3. 落到现有组件（扩展/适配，最小改动），配真实对话截图验收 + 必要单测。
4. 回填 check 账本对应行（状态→✅改）+ Check 日志。

> 例：从 craft 借 `TurnPhase awaiting-gap` → 提炼为"工具完成到 final answer 之间的相位"概念，
> 用我们的 `turn-builder` 重写（不抄它的类型名/样式），状态色走 §1.2。

---

## 4. 已知一致性欠债（待逐步收口，关联 check 账本）
- D2.7 工具卡状态色硬编码 `red-500/green-500` → §1.2 token 化（下一个快赢）。
- 路由/组件里散落的一次性主按钮（手写 `bg-primary`）→ 收口到 `ui/button`。
- `code-block.tsx` 疑似硬编码色 → 待 check + token 化。
- 富代码块只有单一 CodeBlock（缺 diff/json/mermaid）→ 分阶段补，保持统一封装。
- 字体文件方向未定 → owner 拍板后统一加载（§1.5）。

---

## 5. 反过度设计（克制即设计）

**默认给用户「够用且克制」，不要一屏全抛。** 我们是终端用户产品（非开发者控制台）：
- 工程/调试信息（cwd、session-id、全量工具列表、MCP 内部状态、原始 token / 精确成本 / per-model 账本）
  **不直接铺给用户**；藏进二级（折叠「技术细节」/开发者模式/右侧 Context tab）。
- 计费按 Coze 锁定方向：**简洁「积分/用量」概念**，不是 token 账本。
- 每加一个信息块/选项前自问：**终端用户此刻需要它吗？** 不需要就降级或不放。
- 已标记的过度设计候选见 `research/2026-05-conversation-ux-tree.md` 的「过度设计观察」（owner 决策）。
