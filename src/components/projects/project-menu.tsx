'use client';

import { useState } from 'react';
import { MoreHorizontal, UserPlus, Pencil, Trash2, LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { authClient } from '~/lib/auth-client';
import { useProjects, type ProjectDTO } from '~/lib/hooks/use-projects';

/**
 * Project ··· menu (IA redesign 2026-06, Owner spec):
 *   owner  → 分享项目 / 重命名项目 / 删除项目
 *   member → 分享项目 / 离开项目
 * Backed by useProjects (addMember/updateProject/deleteProject/removeMember). The default
 * "个人" project is special — the caller (ProjectTreeRow) hides the menu for it.
 */
export function ProjectMenu({ project }: { project: ProjectDTO }) {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const { updateProject, deleteProject, addMember, removeMember } = useProjects();
  const isOwner = project.members.find((m) => m.userId === currentUserId)?.role === 'owner';

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const doRename = async () => {
    const name = renameValue.trim();
    if (!name || name === project.name) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    try {
      await updateProject({ projectId: project.id, name });
      setRenameOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const doShare = async () => {
    const email = shareEmail.trim();
    if (!email) return;
    setBusy(true);
    try {
      await addMember(project.id, email);
      setShareEmail('');
      setShareOpen(false);
    } catch (e) {
      window.alert('邀请失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!window.confirm(`删除项目「${project.name}」？项目内的对话会移出项目，不会被删除。`)) return;
    await deleteProject(project.id);
  };

  const doLeave = async () => {
    if (!currentUserId) return;
    if (!window.confirm(`离开项目「${project.name}」？`)) return;
    await removeMember(project.id, currentUserId);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="项目操作"
            onClick={(e) => e.stopPropagation()}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => setShareOpen(true)}>
            <UserPlus className="h-4 w-4" />
            分享项目
          </DropdownMenuItem>
          {isOwner ? (
            <>
              <DropdownMenuItem onSelect={() => { setRenameValue(project.name); setRenameOpen(true); }}>
                <Pencil className="h-4 w-4" />
                重命名项目
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void doDelete()}>
                <Trash2 className="h-4 w-4" />
                删除项目
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => void doLeave()}>
              <LogOut className="h-4 w-4" />
              离开项目
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doRename(); }}
            autoFocus
            placeholder="项目名称"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={busy}>取消</Button>
            <Button onClick={() => void doRename()} disabled={busy}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>分享项目「{project.name}」</DialogTitle>
          </DialogHeader>
          <Input
            type="email"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doShare(); }}
            autoFocus
            placeholder="输入对方邮箱邀请加入"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShareOpen(false)} disabled={busy}>取消</Button>
            <Button onClick={() => void doShare()} disabled={busy}>邀请</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
