import { FC, useState, useCallback } from 'react';
import { Upload, X, FileArchive, FileText, Loader2, TriangleAlert, AlertCircle } from 'lucide-react';
import { useIntlayer } from 'react-intlayer';
import { toLocalizedString } from '~/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { useServerFn } from '@tanstack/react-start';
import { uploadSkillToCatalogFn, checkSkillCompatibilityFn } from '~/server/function/skills.server';
import JSZip from 'jszip';

interface CompatibilityWarning {
  compatible: boolean;
  formattedWarnings: string[];
  rawWarnings: string[];
}

interface SkillUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Skills Upload Dialog Component
 *
 * Supports two upload methods:
 * 1. File upload: .zip or .skill files containing SKILL.md
 * 2. Manual creation: Navigate to full upload page
 */
export const SkillUploadDialog: FC<SkillUploadDialogProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const content = useIntlayer('skills');
  const uploadSkill = useServerFn(uploadSkillToCatalogFn);
  const checkCompatibility = useServerFn(checkSkillCompatibilityFn);

  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<Array<{ path: string; content: string }> | null>(null);
  const [compatibilityWarning, setCompatibilityWarning] = useState<CompatibilityWarning | null>(null);
  const [hasCheckedCompatibility, setHasCheckedCompatibility] = useState(false);

  // Handle drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  // Handle drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      await validateAndParseFile(droppedFile);
    }
  }, []);

  // Handle file input change
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await validateAndParseFile(e.target.files[0]);
    }
  };

  // Validate file type and parse
  const validateAndParseFile = async (selectedFile: File) => {
    setError(null);
    setParsedFiles(null);
    setCompatibilityWarning(null);
    setHasCheckedCompatibility(false);

    // Check file extension
    const fileName = selectedFile.name.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.skill')) {
      setError(toLocalizedString(content.upload.errorInvalidFormat));
      return;
    }

    // Check file size (max 10 MB)
    const maxSize = 10 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError(toLocalizedString(content.upload.errorFileSize));
      return;
    }

    setFile(selectedFile);
    setIsUploading(true);

    try {
      // Read and parse zip file
      const arrayBuffer = await selectedFile.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      // Convert zip to file array
      const files: Array<{ path: string; content: string }> = [];

      // Check for SKILL.md
      let hasSkillMd = false;
      const fileCount = Object.keys(zip.files).length;

      if (fileCount > 100) {
        throw new Error(toLocalizedString(content.upload.errorTooManyFiles));
      }

      // Process all files
      for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir) {
          const fileContent = await zipEntry.async('string');

          // Check if this is SKILL.md
          if (path.endsWith('SKILL.md') || path === 'SKILL.md') {
            hasSkillMd = true;
          }

          files.push({
            path,
            content: fileContent,
          });
        }
      }

      if (!hasSkillMd) {
        throw new Error(toLocalizedString(content.upload.errorNoSkillMd));
      }

      setParsedFiles(files);
      setIsUploading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : toLocalizedString(content.upload.errorParseFailed));
      setIsUploading(false);
      setFile(null);
    }
  };

  // Upload skill
  const handleUpload = async () => {
    if (!parsedFiles || parsedFiles.length === 0) {
      setError(toLocalizedString(content.upload.errorSelectFile));
      return;
    }

    // Step 1: Check compatibility first
    if (!hasCheckedCompatibility) {
      setIsChecking(true);
      setError(null);
      try {
        const checkResult = await checkCompatibility({
          data: { files: parsedFiles },
        });
        setCompatibilityWarning(checkResult);
        setHasCheckedCompatibility(true);
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : toLocalizedString(content.upload.errorCompatCheck));
      } finally {
        setIsChecking(false);
      }
      return;
    }

    // Step 2: Proceed with upload
    setIsUploading(true);
    setError(null);

    try {
      // Extract skill name from SKILL.md
      const skillMd = parsedFiles.find(f => f.path.endsWith('SKILL.md') || f.path === 'SKILL.md');
      if (!skillMd) {
        throw new Error(toLocalizedString(content.upload.errorNoSkillMdFound));
      }

      // Parse frontmatter to get skill name
      const nameMatch = skillMd.content.match(/^name:\s*(.+)$/m);
      const skillName = nameMatch ? nameMatch[1].trim() : file?.name.replace(/\.(zip|skill)$/i, '');

      // Upload using server function
      await uploadSkill({
        data: {
          name: skillName,
          files: parsedFiles,
        },
      });

      // Success
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : toLocalizedString(content.upload.errorUploadFailed));
      setIsUploading(false);
    }
  };

  // Reset compatibility check (e.g., after selecting new file)
  const handleReset = () => {
    setFile(null);
    setError(null);
    setDragActive(false);
    setParsedFiles(null);
    setCompatibilityWarning(null);
    setHasCheckedCompatibility(false);
  };

  // Reset to check compatibility again (e.g., after selecting new file)
  const handleRecheck = () => {
    setCompatibilityWarning(null);
    setHasCheckedCompatibility(false);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{content.upload.title}</DialogTitle>
          <DialogDescription>
            {content.upload.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload Area */}
          <div
            className={`
              relative border-2 border-dashed rounded-lg p-8
              transition-colors
              ${dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            {isUploading && !parsedFiles ? (
              // Parsing state
              <div className="flex flex-col items-center space-y-3">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">{content.upload.parsing}</p>
              </div>
            ) : file && parsedFiles ? (
              // File parsed successfully
              <div className="flex flex-col items-center space-y-2">
                <FileArchive className="h-12 w-12 text-green-600" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {toLocalizedString(content.upload.filesCount).replace('{count}', String(parsedFiles.length))}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-muted-foreground"
                >
                  {content.upload.reselect}
                </Button>
              </div>
            ) : (
              // Upload prompt
              <div className="flex flex-col items-center space-y-3 text-center">
                <Upload className="h-12 w-12 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {content.upload.dragPrompt}
                  </p>
                  <label className="text-primary hover:underline cursor-pointer">
                    {content.upload.clickToSelect}
                    <input
                      type="file"
                      className="hidden"
                      accept=".zip,.skill"
                      onChange={handleFileChange}
                      disabled={isUploading}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: content.upload.formatHelp }} />
              </div>
            )}
          </div>

          {/* Compatibility Warnings */}
          {compatibilityWarning && compatibilityWarning.formattedWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <TriangleAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium text-amber-600 dark:text-amber-400">
                    {content.upload.compatibilityWarning}
                  </p>
                  <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                    {compatibilityWarning.formattedWarnings.map((warning, idx) => (
                      <p key={idx}>{warning}</p>
                    ))}
                  </div>
                  <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
                    {content.upload.compatibilityAdvice}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            {compatibilityWarning && compatibilityWarning.formattedWarnings.length > 0 && (
              <Button
                variant="outline"
                onClick={handleRecheck}
                disabled={isUploading}
              >
                {content.upload.recheck}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                handleReset();
              }}
              disabled={isUploading || isChecking}
            >
              {content.upload.cancel}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!parsedFiles || parsedFiles.length === 0 || isChecking || isUploading}
            >
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {content.upload.checking}
                </>
              ) : isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {content.upload.uploading}
                </>
              ) : hasCheckedCompatibility && compatibilityWarning?.formattedWarnings.length > 0 ? (
                <>
                  <AlertCircle className="h-4 w-4 mr-2" />
                  {content.upload.stillUpload}
                </>
              ) : (
                content.upload.uploadButton
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
