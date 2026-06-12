'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { MoreHorizontal, Pencil, Pin, FolderInput, FolderMinus, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '~/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import { assignSessionToProject } from '~/server/function/projects.server';
import { useProjects, type ProjectDTO } from '~/lib/hooks/use-projects';

export interface MenuSession {
  id: string; // session row PK — used by /api/agent-sessions/:id (PATCH/DELETE)
  sdkSessionId: string; // workspace id — used by assignSessionToProject
  title: string | null;
}

/**
 * Conversation ··· menu (IA redesign 2026-06, Owner spec): 重命名 / 置顶 / 移至项目 /
 * 从项目移除 / 删除. Backed by /api/agent-sessions/:id (PATCH title|favorite, DELETE) and
 * assignSessionToProject. 归档/分享(会话级) 暂无后端，未列。
 */
export function SessionMenu({
  session,
  projectId,
  personalLabel,
  favorite = false,
}: {
  session: MenuSession;
  /** Present when the session lives inside a project → enables 从项目移除. */
  projectId?: string;
  personalLabel: string;
  /** Current pinned state → toggles the 置顶/取消置顶 label. */
  favorite?: boolean;
}) {
  const qc = useQueryClient();
  const { projects } = useProjects();
  const move = useServerFn(assignSessionToProject);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? '');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['project-sessions'] });
    void qc.invalidateQueries({ queryKey: ['agent-sessions'] });
  };

  const patch = async (body: Record<string, unknown>) => {
    await fetch(`/api/agent-sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    refresh();
  };

  const doRename = async () => {
    const title = renameValue.trim();
    if (!title || title === session.title) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    try {
      await patch({ title });
      setRenameOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const doMove = async (target: string | null) => {
    await move({ data: { sdkSessionId: session.sdkSessionId, projectId: target } });
    refresh();
  };

  const doDelete = async () => {
    if (!window.confirm('删除这个对话？此操作不可撤销。')) return;
    await fetch(`/api/agent-sessions/${session.id}`, { method: 'DELETE' });
    refresh();
  };

  // Move targets = projects other than the one it's already in.
  const moveTargets = projects.filter((p: ProjectDTO) => p.id !== projectId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="对话操作"
            onClick={(e) => e.stopPropagation()}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => { setRenameValue(session.title ?? ''); setRenameOpen(true); }}>
            <Pencil className="h-4 w-4" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void patch({ favorite: !favorite })}>
            <Pin className="h-4 w-4" />
            {favorite ? '取消置顶' : '置顶聊天'}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="h-4 w-4" />
              移至项目
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
              {moveTargets.length === 0 ? (
                <DropdownMenuItem disabled>没有其它项目</DropdownMenuItem>
              ) : (
                moveTargets.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => void doMove(p.id)}>
                    {p.isDefault ? personalLabel : p.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {projectId && (
            <DropdownMenuItem onSelect={() => void doMove(null)}>
              <FolderMinus className="h-4 w-4" />
              从项目移除
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void doDelete()}>
            <Trash2 className="h-4 w-4" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doRename();
            }}
            autoFocus
            placeholder="对话标题"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => void doRename()} disabled={busy}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
