# Phase 3 — UI/UX 设计语言 + 信息架构（设计定调）

> 日期：2026-05-31 · 作者：agent · 状态：**方向已与负责人锁定，待 Wave 0 细化**
> 关联实施计划：`docs/project/PHASE3-PLAN.md`

## 0. 已锁定的决策（负责人确认）

1. **重做设计语言，保留 shadcn/Radix 地基**（换"皮"不换"骨"——见 §2 工程依据）。
2. **主基调 = Coze 外壳气质 + Cowork 工作台深度**（参考产品：Coze/扣子 + Claude Cowork）。
3. **3D 拟物图标**：负责人后续提供素材；代码侧**预留图标槽位、先用占位**（精致扁平图标或占位框），素材到位后替换。
4. **守住边界**：我们是 **web 端 + 多租户 + 隔离工作区**；参考产品是桌面/单用户/本地文件——
   **UI 形态可借鉴，数据模型/隔离不可照搬**（这是护城河）。

## 1. 设计气质（综合两参考的实测观察）

- **Coze（外壳）**：浅色主导、大留白、低饱和、大圆角、3D 拟物彩色图标、拟人化 agent（头像+在线状态+人格开场）、**计费透明**（积分可见、"消耗取决于任务量"）、IM 式会话列表、底部输入框为焦点（+ / 模型选择 Auto / 发送）。
- **Cowork（骨架/深度）**：三栏 + **右侧常驻工作台**（Progress / Files / Context），工具感、信息密度高、`Ask/Act` 模式、衬线标题。

**融合定调**：外观温暖克制（Coze），结构专业可观测（Cowork）。对话区低密度、温暖；右侧工作台中高密度、结构化。

## 2. 工程依据（为何"换皮不换骨"可行，已核实）

- design token 已集中在 **`src/styles/app.css`**（Tailwind v4 `@theme` + shadcn 变量
  `--background/--foreground/--primary/--card/...` + `.dark` 暗色），另有 `src/styles/tokens.css`（品牌色）。
- **改 token 值即可全局换肤**：35 个 `src/components/ui/*` 组件大多直接消费这些 CSS 变量；
  76 个业务组件只引用 `<Button>/<Dialog>` 等，token 变它们自动变。
- **无需**：重写 76 个业务组件、卸载 21 个 Radix 包、重写交互原语。
- 弃用 Radix = 巨大无效工作量（重写无障碍/键盘/焦点），**明确不做**。

## 3. 目标信息架构：从"聊天框"升级为"agent 工作台"

```
┌─ 左：会话/任务导航（窄图标栏 + IM 式会话列表，Coze 风）
├─ 中：对话流（收敛、低密度、温暖；只放"人 ↔ agent 对话"）
│        · 轻气泡/无气泡，消息融入背景
│        · 工具调用 = 可展开卡片（输入/输出/状态/耗时）
│        · 底部输入框为焦点：+ / Ask·Act 模式 / 模型选择 / 发送 / 积分提示
└─ 右：常驻工作台（可切换分区，Cowork 风）
         ├ Progress（① TodoWrite 实时勾选）
         ├ Sub-agents（② 嵌套树，用已有 parent_tool_use_id）
         ├ Files / Artifacts（已有 session-files-panel / artifacts-panel 增强）
         └ Context（⑤ 记忆 / 连接器 / 本月用量——接 Phase 2 的 usage 数据）
```

**核心转变**：把"过程信息"（在做什么/跑到哪/改了哪些文件/要不要批准）从对话流搬到右侧结构化面板。

**响应式**（我们是 web，必做，参考产品桌面端没解决）：窄屏右侧工作台降级为可切换抽屉/底部 tab。

## 4. design token 方向（Wave 0 细化成具体数值）

| Token | 方向 |
|---|---|
| 色彩 | 浅色主导、低饱和；品牌色克制点缀；暗色同样克制 |
| 留白 | 大（对话区尤其） |
| 圆角 | 大（输入框/卡片/气泡，沿用 `--radius-lg/xl`） |
| 字体 | 正文无衬线（Inter/PingFang）；标题可选衬线增质感 |
| 密度 | 对话区低密度；工作台面板中高密度 |
| 阴影 | 柔和（沿用 `--shadow-soft` 方向） |
| 图标 | 3D 拟物（占位先行，槽位预留） |

## 5. 与现有资产的映射（已核实，避免重造）

| Phase 3 需求 | 现有资产 | 动作 |
|---|---|---|
| ① Todo 面板 | 无 | 新建 `todo-panel.tsx` + adapter 认 TodoWrite |
| ② 子 agent 面板 | adapter 已用 `parent_tool_use_id` | 新建嵌套渲染，去正则 |
| ⑥ Ask/Act 模式 | `permission-badge.tsx`（已有 `PermissionMode`） | 扩展成模式开关 |
| 文件/Artifacts | `session-files-panel` / `artifacts-panel` / `artifact-*` | 增强并入右侧工作台 |
| 技能商店 | 现有 Skills Store | 重做成 Coze 卡片网格（图标+一键添加+子技能芯片+分类 tab） |
| Context/用量 | Phase 2 `usage_record`（#55） | 右侧 Context 展示本月用量 |

## 6. 风险

- **3D 图标素材依赖负责人**——未到位前用占位，视觉温度打折（已知并接受）。
- **设计师缺位**：token 数值/布局 agent 能落，但"惊艳的视觉判断"需负责人把关或借助设计 skill；Wave 0 应产出可选风格方向供拍板。
- **多租户隔离**：每个新面板都要确认数据按 user/session 隔离（守住护城河）。

## 7. 下一步（见 PHASE3-PLAN.md）

Wave 0（设计稿+token，本档）→ Wave 1（工作台骨架 + ①② 前端线）→ Wave 2（Ask/Act + ③HITL）→ Wave 3（④检查点 + ⑤记忆）；⑥技术债随时插，视觉打磨放每 Wave 尾。
