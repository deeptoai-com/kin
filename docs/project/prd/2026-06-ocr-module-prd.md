# OCR 独立模块 PRD —— 扫描件识别 + 结果可视化，服务 RAG 亦可独立使用

**日期**：2026-06-13
**状态**：设计定稿（Owner 拍板：左右对照可视化 + 可插拔 VLM 引擎 doubao/Gemma），待实施
**来源**：RAG 收官后的"真必要"缺口 U3 OCR（扫描件 ingest 失败）；Owner 提升为独立模块

---

## 1. 背景与定位

RAG 落地后核实出的核心功能洞：**扫描件（无文字层 PDF / 图片）上传会直接失败**
（`ingest.ts` parseStage 返回空 → `ingestStatus='failed'`；`documents.server.ts:312` 对
`method:'ocr'` 直接 throw "U3 未接入"）。目标用户是律师/财务，手里大量是扫描合同、报表。

Owner 决策（2026-06-13 二次细化）：**OCR 是一个 VLM 引擎、三个消费者**——既是 Agent 自己
会调的工具，也是用户单独依赖的产品入口，还是 RAG 的解析后端。三者共用一套 VLM OCR 核心：

| # | 消费者 | 形态 | 谁触发 | 产物 |
|---|--------|------|--------|------|
| ① | **Agent 工具** | `ocr` MCP 工具（与 kb_search 并列注册进 worker） | **Agent 自主**——对话里遇到扫描件/图片，自己调去"读" | markdown 给模型读 |
| ② | **RAG ingest 后端** | 管线里的解析分支 | 系统——扫描件入库自动走 OCR | markdown→chunk/embed |
| ③ | **独立转换器** | 非对话工具页（最左栏第 4 模块） | **用户**——单纯要把 PDF 转 文字/MD/表格/HTML | 用户选格式、复制、导出、加入知识库 |

> **设计铁律（Owner）**：我们是 Agent 产品，OCR 必须**好用且极简**。③ 不是"OCR 查看器"，是一个
> **格式感知的转换器**——用户拖入 → 选格式 → 拿走，零向导零配置。①让 Agent "能看见"扫描件，
> ②堵上 RAG 扫描件洞，③是能脱离对话独立使用的产品入口。三皮一引擎，不做三套。

## 2. 产品决策（Owner 2026-06-13 拍板）

- **可视化形态 = 左右对照**（起点）：左栏原始扫描页图、右栏识别文本（可编辑/复制），页级
  同步。用户对照原图验证识别对不对。**bbox 叠加高亮为后续阶段**（需逐词坐标，VLM 不原生
  给，留待 grounding VLM 或经典 OCR 协同时再加）。
- **引擎 = 可插拔 VLM**（不钉死单一）：`OCR_PROVIDER` 抽象，与 `EMBED_PROVIDER` 同构。
  - `doubao`（默认）：复用 ARK 网关 + `ANTHROPIC_AUTH_TOKEN` 鉴权，打 `/v3/chat/completions`
    多模态。零新基建。**⚠️ 待补：ARK 上的 doubao vision-**chat** 模型 id**（embedding 用的
    `doubao-embedding-vision-250615` 是嵌入模型不能识别；OCR 需 vision-chat，如 `doubao-*-vision-*`）。
  - `mimo`（备选）：OpenRouter `xiaomi/mimo-v2.5`，`OPENROUTER_API_KEY` Bearer，OpenAI 格式。
    准、~14s/页、~$0.0005/页。**⚠️ mimo 是推理模型，必须传 `reasoning:{enabled:false}`**——
    否则烧 3300+ reasoning token 把预算吃光，OCR 输出空/截断。
  - **模型一律可配置**（env：`OCR_PROVIDER` / `OCR_DOUBAO_MODEL` / `OCR_MIMO_MODEL`），候选保留，
    UI 选择器读 `OCR_PROVIDERS` 注册表。**不自动路由**——provider 是显式选择（Owner 定）。
  - **引擎横评（2026-06-13，同一财报页实测）**：

    | 模型 | 准确度 | 速度 | 成本 | 结论 |
    |---|---|---|---|---|
    | ~~gemma-4-31b~~ | 差（编字/缅甸文） | 38s | $0.0004 | **淘汰** |
    | doubao-seed-2.0-mini | 好 | ~17s | ARK 额度 | **默认**（自家额度，北极星对齐） |
    | xiaomi/mimo-v2.5 | 好 | ~14s（关推理） | $0.0005 | **备选**（略快，外部付费） |
  - **实测发现**：VLM 难认单元格会**编字**（gemma 最严重）——证实 §6.1「质量徽章 + 左右对照」
    是刚需护栏（呼应 D5），非装饰。

