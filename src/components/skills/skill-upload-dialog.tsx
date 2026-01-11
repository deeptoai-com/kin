import { FC, useState, useCallback } from 'react';
import { Upload, X, FileArchive, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { useServerFn } from '@tanstack/react-start';
import { uploadUserSkillFn } from '~/server/function/skills.server';
import JSZip from 'jszip';

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
  const uploadSkill = useServerFn(uploadUserSkillFn);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<Array<{ path: string; content: string }> | null>(null);

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

    // Check file extension
    const fileName = selectedFile.name.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.skill')) {
      setError('仅支持 .zip 或 .skill 格式的文件');
      return;
    }

    // Check file size (max 10 MB)
    const maxSize = 10 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError('文件大小不能超过 10 MB');
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
        throw new Error('文件数量超过限制（最多 100 个文件）');
      }

      // Process all files
      for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir) {
          const content = await zipEntry.async('string');

          // Check if this is SKILL.md
          if (path.endsWith('SKILL.md') || path === 'SKILL.md') {
            hasSkillMd = true;
          }

          files.push({
            path,
            content,
          });
        }
      }

      if (!hasSkillMd) {
        throw new Error('技能包必须包含 SKILL.md 文件');
      }

      setParsedFiles(files);
      setIsUploading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析文件失败');
      setIsUploading(false);
      setFile(null);
    }
  };

  // Upload skill
  const handleUpload = async () => {
    if (!parsedFiles || parsedFiles.length === 0) {
      setError('请先选择有效的技能包');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Extract skill name from SKILL.md
      const skillMd = parsedFiles.find(f => f.path.endsWith('SKILL.md') || f.path === 'SKILL.md');
      if (!skillMd) {
        throw new Error('未找到 SKILL.md 文件');
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
      setError(err instanceof Error ? err.message : '上传失败');
      setIsUploading(false);
    }
  };

  // Reset state
  const handleReset = () => {
    setFile(null);
    setError(null);
    setDragActive(false);
    setParsedFiles(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上传技能</DialogTitle>
          <DialogDescription>
            上传包含 SKILL.md 的技能包，支持 .zip 或 .skill 格式
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
                <p className="text-sm text-muted-foreground">解析文件中...</p>
              </div>
            ) : file && parsedFiles ? (
              // File parsed successfully
              <div className="flex flex-col items-center space-y-2">
                <FileArchive className="h-12 w-12 text-green-600" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {parsedFiles.length} 个文件
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-muted-foreground"
                >
                  重新选择
                </Button>
              </div>
            ) : (
              // Upload prompt
              <div className="flex flex-col items-center space-y-3 text-center">
                <Upload className="h-12 w-12 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    拖拽文件到此处，或
                  </p>
                  <label className="text-primary hover:underline cursor-pointer">
                    点击选择文件
                    <input
                      type="file"
                      className="hidden"
                      accept=".zip,.skill"
                      onChange={handleFileChange}
                      disabled={isUploading}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  支持 .zip 或 .skill 格式，最大 10 MB<br />
                  必须包含 SKILL.md 文件
                </p>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                handleReset();
              }}
              disabled={isUploading}
            >
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!parsedFiles || parsedFiles.length === 0 || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  上传中...
                </>
              ) : (
                '上传'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
