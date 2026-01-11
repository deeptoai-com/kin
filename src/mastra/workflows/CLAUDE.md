# Workflow 构建规范（AI 参考手册）

> 本文档为 AI 提供快速参考。完整指南见 `docs/5. 研发实施/3. 实施指南/Workflow构建指南.md`

## 📁 标准文件结构

创建新 Workflow 时必须遵循以下结构：

```
workflow-name/
├── src/mastra/agents/[workflow-name]-agent.ts
├── src/mastra/workflows/[workflow-name].workflow.ts
├── src/mastra/tools/[tool-name].ts (可选)
├── src/routes/api/workflow/[workflow-name]/start.tsx
├── src/routes/api/workflow/[workflow-name]/resume.tsx
└── src/routes/agents/ai-workflow/[workflow-name]/
    ├── route.tsx
    └── CLAUDE.md
```

## 📊 步骤类型速查表

| 类型 | suspend? | 用途 | 参考实现 |
|------|----------|------|----------|
| **Analysis** | ❌ | 分析输入，生成结构化洞察 | `pr-creator: analyzeBriefStep` |
| **Clarification** | ✅ | 人工澄清/补充信息 | `pr-creator: clarifyQuestionsStep` |
| **Generation** | ❌ | AI 生成核心内容 | `pr-creator: generateDraftStep` |
| **Review** | ✅ | 人工审核/决策 | `pr-creator: humanReviewStep` |
| **Revision** | ❌ | 基于反馈修改 | `pr-creator: reviseDraftStep` |
| **Final Review** | ✅ | 二次审核 | `pr-creator: humanReviewFinalStep` |
| **Finalize** | ❌ | 组装最终输出 | `pr-creator: finalizeStep` |

## 🔧 核心规则

### 1. Schema 设计
- **必须**使用 Zod 定义所有 Schema
- **必须**为每个字段添加 `.describe()` 帮助 AI 理解
- **避免**过深嵌套（建议 ≤3 层）
- **优先**使用扁平化结构

### 2. Structured Output (GLM 兼容)
```typescript
const response = await agent.generate(prompt, {
  structuredOutput: {
    schema: yourSchema,
    jsonPromptInjection: true,  // 必须！GLM 不支持原生 response_format
    errorStrategy: 'fallback',
    fallbackValue: { /* 默认值 */ },
  },
});
```

### 3. Suspend/Resume 模式
```typescript
// Suspend Step 标准结构
const step = createStep({
  id: 'step-id',
  inputSchema: z.object({...}),
  outputSchema: z.object({...}),
  suspendSchema: z.object({...}),  // 传给前端的数据
  resumeSchema: z.object({...}),   // 前端返回的数据
  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
    if (resumeData) {
      // 恢复逻辑：使用 suspendData 恢复上下文
      return {
        ...suspendData?.savedContext,
        userInput: resumeData,
      };
    }
    // 暂停逻辑
    return await suspend({ /* 传给前端的数据 */ });
  },
});
```

### 4. Conditional Routing (NEW!)
```typescript
export const workflow = createWorkflow({...})
  .then(step1)
  .then(step2)
  .then(async (ctx) => {
    // 条件路由示例
    const { approved, feedback } = ctx.output;

    if (approved) {
      return { /* 直接进入下一步 */ };
    } else {
      // 执行额外步骤
      const revised = await revisionStep.execute({
        inputData: { feedback, ...ctx.output },
        mastra: ctx.mastra,
        writer: ctx.writer,
      });

      const finalReview = await finalReviewStep.execute({
        inputData: revised,
        suspend: ctx.suspend,
        resumeData: ctx.resumeData,
        suspendData: ctx.suspendData,
      });

      return finalReview;
    }
  })
  .then(finalizeStep)
  .commit();
```

## 📝 代码模板速查

### 模板 1: Analysis Step
```typescript
const analyzeStep = createStep({
  id: 'analyze-input',
  description: '分析用户输入',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    analysis: analysisResultSchema,
    originalInput: workflowInputSchema,
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('your-agent');

    const prompt = `请分析以下输入...`;

    const response = await agent.generate(prompt, {
      structuredOutput: {
        schema: analysisResultSchema,
        jsonPromptInjection: true,
        errorStrategy: 'fallback',
        fallbackValue: { /* 默认值 */ },
      },
    });

    return {
      analysis: response.object!,
      originalInput: inputData,
    };
  },
});
```