## 3. 关键技术含义：PDF 每页栅格化（新增能力，一举两用）

「左右对照」+「VLM 吃图」共同要求一步**新能力**：**PDF → 每页 PNG**。
- 左栏展示原始扫描页 → 要页图。
- VLM OCR 的输入是图片 → 要页图。
- 落点：扩展现有 **parser sidecar**（Java，已握 PDF；用 PDFBox/pdfium 渲染页为 PNG），
  新增 `POST /render?dpi=` 返回每页 PNG（或页图存 S3 返回 key）。图片上传则跳过此步。
- 成本/延迟：N 页 = N 次 VLM 调用，须**异步 + 并发 + 进度反馈**（复用 BullMQ ingest 队列与
  `ingestStatus` 状态机模式 + 阶段5 的上传进度经验）。

## 4. 数据模型

复用 `files` / `documents`，新增 OCR 维度。最小扩展：

- **页图存储**：每页 PNG 存 S3（`ocr/<fileId>/page-<n>.png`），用于左栏展示。
- **逐页文本**：`documents.content` 存合并 markdown（与 parser 产物同格式，带 `odl-page`
  风格页码标记，**直接复用 extractPageMap + chunker**）；逐页可另存便于左右对照定位
  （`ocr_pages` 表或 `documents` 上的 jsonb，二选一，实施时定）。
- **OCR 元数据**：provider、模型、页数、识别状态/进度（挂 `documents` 或新轻表）。

> 不新建独立的 OCR 文档体系——OCR 产物就是一个"解析方式 = ocr"的 document，无缝进
> 现有文件库/知识库/RAG，避免数据孤岛。

## 5. 模块落点（已核实）

主侧边栏新增模块需 4 处小改（`app-sidebar.tsx:43` `navSections` + 图标 + `features.ts`
flag + `app.content.ts` i18n），路由 `/agents/ocr/route.tsx` 照 `documents` 骨架建。

## 6. 目标 UX 流程

### 6.1 ③ 独立转换器（极简 + 格式感知）—— 产品入口
**铁律：拖入 → 选格式 → 拿走，零向导零配置。** 上来不让选"识别模式"（默认智能识别）。
1. **空状态**：一个大拖拽区 + 一句话"拖入 PDF 或图片，转成可编辑文本"。无配置项。
2. **转换中（逐页即显）**：**不等全部跑完**——每页一识别完立刻渲染（流式，复用 seq 流/
   ingestStatus，正传 04 / D6），逐页进度"识别中 12/28 页"，可取消。
3. **结果页**：左原图 ↔ 右产物，**滚动同步**（带防循环锁）；顶部轻量**格式切换**
   `Markdown(默认) / 纯文本 / 表格 / HTML`；右侧可编辑/复制（复制按钮变✓反馈）。
4. **质量徽章（幻觉护栏，呼应 D5）**：VLM 会编字，每页挂一个轻量信号（低文字密度/乱码率/
   双引擎不一致）→ 可疑页高亮，告诉用户"重点对照原图核对这页"。对照 + 徽章 = 非技术用户敢信的前提。
5. **动作**：复制 / 导出（.md / .txt / .html / .csv）/ **加入知识库**（推进 RAG ingest）。
6. **多引擎 = 版本对比**（吸收前作 VariantTabs）：默认单引擎；"换 Gemma 再试一次"是**一键次要动作**，
   两个 VLM 对同页的识别并排对比、择优——不是上来就让选 provider。

> **格式实现取舍**：VLM 一次抽成 **Markdown 母格式**（最通用，含标题+表格+页码标记）；切到
> 纯文本 / HTML 是**本地转换**（零额外调用、瞬时）；仅"复杂表格精确还原 / CSV"按需再走一次
> VLM 或专门 prompt。默认 Markdown。极简的关键：转换一次，格式在结果上即时切换，不重新跑。

### 6.2 ① Agent 工具（`ocr` MCP）—— 让 Agent 能"看见"扫描件
- 与 `kb_search`/python/glm-image 并列，`createSdkMcpServer` 注册进 `ws-query-worker.mjs`。
- 入参：workspace 文件路径 / fileId（+ 可选目标页范围）。出参：markdown（含页码），Agent 读。
- 触发：对话里用户上传扫描件/图片并提问，Agent 自主调用（呼应 `ws-adapter.ts` 已有的
  "扫描件用 OCR 工具" hint——hint 在、工具此前没接）。
- 这是 D1 RAG"检索是工具"同款哲学：**OCR 也是 Agent 自己会调的一把工具，不是前处理**。

