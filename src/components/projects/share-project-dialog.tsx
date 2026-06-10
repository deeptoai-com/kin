'use client';

import { useState, useCallback, type KeyboardEvent } from 'react';
import { useIntlayer } from 'react-intlayer';
import { UserPlus, X, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog';
import { LetterAvatar } from '~/components/ui/letter-avatar';
import { useProjects, type ProjectDTO } from '~/lib/hooks/use-projects';
import { cn, toLocalizedString } from '~/lib/utils';

interface ShareProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDTO;
  /** Only the owner may add/remove members (server-enforced; we also gate the UI). */
  isOwner: boolean;
}

/**
 * Share / members dialog. Sharing = adding a member by email (PRD §5: instant, zero
 * re-embed) — backed by the addProjectMember / removeProjectMember server functions,
 * owner-only. Members are looked up in the org by email.
 */
export function ShareProjectDialog({ open, onOpenChange, project, isOwner }: ShareProjectDialogProps) {
  const content = useIntlayer('projects');
  const { addMember, removeMember } = useProjects();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdd = email.trim().includes('@') && !busy;

  const handleAdd = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) return;
    setBusy(true);
    setError(null);
    try {
      await addMember(project.id, trimmed);
      setEmail('');
    } catch (e) {
      setError(
        String(e).includes('USER_NOT_FOUND')
          ? toLocalizedString(content.share.userNotFound)
          : toLocalizedString(content.share.addFailed)
      );
    } finally {
      setBusy(false);
    }
  }, [email, addMember, project.id, content.share.userNotFound, content.share.addFailed]);

  const handleRemove = useCallback(
    async (userId: string) => {
      setBusy(true);
      setError(null);
      try {
        await removeMember(project.id, userId);
      } catch {
        setError(toLocalizedString(content.share.addFailed));
      } finally {
        setBusy(false);
      }
    },
    [removeMember, project.id, content.share.addFailed]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{content.share.title}</DialogTitle>
          <DialogDescription>{content.share.desc}</DialogDescription>
        </DialogHeader>

        {/* Add member (owner-only) */}
        {isOwner && (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={toLocalizedString(content.share.emailPlaceholder)}
                className={cn(
                  'flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                )}
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAdd}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {content.share.addMember}
              </button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {/* Members list */}
        <div className="space-y-1">
          {project.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <LetterAvatar name={m.name} iconUrl={m.image ?? undefined} size="sm" className="!size-8 !rounded-full" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                {m.email && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
              </div>
              {m.role === 'owner' ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {content.share.ownerBadge}
                </span>
              ) : isOwner ? (
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  disabled={busy}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  title={toLocalizedString(content.share.removeMember)}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
