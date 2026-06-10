'use client';

import { useState, useCallback, type KeyboardEvent } from 'react';
import { useIntlayer } from 'react-intlayer';
import { FolderPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog';
import { cn, toLocalizedString } from '~/lib/utils';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Parent owns the store write + navigation; we only collect the name. */
  onCreate: (input: { name: string }) => void;
}

/**
 * Create-project modal — mirrors the ChatGPT / Claude Desktop "Create project"
 * dialog: just a name + the "organize / ongoing work" helper text. Projects are
 * private by default; sharing is a separate, later action (see ShareProjectDialog).
 */
export function CreateProjectDialog({ open, onOpenChange, onCreate }: CreateProjectDialogProps) {
  const content = useIntlayer('projects');
  const [name, setName] = useState('');

  const canSubmit = name.trim().length > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onCreate({ name: name.trim() });
    setName('');
    onOpenChange(false);
  }, [canSubmit, name, onCreate, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-muted-foreground" />
            {content.create.title}
          </DialogTitle>
          <DialogDescription>{content.create.hint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label htmlFor="project-name" className="text-sm font-medium text-foreground">
            {content.create.nameLabel}
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            // biome-ignore lint/a11y/noAutofocus: modal name field is the primary action
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={toLocalizedString(content.create.namePlaceholder)}
            className={cn(
              'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            )}
          />
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {content.create.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {content.create.submit}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
