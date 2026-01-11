import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Upload } from 'lucide-react';
import { SkillUploadForm } from '~/components/skills/skill-upload-form';

/**
 * Skills Upload Route
 *
 * Allows users to upload custom skills with metadata and files.
 * Follows TanStack Start best practices:
 * - No loader needed (form is self-contained)
 * - Uses Server Functions for mutations
 * - Navigation on success
 */
export const Route = createFileRoute('/agents/skills/upload')({
  component: SkillsUploadPage,
});

function SkillsUploadPage() {
  return (
    <div className="container mx-auto py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/agents/skills"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回技能列表
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Upload className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">上传自定义 Skill</h1>
            <p className="text-muted-foreground">
              创建并上传您自己的 AI 技能。技能将存储在您的私有空间中。
            </p>
          </div>
        </div>
      </div>

      {/* Info Alert */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          关于 Skills
        </h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li>Skills 是包含 <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-mono text-xs">SKILL.md</code> 文件的代码包</li>
          <li>上传后自动启用，立即可用</li>
          <li>存储在您的私有空间（<code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-mono text-xs">.claude/skills/user/</code>）</li>
          <li>支持代码文件、配置文件、文档等多种文件类型</li>
        </ul>
      </div>

      {/* Upload Form */}
      <SkillUploadForm />

      {/* Help Section */}
      <div className="mt-8 rounded-lg border p-6">
        <h3 className="font-semibold mb-4">需要帮助？</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>SKILL.md 格式：</strong> 每个技能必须包含 <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">SKILL.md</code> 文件，使用 YAML frontmatter 定义元数据。
          </p>
          <p>
            <strong>文件结构：</strong> 支持多级目录结构，例如 <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">src/utils/helper.ts</code>
          </p>
          <p>
            <strong>资源限制：</strong> 每个技能最多 100 个文件，总大小不超过 10 MB。
          </p>
          <p>
            <strong>安全提示：</strong> 上传的技能仅在您的环境中运行，请勿上传来自不可信来源的代码。
          </p>
        </div>
      </div>
    </div>
  );
}
