'use client';

import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Button } from '~/components/ui/button';
import { authClient } from '~/lib/auth-client';
import { useProjects, type ProjectDTO } from '~/lib/hooks/use-projects';

/**
 * Project settings (IA redesign 2026-06, prd §7). Owner-editable: 名称 + 指令 + 删除项目.
 * Member sees a read-only view (updateProject is owner-only — assertProjectOwner).
 * 记忆 scope / emoji 不做（oxygenie 无记忆系统；emoji 需 schema 字段）。指令"生效"（注入
 * worker system prompt）是单独的 agent-线工作；此弹窗只负责存储 instructions。
 */
export function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDTO;
}) {
  const { data: session } = authClient.useSession();
  const isOwner = project.ownerUserId === session?.user?.id;
  const { updateProject, deleteProject } = useProjects();
  const navigate = useNavigate();

  const [name, setName] = useState(project.name);
  const [instructions, setInstructions] = useState(project.instructions ?? '');
  const [busy, setBusy] = useState(false);

  // Reset fields to the project's current values whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setName(project.name);
      setInstructions(project.instructions ?? '');
    }
  }, [open, project.name, project.instructions]);

  const save = async () => {
    if (!isOwner) return;
    setBusy(true);
    try {
      await updateProject({
        projectId: project.id,
        name: name.trim() || project.name,
        instructions,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!isOwner) return;
    if (!window.confirm(`删除项目「${project.name}」？项目内的对话会移出项目，不会被删除。`)) return;
    await deleteProject(project.id);
    onOpenChange(false);
    navigate({ to: '/agents/projects' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>项目设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">项目名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              placeholder="项目名称"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">指令</label>
            <p className="text-xs text-muted-foreground">设置项目背景信息，自定义 AI 在本项目内的回复方式。</p>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={!isOwner}
              rows={4}
              placeholder="例如：用中文回答。参考项目里的资料。回答要简短且突出重点。"
            />
          </div>

          {!isOwner && (
            <p className="text-xs text-muted-foreground">仅项目所有者可修改设置。</p>
          )}
        </div>

        <DialogFooter className="flex items-center">
          {isOwner && (
            <Button
              variant="outline"
              onClick={() => void remove()}
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              删除项目
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {isOwner ? '取消' : '关闭'}
            </Button>
            {isOwner && (
              <Button onClick={() => void save()} disabled={busy}>
                保存
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
