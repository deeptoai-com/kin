/**
 * Knowledge Base Panel Component
 *
 * Displays documents linked to the current session and allows:
 * - Adding documents from the global library
 * - Removing documents from the session
 * - Re-syncing documents from S3
 */

'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, Loader2, RefreshCw, Trash2, AlertCircle, Book } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { cn } from '~/lib/utils';
import { DocumentSelectorModal } from './document-selector-modal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';

interface SessionDocument {
  id: string;
  fileId: string;
  filePath: string;
  syncedAt: string;
  fileName: string;
  fileSize: number;
  mimeType: string | null;
}

interface KnowledgeBasePanelProps {
  sessionId: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
}

export function KnowledgeBasePanel({ sessionId }: KnowledgeBasePanelProps) {
  const content = useIntlayer('claude-chat');
  const queryClient = useQueryClient();
  const [showSelector, setShowSelector] = useState(false);
  const [showKbSelector, setShowKbSelector] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingKbId, setAddingKbId] = useState<string | null>(null);

  // Fetch session documents
  const { data, isLoading, error } = useQuery({
    queryKey: ['session-documents', sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/workspace/${sessionId}/documents`);
      if (!res.ok) throw new Error('Failed to fetch session documents');
      return res.json() as Promise<{
        sessionId: string;
        documents: SessionDocument[];
        total: number;
      }>;
    },
    enabled: !!sessionId,
  });

  const documents = data?.documents || [];
  const excludeFileIds = documents.map((doc) => doc.fileId);

  // Fetch knowledge bases
  const { data: kbData } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: async () => {
      const res = await fetch('/api/server-functions/listKnowledgeBases');
      if (!res.ok) throw new Error('Failed to fetch knowledge bases');
      return res.json() as Promise<KnowledgeBase[]>;
    },
  });

  const knowledgeBases = kbData || [];

  // Add documents to session
  const handleAddDocuments = async (fileIds: string[]) => {
    try {
      const res = await fetch(`/api/workspace/${sessionId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds }),
      });

      if (!res.ok) {
        throw new Error('Failed to add documents');
      }

      // Refresh the list
      queryClient.invalidateQueries({ queryKey: ['session-documents', sessionId] });
    } catch (error) {
      console.error('Failed to add documents:', error);
      throw error;
    }
  };

  // Sync document (re-download from S3)
  const handleSync = async (documentId: string, fileName: string) => {
    setSyncingId(documentId);
    try {
      const res = await fetch(`/api/workspace/${sessionId}/documents/${documentId}/sync`, {
        method: 'POST',
      });

      if (!res.ok) {
        throw new Error('Failed to sync document');
      }

      const result = await res.json();

      // Show appropriate message based on sync result
      if (result.skipped) {
        alert(toLocalizedString(content.knowledgeBase.syncUnchanged).replace('{name}', fileName));
      } else {
        alert(toLocalizedString(content.knowledgeBase.syncSuccess).replace('{name}', fileName));
      }

      // Refresh the list
      queryClient.invalidateQueries({ queryKey: ['session-documents', sessionId] });
    } catch (error) {
      console.error('Failed to sync document:', error);
      alert(toLocalizedString(content.knowledgeBase.syncFailed));
    } finally {
      setSyncingId(null);
    }
  };

  // Remove document from session
  const handleRemove = async (documentId: string, fileName: string) => {
    const confirmed = window.confirm(toLocalizedString(content.knowledgeBase.removeConfirm).replace(/\{name\}/g, fileName));
    if (!confirmed) return;

    setRemovingId(documentId);
    try {
      const res = await fetch(`/api/workspace/${sessionId}/documents/${documentId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to remove document');
      }

      // Refresh the list
      queryClient.invalidateQueries({ queryKey: ['session-documents', sessionId] });
    } catch (error) {
      console.error('Failed to remove document:', error);
      alert(toLocalizedString(content.knowledgeBase.removeFailed));
    } finally {
      setRemovingId(null);
    }
  };

  // Add knowledge base to session
  const handleAddKnowledgeBase = async (kbId: string) => {
    setAddingKbId(kbId);
    try {
      const res = await fetch(`/api/workspace/${sessionId}/knowledge-bases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kbId }),
      });

      if (!res.ok) {
        throw new Error('Failed to add knowledge base');
      }

      await res.json();
      // No blocking alert — closing the picker + the refreshed document list IS the
      // success feedback (the alert also kept the dialog visually stuck open).
      queryClient.invalidateQueries({ queryKey: ['session-documents', sessionId] });
      setShowKbSelector(false);
    } catch (error) {
      console.error('Failed to add knowledge base:', error);
      alert(toLocalizedString(content.knowledgeBase.addKbFailed));
    } finally {
      setAddingKbId(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${sizes[i]}`;
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return toLocalizedString(content.knowledgeBase.timeJustNow);
    if (diffMins < 60) return toLocalizedString(content.knowledgeBase.timeMinutesAgo).replace('{count}', String(diffMins));

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return toLocalizedString(content.knowledgeBase.timeHoursAgo).replace('{count}', String(diffHours));

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return toLocalizedString(content.knowledgeBase.timeYesterday);
    if (diffDays < 7) return toLocalizedString(content.knowledgeBase.timeDaysAgo).replace('{count}', String(diffDays));

    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Description */}
      <p className="text-xs text-muted-foreground">
        {content.knowledgeBase.description}
      </p>

      {/* Add Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowSelector(true)}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
            'border-border bg-background hover:bg-accent'
          )}
        >
          <Plus className="h-4 w-4" />
          <span>{content.knowledgeBase.addDocuments}</span>
        </button>
        <button
          onClick={() => setShowKbSelector(true)}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
            'border-border bg-background hover:bg-accent'
          )}
        >
          <Book className="h-4 w-4" />
          <span>{content.knowledgeBase.addKb}</span>
        </button>
      </div>

      {/* Documents List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{content.knowledgeBase.loadFailed}</span>
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-xs text-muted-foreground">{content.knowledgeBase.noDocuments}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{content.knowledgeBase.clickToAdd}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {toLocalizedString(content.knowledgeBase.added).replace('{count}', String(documents.length))}
          </p>
          <div className="space-y-1.5">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-start gap-2 rounded-lg border bg-accent/50 p-2.5 text-xs"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{doc.fileName}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>•</span>
                    <span>{toLocalizedString(content.knowledgeBase.syncedAt).replace('{time}', formatTimeAgo(doc.syncedAt))}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Sync Button */}
                  <button
                    onClick={() => handleSync(doc.id, doc.fileName)}
                    disabled={syncingId === doc.id}
                    className={cn(
                      'rounded p-1 transition-colors hover:bg-background',
                      syncingId === doc.id && 'cursor-not-allowed opacity-50'
                    )}
                    title={toLocalizedString(content.knowledgeBase.sync)}
                  >
                    <RefreshCw
                      className={cn(
                        'h-3.5 w-3.5 text-muted-foreground',
                        syncingId === doc.id && 'animate-spin'
                      )}
                    />
                  </button>

                  {/* Remove Button */}
                  <button
                    onClick={() => handleRemove(doc.id, doc.fileName)}
                    disabled={removingId === doc.id}
                    className={cn(
                      'rounded p-1 transition-colors hover:bg-destructive/20',
                      removingId === doc.id && 'cursor-not-allowed opacity-50'
                    )}
                    title={toLocalizedString(content.knowledgeBase.remove)}
                  >
                    <Trash2
                      className={cn(
                        'h-3.5 w-3.5 text-destructive',
                        removingId === doc.id && 'opacity-50'
                      )}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document Selector Modal */}
      <DocumentSelectorModal
        isOpen={showSelector}
        onClose={() => setShowSelector(false)}
        onSelect={handleAddDocuments}
        excludeFileIds={excludeFileIds}
      />

      {/* Knowledge Base Selector Dialog */}
      <Dialog open={showKbSelector} onOpenChange={setShowKbSelector}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{content.knowledgeBase.addKbTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {content.knowledgeBase.addKbDescription}
            </p>

            {knowledgeBases.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Book className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">{content.knowledgeBase.noKb}</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {content.knowledgeBase.createKbFirst}
                </p>
              </div>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {knowledgeBases.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => handleAddKnowledgeBase(kb.id)}
                    disabled={addingKbId === kb.id}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      'hover:bg-accent',
                      addingKbId === kb.id && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{kb.name}</p>
                        {kb.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                            {kb.description}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {toLocalizedString(content.knowledgeBase.kbDocuments).replace('{count}', String(kb.documentCount))}
                        </p>
                      </div>
                      {addingKbId === kb.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKbSelector(false)}>
              {content.knowledgeBase.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