### 6.3 ② 服务 RAG（堵洞）
- ingest parseStage 检测到扫描件（probe 推荐 ocr）→ 走 OCR provider 而非 opendataloader。
- OCR 产物 markdown + 页码 → **复用现有 extractPageMap → chunker → embed**，零改检索侧。
- 即 D1 RAG 的"打脸②解析定上限"再进一步：解析后端从"有字层 PDF"扩到"扫描件"。

## 7. 分阶段实施

| 阶段 | 范围 | 消费者 | 状态 |
|---|---|---|---|
| **O1 引擎 + 双消费者后端** | ✅ a provider 抽象(doubao+mimo) / b parser `/render` / c ingest 扫描件分支(堵U3) / d `/api/ocr`+`ocr` MCP 工具。分支 `feat/ocr-provider`，全部实测验证。**未部署**（待 O2 或单独上） | ①② | ✅ **完成** |
| **O2 独立转换器（极简产品）** | ✅ 主栏第 4 模块「文字识别」+ `/agents/ocr` + 拖拽空状态 + 逐页即显(并发2) + 左右对照结果页 + 格式切换(MD/文本/HTML 本地派生) + 复制/导出/加入知识库 + `/api/ocr/render`。**已部署 oxygenie.cc**（app+worker+parser 重建，OCR env 接线，全栈健康验证通过） | ③ | ✅ **完成·已上线** |
| O2 后续打磨 | 质量徽章（VLM 幻觉护栏）、滚动同步、表格→CSV、bbox(O4) | ③ | ⬜ 待 Owner 实测反馈 |
| **O3 gemma provider** | 填入 Owner 提供的 Gemma 配置（端点/鉴权/模型），provider 选择器；同文件换引擎对比 | 全 | 中（待 Owner 给配置） |
| **O4 bbox 叠加（可选后续）** | grounding VLM 或经典 OCR 协同出坐标 → 点文本高亮原图区域 | ③ | 低（验证好用再做） |

## 8. 明确不做（暂）

- bbox 逐词坐标叠加（O4，需坐标源，起点不做）。
- 经典 OCR 引擎（Tesseract/Paddle）——VLM 中文/表格精度更高，且零新基建；除非 O4 需坐标。
- 手写体专项优化、表格结构化抽取（VLM markdown 表格够用，进阶后置）。

## 9. 风险/坑

- **页图栅格化的 DPI / 体积**：DPI 太低 VLM 识别差、太高图大且 VLM 慢，需调（默认 ~150-200）。
- **VLM 逐页成本/延迟**：28 页 = 28 次调用，必须异步 + 并发 + 进度；大文档给取消能力。
- **VLM 幻觉**：识别可能编字（呼应 D5）；左右对照 + 质量徽章让用户能对原图校验，是必备护栏不是装饰。
- **provider 抽象别过早**：先 doubao 跑通端到端，gemma 按同接口填，不为"可插拔"过度设计。

## 10. 从前作（olmOCR / DeepSeek-OCR-Web）吸收的交互（Owner 旧项目复盘）

Owner 之前做过两个 VLM-OCR Web 应用（`ds-ocr/olm.red`、`ds-ocr/DeepSeek-OCR-Web`），交互细节
考虑得多，但自评"做得不是很好"——audit 报告自己 flag 了复杂度蔓延。**取其交互精华，弃其臃肿。**

**搬过来（4 个真升级）**：
1. **逐页即显（流式）**：两前作共同第一课，不等全部跑完，每页完成即渲染。
2. **多引擎=版本对比**：前作 VariantTabs（Primary/Re-OCR 并排）→ doubao/Gemma 并排择优，一键次要动作。
3. **质量徽章=幻觉护栏**：前作在缩略图挂 risk_score 徽章 → 可疑页高亮，对照+徽章接合"可视化"与 D5 护栏。
4. **滚动同步（50ms 防循环锁）+ 复制变✓ + 字号存 localStorage**：便宜的体验细节，直接搬。

**不搬（守极简，前作 audit 也认这是问题）**：三栏布局 + 文件列表吸附 + variant tabs 当主 UI +
表格 SQL 验证 + 沉浸阅读模式 + 三视图切换 + 一堆字号档。这些把前作做重了，OxyGenie 不要。

**白捡的坑（前作踩过）**：SSE 多消息 state 竞态用 reducer（别 N 次 setState）；EventSource/长任务
要可取消+超时 cleanup；签名图 URL 会过期；批量并发要封顶（否则连接/内存爆）；localStorage key 加
应用前缀防冲突；DnD 用 pointer events 比 drag 计数可靠。

**prompt 模式 ≠ 输出格式（澄清）**：前作用识别模式（通用/表格/手写/描述，改 prompt）；本设计用
输出格式（MD/文本/HTML，本地转换）。极简取法：不前置模式选择，输出格式结果上即时切；"手写/表格
优先"仅作质量差时的"换模式重识别"二次动作。
