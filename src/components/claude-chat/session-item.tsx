/**
 * Session Item Component (Claude Style)
 *
 * Displays a single session in the session list with Claude.ai styling.
 * Supports inline title editing.
 */

import { useIntlayer } from 'react-intlayer';
import { cn, toLocalizedString } from '~/lib/utils';
import { Star, MessageSquare, Pencil, Check, X, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect, type KeyboardEvent } from 'react';

export interface SessionItemData {
  id: string;
  sdkSessionId: string;
  title: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SessionItemProps {
  session: SessionItemData;
  isActive: boolean;
  onClick: () => void;
  onUpdateTitle?: (id: string, title: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function SessionItem({ session, isActive, onClick, onUpdateTitle, onDelete }: SessionItemProps) {
  const content = useIntlayer('claude-chat');
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title || '');
  const [isHovered, setIsHovered] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayTitle = session.title || content.sessionItem.newChat;
  const displayTitleText = session.title || toLocalizedString(content.sessionItem.newChat);
  const timeAgo = formatTimeAgo(session.updatedAt);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title || '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title && onUpdateTitle) {
      await onUpdateTitle(session.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(session.title || '');
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Confirm deletion
    const confirmed = window.confirm(
      `Delete "${displayTitleText}"?\n\nThis will permanently delete the conversation and all its files.`
    );

    if (!confirmed || !onDelete) return;

    setIsDeleting(true);
    try {
      await onDelete(session.id);
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete conversation. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        'w-full text-left px-3 py-2.5 transition-colors duration-150',
        'hover:bg-muted dark:hover:bg-muted',
        'border-b border-border/50 dark:border-border/50',
        isActive && 'bg-accent dark:bg-accent'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        onClick={isEditing ? undefined : onClick}
        disabled={isEditing}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex items-start gap-2">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground dark:text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {session.favorite && (
                <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
              )}
              {isEditing ? (
                <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    className="flex-1 min-w-0 px-1 py-0.5 text-sm font-medium bg-background dark:bg-background border border-primary rounded outline-none text-foreground dark:text-foreground"
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    className="p-0.5 hover:bg-muted dark:hover:bg-muted rounded"
                  >
                    <Check className="h-3.5 w-3.5 text-success" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="p-0.5 hover:bg-muted dark:hover:bg-muted rounded"
                  >
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              ) : (
                <>
                  <span
                    className={cn(
                      'truncate text-sm font-medium flex-1',
                      isActive
                        ? 'text-foreground dark:text-foreground'
                        : 'text-foreground/80 dark:text-foreground/80'
                    )}
                  >
                    {displayTitle}
                  </span>
                  {isHovered && (onUpdateTitle || onDelete) && (
                    <div className="flex gap-0.5 items-center">
                      {onUpdateTitle && (
                        <button
                          type="button"
                          onClick={handleStartEdit}
                          className="p-0.5 hover:bg-muted dark:hover:bg-muted rounded opacity-60 hover:opacity-100"
                          title={toLocalizedString(content.sessionItem.editTitle)}
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground dark:text-muted-foreground" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={isDeleting}
                          className={cn(
                            "p-0.5 hover:bg-destructive/10 dark:hover:bg-destructive/15 rounded opacity-60 hover:opacity-100",
                            isDeleting && "opacity-40 cursor-not-allowed"
                          )}
                          title={toLocalizedString(content.sessionItem.deleteConversation)}
                        >
                          <Trash2 className={cn(
                            "h-3 w-3",
                            isDeleting ? "text-muted-foreground" : "text-destructive"
                          )} />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground dark:text-muted-foreground">
              {timeAgo}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
