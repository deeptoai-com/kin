import type { CheckedState } from '@radix-ui/react-checkbox';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import { useServerFn } from '@tanstack/react-start';
import { AudioLines, Book, FileText, Image as ImageIcon, Video, Plus, Edit2, Trash2, Loader2, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import * as FileUpload from '~/components/dropzone';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { Checkbox } from '~/components/ui/checkbox';
import { DocumentSelectorModal } from '~/components/claude-chat/document-selector-modal';

import {
  completeDocumentUpload,
  deleteDocuments,
  directDocumentUpload,
  initDocumentUpload,
  listDocuments,
  probeDocumentFile,
  requestDocumentParse,
  type CompleteDocumentUploadInput,
  type DirectDocumentUploadInput,
  type DeleteDocumentsInput,
  type InitDocumentUploadInput,
} from '~/server/function/documents.server';
import { DocumentStatusBadge, anyInFlight } from '~/components/documents/document-status';
import { ParseEngineDialog, type ParseMethod, type ProbeRecommendation } from '~/components/documents/parse-engine-dialog';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  getKbDocuments,
  addKbDocuments,
  removeKbDocument,
} from '~/server/function/knowledge-bases.server';
export const Route = createFileRoute('/agents/documents')({
  loader: async () => {
    const files = await listDocuments();
    return { files };
  },
  component: DocumentsPage,
});

type ListedFile = Awaited<ReturnType<typeof listDocuments>>[number];
type SelectableFile = { id: ListedFile['id']; key?: ListedFile['key'] };
type DeleteDocumentsPayload = NonNullable<DeleteDocumentsInput['items']>;