### 模板 2: Human-in-the-Loop Step
```typescript
const reviewStep = createStep({
  id: 'human-review',
  description: '人工审核',
  inputSchema: z.object({ result: resultSchema }),
  outputSchema: z.object({
    result: resultSchema,
    approved: z.boolean(),
    feedback: z.string().optional(),
  }),
  suspendSchema: z.object({
    message: z.string(),
    result: resultSchema,
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
    if (resumeData) {
      return {
        result: suspendData?.result || inputData.result,
        approved: resumeData.approved,
        feedback: resumeData.feedback,
      };
    }

    return await suspend({
      message: '请审核结果',
      result: inputData.result,
    });
  },
});
```

### 模板 3: 多语言生成（参考 PR Creator）
```typescript
const generateStep = createStep({
  id: 'generate-content',
  execute: async ({ inputData, mastra, writer }) => {
    const results: Result[] = [];

    for (let i = 0; i < inputData.languages.length; i++) {
      const langCode = inputData.languages[i];

      // 进度通知
      await writer?.custom({
        type: 'progress',
        data: {
          status: 'in-progress',
          message: `正在生成 ${langCode} 版本...`,
          current: i + 1,
          total: inputData.languages.length,
        },
      });

      const response = await agent.generate(prompt, {...});
      results.push({ ...response.object!, language: langCode });
    }

    return { results };
  },
});
```

## 🎯 前端实现规则

### 1. 状态管理标准
```typescript
function WorkflowComponent() {
  // 流程控制状态（通用）
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('input');
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 业务数据状态（定制）
  const [inputData, setInputData] = useState({...});
  const [result, setResult] = useState(null);
}
```

### 2. Suspend 数据解析
```typescript
// PR Creator 实践：处理嵌套的 suspended 数组
if (result.suspended) {
  const suspendedEntry = result.suspended[0];
  let stepId: string;

  if (typeof suspendedEntry === 'string') {
    stepId = suspendedEntry;
  } else if (Array.isArray(suspendedEntry)) {
    stepId = suspendedEntry[suspendedEntry.length - 1];
  }

  const suspendPayload = result.steps?.[stepId]?.suspendPayload;
  // 使用 suspendPayload 更新前端状态
}
```

### 3. UI 组件结构
```tsx
<WorkflowComponent>
  <Header>
    <BackButton />
    <Title />
  </Header>

  <StepIndicator currentStep={currentStep} />

  {error && <ErrorAlert>{error}</ErrorAlert>}

  <StepContent>
    {currentStep === 'input' && <InputStep {...} />}
    {currentStep === 'processing' && <LoadingStep message="..." />}
    {currentStep === 'review' && <ReviewStep {...} />}
    {currentStep === 'done' && <DoneStep {...} />}
  </StepContent>
</WorkflowComponent>
```

## 🔍 参考实现：PR Creator

**完整实现路径**：
- Agent: `src/mastra/agents/pr-writer-agent.ts`
- Workflow: `src/mastra/workflows/pr-creator.workflow.ts`
- Frontend: `src/routes/agents/ai-workflow/pr-creator/route.tsx`

**关键特性**：
- ✅ Multi-language generation（批量生成多语言版本）
- ✅ Conditional routing（基于 approved 字段路由）
- ✅ Revision workflow（支持一次修改循环）
- ✅ Progress notifications（使用 writer.custom()）
- ✅ Word count constraints（动态字数范围）

**可复用模式**：
1. `SUPPORTED_LANGUAGES` 常量定义
2. `outputConfig` 配置结构（languages + wordCountRange）
3. Tab 切换 UI（多语言预览）
4. Feedback 表单（Reject → Revision 流程）

## 📋 实施 Checklist

创建新 Workflow 时，按顺序完成：

- [ ] 定义 inputSchema 和 outputSchema
- [ ] 创建 Agent（编写 instructions）
- [ ] 实现各个 Step（使用上述模板）
- [ ] 组装 Workflow（.then() 链式调用）
- [ ] 创建 API 端点（start.tsx, resume.tsx）
- [ ] 实现前端 UI（route.tsx）
- [ ] 测试完整流程
- [ ] 编写文档（CLAUDE.md）

## ⚠️ 常见错误

1. **忘记 jsonPromptInjection** → GLM 模型无法返回 JSON
2. **suspendData 未保存上下文** → resume 时数据丢失
3. **Frontend 未处理嵌套 suspended** → 无法正确恢复
4. **未提供 fallbackValue** → 结构化输出失败时中断
5. **未添加 writer.custom()** → 前端无进度提示

## 📚 详细文档

完整指南、案例分析、Troubleshooting 请查阅：
👉 `docs/5. 研发实施/3. 实施指南/Workflow构建指南.md`
