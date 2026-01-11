/**
 * AI Workflow Hub (Index Route)
 *
 * 工作流列表页面。当访问 /agents/ai-workflow 时显示此内容。
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AuthLoading, RedirectToSignIn, SignedIn } from '@daveyplate/better-auth-ui';
import { ArrowRight, FileText, FileCheck, Sparkles } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';

export const Route = createFileRoute('/agents/ai-workflow/')({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <div className="container mx-auto h-full px-4 py-6">
      <AuthLoading>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          正在检查登录状态…
        </div>
      </AuthLoading>

      <RedirectToSignIn />

      <SignedIn>
        <WorkflowHub />
      </SignedIn>
    </div>
  );
}

// ============================================================================
// Workflow Hub (List View)
// ============================================================================

interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: 'active' | 'coming-soon' | 'beta';
  tags: string[];
}

const workflows: WorkflowDefinition[] = [
  {
    id: 'pr-creator',
    name: 'PR Creator',
    description:
      '智能 PR 稿件创作工作流。输入 Brief 和 Facts，AI 分析并提出澄清问题，最终生成专业的公关稿件。',
    icon: FileText,
    status: 'beta',
    tags: ['AI 写作', '公关稿件', '内容生成'],
  },
  {
    id: 'file-summary',
    name: 'File Summary',
    description: '分析文件内容，提取关键信息和统计数据。支持多种文件格式。',
    icon: FileCheck,
    status: 'coming-soon',
    tags: ['文件分析', '数据提取'],
  },
];

function WorkflowHub() {
  const navigate = useNavigate();

  const handleSelectWorkflow = (workflowId: string) => {
    navigate({
      to: `/agents/ai-workflow/${workflowId}` as any,
    });
  };

  return (
    <div className="flex h-full flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Workflow</h1>
        <p className="text-muted-foreground">
          选择一个工作流开始创作。每个工作流都是一个多步骤的智能流程。
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {workflows.map((workflow) => (
          <WorkflowCard
            key={workflow.id}
            workflow={workflow}
            onSelect={() => handleSelectWorkflow(workflow.id)}
          />
        ))}

        <Card className="border-dashed opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="h-5 w-5" />
              更多工作流
            </CardTitle>
            <CardDescription>更多智能工作流即将推出…</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              我们正在开发更多场景化的工作流，包括市场分析、竞品研究、内容改写等。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onSelect,
}: {
  workflow: WorkflowDefinition;
  onSelect: () => void;
}) {
  const Icon = workflow.icon;
  const isDisabled = workflow.status === 'coming-soon';

  return (
    <Card
      className={`group relative transition-all hover:shadow-md ${
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{workflow.name}</CardTitle>
              <StatusBadge status={workflow.status} />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <CardDescription className="line-clamp-2">{workflow.description}</CardDescription>

        <div className="flex flex-wrap gap-1">
          {workflow.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>

        {!isDisabled && (
          <Button className="w-full" onClick={onSelect}>
            开始使用
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}

        {isDisabled && (
          <Button disabled className="w-full">
            即将推出
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: WorkflowDefinition['status'] }) {
  switch (status) {
    case 'active':
      return (
        <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50">
          可用
        </Badge>
      );
    case 'beta':
      return (
        <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50">
          Beta
        </Badge>
      );
    case 'coming-soon':
      return (
        <Badge variant="outline" className="text-xs text-gray-500">
          即将推出
        </Badge>
      );
  }
}