function DocumentsPage() {
  const content = useIntlayer('documents');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { files: initialFiles } = Route.useLoaderData() as {
    files: Awaited<ReturnType<typeof listDocuments>>;
  };
  const listDocumentsFn = useServerFn(listDocuments);
  // U2: poll the list while any document is mid parse/embed so status chips + progress
  // update live; idle otherwise (loader data seeds it, no flash).
  const { data: files = initialFiles } = useQuery({
    queryKey: ['documents-list'],
    queryFn: () => listDocumentsFn(),
    initialData: initialFiles,
    refetchInterval: (q) => (anyInFlight((q.state.data as typeof initialFiles | undefined) ?? []) ? 2000 : false),
  });
  const probeFileFn = useServerFn(probeDocumentFile);
  const requestParseFn = useServerFn(requestDocumentParse);

  // Parse-engine dialog (U2 spec §3): { fileId, documentId } target + probe state.
  const [parseDialog, setParseDialog] = useState<
    { documentId: string; fileId: string; probing: boolean; recommendation: ProbeRecommendation | null; busy: boolean } | null
  >(null);

  const openParseDialog = useCallback(async (documentId: string, fileId: string) => {
    setParseDialog({ documentId, fileId, probing: true, recommendation: null, busy: false });
    try {
      const res = (await probeFileFn({ data: { fileId } })) as
        | { ok: true; pages?: number; chars?: number; recommend: ProbeRecommendation }
        | { ok: false; error: string };
      setParseDialog((d) => (d && d.fileId === fileId
        ? { ...d, probing: false, recommendation: res.ok ? { ...res.recommend, pages: res.pages, chars: res.chars } : null }
        : d));
    } catch {
      setParseDialog((d) => (d && d.fileId === fileId ? { ...d, probing: false } : d));
    }
  }, [probeFileFn]);

  const confirmParse = useCallback(async (method: ParseMethod) => {
    if (!parseDialog) return;
    setParseDialog((d) => (d ? { ...d, busy: true } : d));
    try {
      await requestParseFn({ data: { documentId: parseDialog.documentId, method } });
      await queryClient.invalidateQueries({ queryKey: ['documents-list'] });
      setParseDialog(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '解析请求失败');
      setParseDialog((d) => (d ? { ...d, busy: false } : d));
    }
  }, [parseDialog, requestParseFn, queryClient]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showKB, setShowKB] = useState(false);
  const [selectedUploadKbIds, setSelectedUploadKbIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // null = idle; 0-100 = the whole upload flow is running (init → bytes → finalize).
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<
    Map<string, DeleteDocumentsPayload[number]>
  >(new Map());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [showCreateKB, setShowCreateKB] = useState(false);
  const [showEditKB, setShowEditKB] = useState(false);
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [kbName, setKbName] = useState('');
  const [kbDescription, setKbDescription] = useState('');
  const [editKbId, setEditKbId] = useState<string | null>(null);
  const [editKbName, setEditKbName] = useState('');
  const [editKbDescription, setEditKbDescription] = useState('');

  const initUploadFn = useServerFn(initDocumentUpload);
  const completeUploadFn = useServerFn(completeDocumentUpload);
  const directUploadFn = useServerFn(directDocumentUpload);
  const deleteDocumentsFn = useServerFn(deleteDocuments);
  const listKnowledgeBasesFn = useServerFn(listKnowledgeBases);
  const createKnowledgeBaseFn = useServerFn(createKnowledgeBase);
  const updateKnowledgeBaseFn = useServerFn(updateKnowledgeBase);
  const deleteKnowledgeBaseFn = useServerFn(deleteKnowledgeBase);
  const getKbDocumentsFn = useServerFn(getKbDocuments);
  const addKbDocumentsFn = useServerFn(addKbDocuments);
  const removeKbDocumentFn = useServerFn(removeKbDocument);

  // Query KB list
  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => listKnowledgeBasesFn(),
  });

  // Extract selected KB ID from activeFilter
  const selectedKbId = activeFilter.startsWith('kb:') ? activeFilter.slice(3) : null;
  const selectedKb = selectedKbId ? knowledgeBases.find((kb) => kb.id === selectedKbId) : null;

  // Query KB documents when a KB is selected
  const { data: kbDocuments = [], isLoading: kbDocsLoading } = useQuery({
    queryKey: ['kb-documents', selectedKbId],
    // NB: server fns take { data: ... } — passing the payload bare makes the validator
    // see undefined and the query silently error into an empty list (bug: KB 列表显示空).
    queryFn: () => getKbDocumentsFn({ data: { kbId: selectedKbId! } }),
    enabled: !!selectedKbId,
  });

  // Create KB mutation
  const createKBMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      createKnowledgeBaseFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setShowCreateKB(false);
      setKbName('');
      setKbDescription('');
    },
  });

  // Update KB mutation
  const updateKBMutation = useMutation({
    mutationFn: (data: { id: string; name: string; description?: string }) =>
      updateKnowledgeBaseFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setShowEditKB(false);
      setEditKbId(null);
      setEditKbName('');
      setEditKbDescription('');
    },
  });

  // Delete KB mutation
  const deleteKBMutation = useMutation({
    mutationFn: (id: string) => deleteKnowledgeBaseFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setActiveFilter('all');
    },
  });

  // Add documents to KB mutation
  const addDocsMutation = useMutation({
    mutationFn: (data: { kbId: string; fileIds: string[] }) =>
      addKbDocumentsFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-documents', selectedKbId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setShowAddDocs(false);
    },
  });

  // Remove document from KB mutation
  const removeDocMutation = useMutation({
    mutationFn: (data: { kbId: string; documentId: string }) =>
      removeKbDocumentFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-documents', selectedKbId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });

  const initUpload = useMutation({
    mutationFn: (input: InitDocumentUploadInput) => initUploadFn({ data: input }),
  });
  const completeUpload = useMutation({
    mutationFn: (input: CompleteDocumentUploadInput) => completeUploadFn({ data: input }),
  });
  const directUpload = useMutation({
    mutationFn: (input: DirectDocumentUploadInput) => directUploadFn({ data: input }),
  });
  const deleteFilesMutation = useMutation({
    mutationFn: (payload: DeleteDocumentsPayload) =>
      deleteDocumentsFn({ data: { items: payload } }),
    onMutate: () => {
      setDeleteError(null);
    },
    onSuccess: async () => {
      setSelectedFiles(new Map());
      // The list renders from the 'documents-list' query (loader is only initialData),
      // so router.invalidate() alone never refreshes it — invalidate every affected query.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents-list'] }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] }),
        queryClient.invalidateQueries({ queryKey: ['kb-documents'] }),
        router.invalidate(),
      ]);
    },
    onError: (err: unknown) => {
      setDeleteError(err instanceof Error ? err.message : content.selectedBar.delete);
    },
  });

  const filtered = useMemo(() => {
    let result = files;

    // Apply type filter
    if (activeFilter !== 'all') {
      result = result.filter((file) => {
        const mimeType = file.mimeType?.toLowerCase() || '';
        const fileType = file.fileType?.toLowerCase() || '';
        const sourceType = (file as any).sourceType?.toLowerCase() || '';

        switch (activeFilter) {
          case 'documents':
            return mimeType.includes('text') ||
                   mimeType.includes('pdf') ||
                   mimeType.includes('document') ||
                   fileType.includes('text') ||
                   fileType.includes('pdf');
          case 'images':
            return mimeType.includes('image') || fileType.includes('image');
          case 'audio':
            return mimeType.includes('audio') || fileType.includes('audio');
          case 'videos':
            return mimeType.includes('video') || fileType.includes('video');
          case 'knowledge-base':
            return sourceType === 'knowledge-base';
          default:
            return true;
        }
      });
    }

    // Apply search filter
    const needle = search.trim().toLowerCase();
    if (needle) {
      result = result.filter((file) => {
        const haystack = [file.name, file.mimeType, file.fileType].filter(Boolean) as string[];
        return haystack.some((value) => value.toLowerCase().includes(needle));
      });
    }

    return result;
  }, [files, search, activeFilter]);

  const selectedEntries = useMemo(() => Array.from(selectedFiles.values()), [selectedFiles]);
  const selectedCount = selectedEntries.length;
  const selectAllState = useMemo<CheckedState>(() => {
    if (filtered.length === 0) return false;
    const allSelected = filtered.every((file) => selectedFiles.has(file.id));
    if (allSelected) return true;
    const noneSelected = filtered.every((file) => !selectedFiles.has(file.id));
    return noneSelected ? false : 'indeterminate';
  }, [filtered, selectedFiles]);

  const formatFileSize = (size?: number | null) => {
    if (!size || size <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / 1024 ** power;
    const decimals = value >= 10 || power === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[power]}`;
  };

  const uploading =
    initUpload.isPending || completeUpload.isPending || directUpload.isPending || uploadProgress !== null;
  const deleting = deleteFilesMutation.isPending;

  const handleToggleAll = useCallback(
    (next: CheckedState) => {
      const shouldSelect = next === true || next === 'indeterminate';
      setSelectedFiles((prev) => {
        const updated = new Map(prev);
        if (shouldSelect) {
          filtered.forEach((file) => {
            updated.set(file.id, { id: file.id, key: file.key ?? undefined });
          });
        } else {
          filtered.forEach((file) => updated.delete(file.id));
        }
        return updated;
      });
    },
    [filtered],
  );

  const handleToggleFile = useCallback((file: SelectableFile, next: CheckedState) => {
    const shouldSelect = next === true || next === 'indeterminate';
    setSelectedFiles((prev) => {
      const updated = new Map(prev);
      if (shouldSelect) {
        updated.set(file.id, { id: file.id, key: file.key ?? undefined });
      } else {
        updated.delete(file.id);
      }
      return updated;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Map());
    setDeleteError(null);
  }, []);

  const handleDeleteSelected = async () => {
    if (selectedEntries.length === 0 || deleting) return;
    try {
      await deleteFilesMutation.mutateAsync(selectedEntries);
    } catch (err) {
      // handled in onError
    }
  };

  const handleUploadDoc = async () => {
    if (filesToUpload.length === 0) return;
    const file = filesToUpload[0];

    try {
      setErrorMessage(null);
      setUploadProgress(0);
      // 1) request presigned URL and db draft row
      const initResultRaw = await initUpload.mutateAsync({
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        title,
        content: text,
        addToKnowledgeBase: showKB || selectedUploadKbIds.size > 0,
        knowledgeBaseIds: Array.from(selectedUploadKbIds),
      });

      const initResult = Array.isArray(initResultRaw)
        ? (initResultRaw[0] as typeof initResultRaw[0]) ?? {}
        : initResultRaw ?? {};

      let { id, uploadUrl, key } = initResult as Record<string, unknown> as {
        id?: string;
        uploadUrl?: string | null;
        key?: string;
      };

      if (!id) {
        throw new Error('Upload initialization failed: missing file id');
      }

      let shouldComplete = true;

      if (uploadUrl) {
        // 2a) upload directly to S3 via presigned URL
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });
      } else {
        // 2b) binary direct upload (KB redesign 阶段5): XHR PUTs the RAW file so we get
        // a real upload progress bar (fetch has no upload progress), the body is ~25%
        // smaller than the old base64-over-server-fn path, and neither side builds a
        // giant string. The server route stores bytes + finalizes url/size.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `/api/documents/upload?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key ?? '')}`);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`上传失败（HTTP ${xhr.status}）`));
          xhr.onerror = () => reject(new Error('上传失败（网络错误）'));
          xhr.send(file);
        });
        shouldComplete = false;
      }

      // 3) mark upload complete (send both id & key for robust server-side lookup)
      if (shouldComplete) {
        await completeUpload.mutateAsync({ id, key });
      }

      // refresh list (both the loader and the polling query)
      await router.invalidate();
      const refreshed = await queryClient.fetchQuery({
        queryKey: ['documents-list'],
        queryFn: () => listDocumentsFn(),
      });

      // reset UI
      setShowUpload(false);
      setFilesToUpload([]);
      setTitle('');
      setText('');
      setShowKB(false);
      setSelectedUploadKbIds(new Set());

      // U2: a PDF added to the knowledge base → probe + offer the parse engine
      // (system-recommended, overridable). Non-KB or non-PDF uploads skip this.
      if ((showKB || selectedUploadKbIds.size > 0) && file.name.toLowerCase().endsWith('.pdf')) {
        const row = (refreshed as typeof initialFiles).find((f) => f.id === id && f.documentId);
        if (row?.documentId) void openParseDialog(row.documentId, id);
      }
    } catch (err) {
      console.error('Upload failed', err);
      setErrorMessage(err instanceof Error ? err.message : content.upload.upload);
    } finally {
      setUploadProgress(null);
    }
  };

  return (
    <>
      <ParseEngineDialog
        open={!!parseDialog}
        probing={parseDialog?.probing ?? false}
        recommendation={parseDialog?.recommendation ?? null}
        busy={parseDialog?.busy ?? false}
        onConfirm={confirmParse}
        onCancel={() => setParseDialog(null)}
      />
      {/* main layout */}
      <div className="flex h-[calc(100vh-theme(spacing.16))]">
        {/* left nav */}
        <aside className="w-64 space-y-4 border-r px-4 py-6">
          <h2 className="font-semibold text-lg">{content.sidebar.title}</h2>
          <nav className="space-y-2 text-sm">
            <NavItem
              label={toLocalizedString(content.sidebar.allFiles)}
              active={activeFilter === 'all'}
              onClick={() => setActiveFilter('all')}
            />
            <NavItem
              label={toLocalizedString(content.sidebar.documents)}
              icon={FileText}
              active={activeFilter === 'documents'}
              onClick={() => setActiveFilter('documents')}
            />
            <NavItem
              label={toLocalizedString(content.sidebar.images)}
              icon={ImageIcon}
              active={activeFilter === 'images'}
              onClick={() => setActiveFilter('images')}
            />
            <NavItem
              label={toLocalizedString(content.sidebar.audio)}
              icon={AudioLines}
              active={activeFilter === 'audio'}
              onClick={() => setActiveFilter('audio')}
            />
            <NavItem
              label={toLocalizedString(content.sidebar.videos)}
              icon={Video}
              active={activeFilter === 'videos'}
              onClick={() => setActiveFilter('videos')}
            />
            <div className="pt-4 pb-2 flex items-center justify-between">
              <span className="font-medium text-muted-foreground text-xs uppercase">
                {content.sidebar.knowledgeBase}
              </span>
              <button
                onClick={() => setShowCreateKB(true)}
                className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                title={toLocalizedString(content.sidebar.createKb)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <NavItem
              label={toLocalizedString(content.sidebar.allKbFiles)}
              icon={Book}
              indent={true}
              active={activeFilter === 'knowledge-base'}
              onClick={() => setActiveFilter('knowledge-base')}
            />
            {knowledgeBases.map((kb) => (
              <NavItem
                key={kb.id}
                label={`${kb.name} (${kb.documentCount})`}
                indent={true}
                active={activeFilter === `kb:${kb.id}`}
                onClick={() => setActiveFilter(`kb:${kb.id}`)}
              />
            ))}
          </nav>
        </aside>

        {/* right pane */}
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {/* toolbar */}
          <div className="flex items-center justify-between gap-2 border-b px-6 py-4">
            {selectedKb ? (
              <>
                <div className="flex-1">
                  <h2 className="font-semibold text-lg">{selectedKb.name}</h2>
                  {selectedKb.description && (
                    <p className="text-sm text-muted-foreground mt-1">{selectedKb.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditKbId(selectedKb.id);
                      setEditKbName(selectedKb.name);
                      setEditKbDescription(selectedKb.description || '');
                      setShowEditKB(true);
                    }}
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    {content.toolbar.editButton}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(toLocalizedString(content.deleteConfirm.kb).replace('{name}', selectedKb.name))) {
                        deleteKBMutation.mutate(selectedKb.id);
                      }
                    }}
                    disabled={deleteKBMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {deleteKBMutation.isPending ? content.toolbar.deleting : content.toolbar.deleteButton}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={toLocalizedString(content.toolbar.searchPlaceholder)}
                  className="max-w-xs"
                />
                <Button onClick={() => setShowUpload(true)}>{content.toolbar.uploadButton}</Button>
              </>
            )}
          </div>

          {/* header row */}
          <div className="flex items-center justify-between px-6 py-3">
            {selectedKb ? (
              <>
                <h3 className="font-medium text-sm">
                  {content.header.kbDocuments}
                  <span className="ml-2 text-muted-foreground">• {toLocalizedString(content.header.total).replace('{count}', String(kbDocuments.length))}</span>
                </h3>
                <Button
                  size="sm"
                  onClick={() => setShowAddDocs(true)}
                  disabled={addDocsMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {content.header.addDocuments}
                </Button>
              </>
            ) : (
              <>
                <h3 className="font-medium text-sm">
                  {content.header.allFiles}
                  {filtered && (
                    <span className="ml-2 text-muted-foreground">• {toLocalizedString(content.header.total).replace('{count}', String(filtered.length))}</span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <Switch checked={showKB} onCheckedChange={setShowKB} />
                  <span className="text-muted-foreground text-xs">{content.header.showInKb}</span>
                </div>
              </>
            )}
          </div>

          {/* file table */}
          <div className="flex-1 overflow-auto px-2">
            {selectedKb ? (
              // KB document list view
              kbDocsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : kbDocuments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Book className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">{content.kbList.noDocuments}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{content.kbList.getStarted}</p>
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  {kbDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between rounded-lg border bg-accent/50 p-3 text-sm"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{doc.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(doc.size)} • {doc.mimeType || 'Unknown type'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(toLocalizedString(content.deleteConfirm.removeDoc).replace('{name}', doc.name))) {
                            removeDocMutation.mutate({
                              kbId: selectedKb.id,
                              documentId: doc.id,
                            });
                          }
                        }}
                        disabled={removeDocMutation.isPending}
                        className="ml-2 rounded p-1.5 transition-colors hover:bg-destructive/20 disabled:opacity-50"
                        title={toLocalizedString(content.kbList.removeFromKb)}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : (
              // Normal file list view
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground">
                    <th className="w-10 px-2 py-2 text-left font-normal">
                      <Checkbox
                        aria-label={toLocalizedString(content.table.selectAll)}
                        checked={selectAllState}
                        onCheckedChange={handleToggleAll}
                        disabled={filtered.length === 0 || deleting}
                      />
                    </th>
                    <th className="py-2 text-left font-normal">{content.table.file}</th>
                    <th className="py-2 text-left font-normal">状态</th>
                    <th className="py-2 text-left font-normal">{content.table.createdAt}</th>
                    <th className="py-2 text-left font-normal">{content.table.size}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered && filtered.length > 0 ? (
                    filtered.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b transition-colors last:border-b-0 hover:bg-muted/50"
                      >
                        <td className="w-10 px-2">
                          <Checkbox
                            aria-label={toLocalizedString(content.table.selectFile).replace('{name}', d.name)}
                            checked={selectedFiles.has(d.id)}
                            onCheckedChange={(value) => handleToggleFile(d, value)}
                            disabled={deleting}
                          />
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="size-4 text-muted-foreground" />
                            <span>{d.name}</span>
                          </div>
                        </td>
                        <td className="py-3">
                          <DocumentStatusBadge
                            doc={d}
                            onRetry={
                              d.documentId
                                ? () => openParseDialog(d.documentId!, d.id)
                                : undefined
                            }
                          />
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {d.createdAt ? new Date(d.createdAt).toLocaleString() : '--'}
                        </td>
                        <td className="py-3 text-muted-foreground">{formatFileSize(d.size)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center">
                        {content.table.noDocuments}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {selectedCount > 0 && (
            <div className="pointer-events-auto absolute bottom-6 right-6 z-20 w-full max-w-md rounded-md border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{toLocalizedString(content.selectedBar.selected).replace('{count}', String(selectedCount))}</p>
                  {deleteError && (
                    <p className="mt-1 text-xs text-destructive">{deleteError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSelection}
                    disabled={deleting}
                  >
                    {content.selectedBar.clear}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                  >
                    {deleting ? content.toolbar.deleting : content.selectedBar.delete}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* upload dialog */}
      <Dialog
        open={showUpload}
        onOpenChange={(nextOpen) => {
          setShowUpload(nextOpen);
          if (!nextOpen) {
            setErrorMessage(null);
            setFilesToUpload([]);
            setSelectedUploadKbIds(new Set());
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{content.upload.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title-input">{content.upload.titleLabel}</Label>
              <Input
                id="title-input"
                placeholder={toLocalizedString(content.upload.titlePlaceholder)}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="text-input">{content.upload.textLabel}</Label>
              <textarea
                id="text-input"
                className="h-40 w-full rounded-md border p-2 text-sm"
                placeholder={toLocalizedString(content.upload.textPlaceholder)}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div>
              <Label>{content.upload.attachFiles}</Label>
              <FileUpload.Root
                value={filesToUpload}
                onValueChange={(updatedFiles: File[] | null) => {
                  setFilesToUpload(updatedFiles || []);
                }}
              >
                <FileUpload.Dropzone className="mt-1" />
                <FileUpload.Trigger className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50">
                  {content.upload.selectFiles}
                </FileUpload.Trigger>
                {filesToUpload.length > 0 && (
                  <FileUpload.List className="mt-2">
                    {filesToUpload.map((file, i) => (
                      <FileUpload.Item key={file.name + i} value={file}>
                        <FileUpload.ItemPreview />
                        <FileUpload.ItemMetadata />
                        <FileUpload.ItemDelete />
                      </FileUpload.Item>
                    ))}
                  </FileUpload.List>
                )}
                {filesToUpload.length > 0 && (
                  <FileUpload.Clear className="mt-2 inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50">
                    {content.upload.clearAll}
                  </FileUpload.Clear>
                )}
              </FileUpload.Root>
            </div>

            {/* 加入知识库（KB redesign prd §4.2）—— 选已有（多选）或新建 */}
            <div>
              <div className="flex items-center justify-between">
                <Label>加入知识库（可选）</Label>
                <button
                  type="button"
                  onClick={() => setShowCreateKB(true)}
                  className="text-xs text-primary hover:underline"
                >
                  + 新建知识库
                </button>
              </div>
              {knowledgeBases.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">还没有知识库，点「新建知识库」创建一个</p>
              ) : (
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                  {knowledgeBases.map((kb) => (
                    <label
                      key={kb.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedUploadKbIds.has(kb.id)}
                        onCheckedChange={() =>
                          setSelectedUploadKbIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(kb.id)) next.delete(kb.id);
                            else next.add(kb.id);
                            return next;
                          })
                        }
                      />
                      <span className="flex-1 truncate">{kb.name}</span>
                      <span className="text-xs text-muted-foreground">{kb.documentCount} 文档</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(errorMessage ||
            initUpload.isError ||
            completeUpload.isError ||
            directUpload.isError) && (
            <p className="text-red-600 text-sm">
              {errorMessage ||
                initUpload.error?.message ||
                completeUpload.error?.message ||
                directUpload.error?.message ||
                content.upload.unknownError}
            </p>
          )}

          {uploadProgress !== null && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${Math.max(uploadProgress, 3)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {uploadProgress > 0 && uploadProgress < 100
                  ? `正在上传… ${uploadProgress}%`
                  : uploadProgress >= 100
                    ? '处理中…'
                    : '准备上传…'}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleUploadDoc} disabled={uploading || filesToUpload.length === 0}>
              {uploadProgress !== null && uploadProgress > 0 && uploadProgress < 100
                ? `上传中 ${uploadProgress}%`
                : uploading
                  ? content.upload.uploading
                  : content.upload.upload}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* create KB dialog */}
      <Dialog
        open={showCreateKB}
        onOpenChange={(nextOpen) => {
          setShowCreateKB(nextOpen);
          if (!nextOpen) {
            setKbName('');
            setKbDescription('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle>{content.createKb.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="kb-name-input">{content.createKb.nameLabel} *</Label>
              <Input
                id="kb-name-input"
                placeholder={toLocalizedString(content.createKb.namePlaceholder)}
                value={kbName}
                onChange={(e) => setKbName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-description-input">{content.createKb.descriptionLabel}</Label>
              <textarea
                id="kb-description-input"
                className="h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={toLocalizedString(content.createKb.descriptionPlaceholder)}
                value={kbDescription}
                onChange={(e) => setKbDescription(e.target.value)}
              />
            </div>
          </div>

          {createKBMutation.error && (
            <p className="text-red-600 text-sm">
              {createKBMutation.error.message || content.createKb.error}
            </p>
          )}

          <DialogFooter>
            <Button
              onClick={() => {
                if (kbName.trim()) {
                  createKBMutation.mutate({
                    name: kbName.trim(),
                    description: kbDescription.trim() || undefined,
                  });
                }
              }}
              disabled={!kbName.trim() || createKBMutation.isPending}
            >
              {createKBMutation.isPending ? content.createKb.creating : content.createKb.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit KB dialog */}
      <Dialog
        open={showEditKB}
        onOpenChange={(nextOpen) => {
          setShowEditKB(nextOpen);
          if (!nextOpen) {
            setEditKbId(null);
            setEditKbName('');
            setEditKbDescription('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle>{content.editKb.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-kb-name-input">{content.editKb.nameLabel} *</Label>
              <Input
                id="edit-kb-name-input"
                placeholder={toLocalizedString(content.editKb.namePlaceholder)}
                value={editKbName}
                onChange={(e) => setEditKbName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-kb-description-input">{content.editKb.descriptionLabel}</Label>
              <textarea
                id="edit-kb-description-input"
                className="h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={toLocalizedString(content.editKb.descriptionPlaceholder)}
                value={editKbDescription}
                onChange={(e) => setEditKbDescription(e.target.value)}
              />
            </div>
          </div>

          {updateKBMutation.error && (
            <p className="text-red-600 text-sm">
              {updateKBMutation.error.message || content.editKb.error}
            </p>
          )}

          <DialogFooter>
            <Button
              onClick={() => {
                if (editKbId && editKbName.trim()) {
                  updateKBMutation.mutate({
                    id: editKbId,
                    name: editKbName.trim(),
                    description: editKbDescription.trim() || undefined,
                  });
                }
              }}
              disabled={!editKbName.trim() || updateKBMutation.isPending}
            >
              {updateKBMutation.isPending ? content.editKb.saving : content.editKb.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* add documents to KB selector */}
      {selectedKb && (
        <DocumentSelectorModal
          isOpen={showAddDocs}
          onClose={() => setShowAddDocs(false)}
          onSelect={(fileIds) => {
            if (fileIds.length > 0) {
              addDocsMutation.mutate({
                kbId: selectedKb.id,
                fileIds,
              });
            }
          }}
          excludeFileIds={kbDocuments.map((doc) => doc.fileId)}
        />
      )}
    </>
  );
}

function NavItem({
  label,
  icon: Icon,
  indent = false,
  active = false,
  onClick,
}: {
  label: string;
  icon?: React.ElementType;
  indent?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors ${
        indent ? 'pl-6' : ''
      } ${
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-foreground/80 hover:bg-muted hover:text-foreground'
      }`}
    >
      {Icon && <Icon className="size-4" />}
      <span className="text-sm">{label}</span>
    </div>
  );
}
