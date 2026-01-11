# PR Creator Workflow

> **重要**：开发前请先阅读上级目录的 `ai-workflow/CLAUDE.md` 了解架构规范。

## 概述

PR Creator 是一个智能 PR 稿件创作工作流，使用 Mastra AI SDK 实现多步骤的 Human-in-the-Loop 交互。

## 本目录文件

```
pr-creator/
├── CLAUDE.md          # 本文档
└── route.tsx          # 完整的前端页面实现
```

## 关联文件（不在本目录）

| 文件 | 路径 | 职责 |
|------|------|------|
| Agent 定义 | `src/mastra/agents/pr-writer-agent.ts` | PR 写作 Agent |
| Workflow 定义 | `src/mastra/workflows/pr-creator.workflow.ts` | 工作流步骤定义 |
| Start API | `src/routes/api/workflow/pr-creator/start.tsx` | 启动工作流 |
| Resume API | `src/routes/api/workflow/pr-creator/resume.tsx` | 恢复工作流 |

## 开发约束

### 1. 本 route.tsx 必须是自包含的

所有 PR Creator 相关的 React 组件都在 `route.tsx` 中定义：
- `PRCreatorWorkflow` - 主组件
- `InputStep` - 输入步骤
- `ClarifyStep` - 澄清步骤
- `ReviewStep` - 审核步骤
- `DoneStep` - 完成步骤
- `StepIndicator` - 进度指示器
- `LoadingStep` - 加载状态

### 2. 禁止在上级 ai-workflow/route.tsx 添加任何本 Workflow 代码

❌ 错误：在 `ai-workflow/route.tsx` 中添加 `PRCreatorWorkflow` 组件
✅ 正确：所有实现都在 `pr-creator/route.tsx` 中

### 3. 数据模型必须与后端 Schema 保持一致

前端 `FactsData` 接口：
```typescript
interface FactsData {
  rawContent: string;  // 唯一字段，用于粘贴原始素材
}
```

后端 `factsSchema`（在 `pr-creator.workflow.ts`）：
```typescript
const factsSchema = z.object({
  rawContent: z.string().min(1).describe('品牌方提供的原始素材文本'),
});
```

**修改任何一方时，必须同步更新另一方。**

## 工作流步骤

| Step ID | 名称 | 是否 Suspend |
|---------|------|--------------|
| `analyze-brief` | 分析 Brief | 否 |
| `clarify-questions` | 澄清问题 | **是** |
| `generate-draft` | 生成稿件 | 否 |
| `human-review` | 人工审核 | **是** |
| `finalize` | 最终输出 | 否 |

## API 调用模式

### 启动工作流
```typescript
POST /api/workflow/pr-creator/start
Body: { brief, facts: { rawContent }, additionalNotes }
Response: { runId, status, suspendedStep?, suspendPayload? }
```

### 恢复工作流
```typescript
POST /api/workflow/pr-creator/resume
Body: { runId, step, resumeData }
Response: { runId, status, suspendedStep?, suspendPayload?, result? }
```

## Mastra SDK 关键模式

### 1. suspended 数组可能是嵌套的

```typescript
// result.suspended 可能是 ["stepId"] 或 [["stepId"]]
const suspendedEntry = result.suspended?.[0];
let stepId: string;
if (typeof suspendedEntry === 'string') {
  stepId = suspendedEntry;
} else if (Array.isArray(suspendedEntry)) {
  stepId = suspendedEntry[suspendedEntry.length - 1];
}
```

### 2. suspendPayload 访问路径

```typescript
const suspendPayload = result.steps?.[stepId]?.suspendPayload;
```

### 3. GLM 模型需要 jsonPromptInjection

```typescript
const response = await agent.generate(prompt, {
  structuredOutput: {
    schema: mySchema,
    jsonPromptInjection: true,  // GLM 不支持原生 response_format
    errorStrategy: 'fallback',
    fallbackValue: { ... },
  },
});
```

## Agent 风格配置

PR Writer Agent 使用"说服"写作风格（见 `pr-writer-agent.ts`）：
- 核心信息清晰，背景适度模糊
- 克制是最大的力量
- 800-1500 字篇幅

修改 Agent 指令时，需同时更新 `generate-draft` 步骤中的 prompt 以保持一致。
