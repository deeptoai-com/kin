# AI Workflow 架构规范

## 核心原则

**每个 Workflow 必须是独立的、自包含的单元。**

## 目录结构规范

```
ai-workflow/
├── CLAUDE.md              # 本文档：架构规范（必读）
├── route.tsx              # WorkflowHub 列表页（仅此用途）
│
├── pr-creator/            # Workflow 1: PR Creator
│   ├── CLAUDE.md          # Workflow 专属开发文档
│   └── route.tsx          # Workflow 完整实现
│
├── file-summary/          # Workflow 2: File Summary
│   ├── CLAUDE.md
│   └── route.tsx
│
└── [new-workflow]/        # 新增 Workflow 模板
    ├── CLAUDE.md
    └── route.tsx
```

## 严格禁止事项

### 1. 主 route.tsx 禁止包含 Workflow 实现

❌ **错误**：在 `ai-workflow/route.tsx` 中实现 `PRCreatorWorkflow` 组件
✅ **正确**：`ai-workflow/route.tsx` 只包含 `WorkflowHub` 列表页

### 2. 禁止使用 Search Params 切换 Workflow

❌ **错误**：`/agents/ai-workflow?workflow=pr-creator`
✅ **正确**：`/agents/ai-workflow/pr-creator`

### 3. 禁止跨 Workflow 共享状态

每个 Workflow 是独立的，不应共享 React 状态。

## 新增 Workflow 检查清单

创建新 Workflow 时，必须完成以下步骤：

- [ ] 在 `ai-workflow/` 下创建新目录 `[workflow-id]/`
- [ ] 创建 `[workflow-id]/CLAUDE.md` 文档
- [ ] 创建 `[workflow-id]/route.tsx` 页面组件
- [ ] **【重要】在 `ai-workflow/route.tsx` 添加 `useMatch` 检测新路由**
- [ ] 在 `ai-workflow/route.tsx` 的 `workflows` 数组添加卡片信息
- [ ] 在 `src/mastra/workflows/` 创建 `[workflow-id].workflow.ts`
- [ ] 在 `src/mastra/workflows/index.ts` 导出 workflow
- [ ] 在 `src/mastra/index.ts` 注册 workflow
- [ ] 创建 API 端点 `src/routes/api/workflow/[workflow-id]/start.tsx`
- [ ] 创建 API 端点 `src/routes/api/workflow/[workflow-id]/resume.tsx`（如需 suspend/resume）

## 文件职责说明

| 文件 | 职责 | 允许的内容 |
|------|------|------------|
| `ai-workflow/route.tsx` | WorkflowHub 列表页 | 仅 `WorkflowHub`、`WorkflowCard`、`StatusBadge` 组件 |
| `[workflow]/route.tsx` | Workflow 完整实现 | 该 Workflow 的所有 UI 组件和状态逻辑 |
| `[workflow]/CLAUDE.md` | Workflow 开发文档 | 数据模型、API、开发约束 |

## TanStack Router 嵌套路由规则（重要！）

### 问题背景

TanStack Router 使用文件系统路由。当子目录包含 `route.tsx` 时，会形成**嵌套路由**关系：
- 父路由：`ai-workflow/route.tsx`
- 子路由：`ai-workflow/pr-creator/route.tsx`

**嵌套路由的核心规则**：父路由必须提供 `<Outlet />` 组件来渲染子路由内容，否则子路由页面无法显示。

### 当前实现模式

`ai-workflow/route.tsx` 采用**条件渲染**模式：

```typescript
import { Outlet, useMatch } from '@tanstack/react-router';

function RouteComponent() {
  // 检查是否有子路由匹配
  const prCreatorMatch = useMatch({
    from: '/agents/ai-workflow/pr-creator',
    shouldThrow: false,
  });

  const hasChildRoute = !!prCreatorMatch;

  // 如果有子路由匹配，渲染 Outlet（子路由内容）
  if (hasChildRoute) {
    return <Outlet />;
  }

  // 否则渲染 WorkflowHub（列表页）
  return <WorkflowHub />;
}
```

### 新增 Workflow 时必须更新路由匹配

当添加新的 Workflow（如 `file-summary`）时，**必须**更新父路由的匹配逻辑：

```typescript
function RouteComponent() {
  const prCreatorMatch = useMatch({
    from: '/agents/ai-workflow/pr-creator',
    shouldThrow: false,
  });

  // 新增：检测 file-summary 路由
  const fileSummaryMatch = useMatch({
    from: '/agents/ai-workflow/file-summary',
    shouldThrow: false,
  });

  const hasChildRoute = !!prCreatorMatch || !!fileSummaryMatch;

  // ... 其余逻辑不变
}
```

### 常见错误

❌ **错误**：只添加子目录 `workflow/route.tsx`，不更新父路由
- 结果：点击按钮无反应，子路由页面无法显示

✅ **正确**：同时更新父路由的 `useMatch` 检测逻辑

## WorkflowHub 导航规则

```typescript
// ai-workflow/route.tsx 中的导航逻辑
const handleSelectWorkflow = (workflowId: string) => {
  navigate({
    to: `/agents/ai-workflow/${workflowId}`,
  });
};
```

点击卡片 → 跳转到独立页面，**不是**切换 search params。

## 相关文件位置

- Mastra Agents: `src/mastra/agents/`
- Mastra Workflows: `src/mastra/workflows/`
- Workflow API: `src/routes/api/workflow/[workflow-id]/`
- 主项目 CLAUDE.md: `/constructa-starter/CLAUDE.md`
