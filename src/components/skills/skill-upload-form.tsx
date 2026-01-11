import { FC, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { uploadUserSkillFn } from '~/server/function/skills.server';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Label } from '~/components/ui/label';
import { Plus, Trash2, Upload, FileCode } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

interface SkillFile {
  path: string;
  content: string;
}

interface SkillUploadFormProps {
  onSuccess?: () => void;
}

/**
 * Skills Upload Form Component
 *
 * Allows users to upload custom skills with metadata and files.
 * Follows TanStack Start best practices with Server Functions.
 */
export const SkillUploadForm: FC<SkillUploadFormProps> = ({ onSuccess }) => {
  const navigate = useNavigate();
  const uploadSkill = useServerFn(uploadUserSkillFn);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('productivity');
  const [files, setFiles] = useState<SkillFile[]>([
    { path: 'SKILL.md', content: defaultSkillTemplate }
  ]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add new file
  const handleAddFile = () => {
    const newFileName = `file-${files.length}.md`;
    setFiles([...files, { path: newFileName, content: '' }]);
  };

  // Remove file
  const handleRemoveFile = (index: number) => {
    if (files.length === 1) {
      setError('至少需要保留一个文件');
      return;
    }
    setFiles(files.filter((_, i) => i !== index));
  };

  // Update file path
  const handleUpdateFilePath = (index: number, newPath: string) => {
    const updated = [...files];
    updated[index].path = newPath;
    setFiles(updated);
  };

  // Update file content
  const handleUpdateFileContent = (index: number, newContent: string) => {
    const updated = [...files];
    updated[index].content = newContent;
    setFiles(updated);
  };

  // Validate form
  const validateForm = (): string | null => {
    if (!name.trim()) {
      return '技能名称不能为空';
    }
    if (name.length > 50) {
      return '技能名称不能超过50个字符';
    }
    if (files.length === 0) {
      return '至少需要一个文件';
    }
    if (files.length > 100) {
      return '文件数量不能超过100个';
    }
    const totalSize = files.reduce((sum, f) => sum + f.content.length, 0);
    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (totalSize > maxSize) {
      return `技能总大小不能超过10 MB（当前：${(totalSize / 1024 / 1024).toFixed(2)} MB）`;
    }
    for (const file of files) {
      if (!file.path.trim()) {
        return '文件路径不能为空';
      }
      if (file.path.includes('..')) {
        return '文件路径不能包含 ".."';
      }
    }
    return null;
  };

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsUploading(true);

    try {
      await uploadSkill({
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || 'productivity',
          files: files.map(f => ({
            path: f.path.trim(),
            content: f.content,
          })),
        },
      });

      // Success: navigate back to skills list
      navigate({ to: '/agents/skills' });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Metadata Card */}
      <Card>
        <CardHeader>
          <CardTitle>技能元数据</CardTitle>
          <CardDescription>
            填写技能的基本信息
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              技能名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：my-custom-skill"
              disabled={isUploading}
              maxLength={50}
            />
            <p className="text-xs text-muted-foreground">
              {name.length}/50 字符
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述这个技能的功能..."
              disabled={isUploading}
              rows={3}
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">分类</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isUploading}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="development">Development</option>
              <option value="productivity">Productivity</option>
              <option value="design">Design</option>
              <option value="integration">Integration</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Files Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>技能文件</CardTitle>
              <CardDescription>
                定义技能的代码和配置文件（至少需要一个 SKILL.md）
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddFile}
              disabled={isUploading}
            >
              <Plus className="h-4 w-4 mr-2" />
              添加文件
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {files.map((file, index) => (
            <div key={index} className="space-y-2 rounded-lg border p-4">
              {/* File Header */}
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={file.path}
                  onChange={(e) => handleUpdateFilePath(index, e.target.value)}
                  placeholder="file-path.md"
                  disabled={isUploading}
                  className="flex-1"
                />
                {files.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(index)}
                    disabled={isUploading}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* File Content */}
              <Textarea
                value={file.content}
                onChange={(e) => handleUpdateFileContent(index, e.target.value)}
                placeholder={`File content for ${file.path}...`}
                disabled={isUploading}
                rows={file.path === 'SKILL.md' ? 15 : 8}
                className="font-mono text-sm"
              />

              {/* File Size */}
              <p className="text-xs text-muted-foreground text-right">
                {(file.content.length / 1024).toFixed(2)} KB
              </p>
            </div>
          ))}

          {/* Total Size */}
          <div className="text-sm text-muted-foreground">
            总大小：{(files.reduce((sum, f) => sum + f.content.length, 0) / 1024).toFixed(2)} KB / 10 MB
            {' • '}
            文件数：{files.length} / 100
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: '/agents/skills' })}
          disabled={isUploading}
        >
          取消
        </Button>
        <Button
          type="submit"
          disabled={isUploading}
          className="min-w-[120px]"
        >
          {isUploading ? (
            <>上传中...</>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              上传技能
            </>
          )}
        </Button>
      </div>
    </form>
  );
};

// Default SKILL.md template
const defaultSkillTemplate = `---
name: My Custom Skill
description: A brief description of what this skill does
category: productivity
---

# My Custom Skill

Provide detailed instructions for Claude here.

## Usage

When to use this skill and how it works.

## Examples

Example usage scenarios.
`.trim();
