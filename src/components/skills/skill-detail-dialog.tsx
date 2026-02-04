import { FC, useState, useEffect, useMemo } from 'react';
import { X, File, Folder, FolderOpen, ChevronRight, ChevronDown, Copy, Check, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { useIntlayer } from 'react-intlayer';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { cn } from '~/lib/utils';
import type { SkillDetail, SkillFile } from '~/claude/skills';

/**
 * Parse SKILL.md frontmatter (YAML between --- delimiters)
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

function parseSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  // Simple YAML parsing for key: value pairs
  const frontmatter: SkillFrontmatter = {};
  const lines = yamlContent.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

interface SkillDetailDialogProps {
  skill: SkillDetail | null;
  isOpen: boolean;
  onClose: () => void;
  isInstalled?: boolean;
  onToggleInstall?: () => void;
}

export const SkillDetailDialog: FC<SkillDetailDialogProps> = ({
  skill,
  isOpen,
  onClose,
  isInstalled = false,
  onToggleInstall,
}) => {
  const content = useIntlayer('skills');
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/']));
  const [copied, setCopied] = useState(false);

  // Reset state when skill changes
  useEffect(() => {
    if (skill) {
      setSelectedFile(null);
      setExpandedDirs(new Set(['/']));
    }
  }, [skill?.slug]);

  // Auto-select SKILL.md on first load
  useEffect(() => {
    if (skill && !selectedFile && skill.files.length > 0) {
      const skillMd = findFileByName(skill.files, 'SKILL.md');
      if (skillMd) {
        setSelectedFile(skillMd);
      } else {
        const firstFile = findFirstFile(skill.files);
        if (firstFile) setSelectedFile(firstFile);
      }
    }
  }, [skill, selectedFile]);

  // Parse SKILL.md frontmatter for title/description
  const skillMdParsed = useMemo(() => {
    if (!skill) return null;
    const skillMdFile = findFileByName(skill.files, 'SKILL.md');
    if (!skillMdFile?.content) return null;
    return parseSkillFrontmatter(skillMdFile.content);
  }, [skill]);

  // Use frontmatter values if available, fallback to skill object
  const displayName = skillMdParsed?.frontmatter.name || skill?.name || '';
  const displayDescription = skillMdParsed?.frontmatter.description || skill?.description || '';

  if (!isOpen || !skill) return null;

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleFileClick = (file: SkillFile) => {
    if (file.type === 'dir') {
      toggleDir(file.path);
    } else {
      setSelectedFile(file);
    }
  };

  const handleCopyContent = async () => {
    if (selectedFile?.content) {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-[92vw] max-w-7xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Skill Info with Large Icon */}
        <div className="flex items-stretch border-b">
          {/* Large Icon Area - matches header height, no background */}
          <div className="flex items-center justify-center p-6">
            {skill.iconUrl ? (
              <img
                src={skill.iconUrl}
                alt={displayName}
                className="w-32 h-32 object-contain"
                onError={(e) => {
                  // Fallback to letter avatar on error
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div
              className={cn(
                "w-32 h-32 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-4xl font-bold text-primary",
                skill.iconUrl && "hidden"
              )}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          </div>

          {/* Title & Description */}
          <div className="flex-1 flex flex-col justify-center px-8 py-6">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold tracking-tight">{displayName}</h2>
              {skill.store === 'user' && (
                <Badge variant="outline" className="text-xs">
                  {content.card.custom}
                </Badge>
              )}
            </div>
            {displayDescription && (
              <p className="text-base text-muted-foreground max-w-2xl leading-relaxed">
                {displayDescription}
              </p>
            )}
            {skill.category && (
              <div className="flex items-center gap-2 mt-3">
                <Badge variant="secondary" className="text-xs font-normal">
                  {skill.category}
                </Badge>
              </div>
            )}
          </div>

          {/* Close Button */}
          <div className="p-4">
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* File Tree Sidebar */}
          <div className="w-64 border-r bg-muted/30 overflow-y-auto">
            <div className="p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {content.detail.filesLabel}
              </h3>
              <FileTree
                files={skill.files}
                expandedDirs={expandedDirs}
                selectedFile={selectedFile}
                onFileClick={handleFileClick}
                level={0}
              />
            </div>
          </div>

          {/* File Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col bg-background">
            {selectedFile ? (
              <>
                {/* File Header Bar */}
                <div className="flex items-center justify-between border-b px-6 py-3 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <FileIcon filename={selectedFile.name} />
                    <span className="font-medium text-sm">{selectedFile.name}</span>
                    {selectedFile.size !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        ({formatFileSize(selectedFile.size)})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedFile.content && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyContent}
                        className="h-8 gap-1.5 text-xs"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            {content.detail.copied}
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            {content.detail.copy}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* File Content */}
                <div className="flex-1 overflow-y-auto">
                  <FileContent file={selectedFile} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p>{content.detail.selectFile}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4 bg-muted/20">
          {onToggleInstall && (
            <Button
              variant={isInstalled ? 'outline' : 'default'}
              onClick={onToggleInstall}
              className={cn(
                isInstalled && 'text-destructive hover:text-destructive hover:bg-destructive/10'
              )}
            >
              {isInstalled ? content.detail.uninstall : content.detail.install}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// File icon based on extension
const FileIcon: FC<{ filename: string }> = ({ filename }) => {
  const ext = filename.split('.').pop()?.toLowerCase();

  // Different colors for different file types
  const colorClass = useMemo(() => {
    switch (ext) {
      case 'md':
        return 'text-blue-500';
      case 'ts':
      case 'tsx':
        return 'text-blue-600';
      case 'js':
      case 'jsx':
        return 'text-yellow-500';
      case 'json':
        return 'text-green-500';
      case 'css':
      case 'scss':
        return 'text-pink-500';
      case 'html':
        return 'text-orange-500';
      default:
        return 'text-muted-foreground';
    }
  }, [ext]);

  return <File className={cn('h-4 w-4', colorClass)} />;
};

interface FileTreeProps {
  files: SkillFile[];
  expandedDirs: Set<string>;
  selectedFile: SkillFile | null;
  onFileClick: (file: SkillFile) => void;
  level: number;
}

const FileTree: FC<FileTreeProps> = ({
  files,
  expandedDirs,
  selectedFile,
  onFileClick,
  level,
}) => {
  return (
    <div className={cn('space-y-0.5', level > 0 && 'ml-3 border-l border-border/50 pl-2')}>
      {files.map((file) => {
        const isExpanded = expandedDirs.has(file.path);
        const isSelected = selectedFile?.path === file.path;

        return (
          <div key={file.path}>
            <div
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all',
                isSelected
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'hover:bg-muted text-foreground/80 hover:text-foreground'
              )}
              onClick={() => onFileClick(file)}
            >
              {file.type === 'dir' ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <span className="flex-1 truncate">{file.name}</span>
                </>
              ) : (
                <>
                  <div className="h-3.5 w-3.5 shrink-0" />
                  <FileIcon filename={file.name} />
                  <span className="flex-1 truncate">{file.name}</span>
                </>
              )}
            </div>
            {file.type === 'dir' && isExpanded && file.children && (
              <FileTree
                files={file.children}
                expandedDirs={expandedDirs}
                selectedFile={selectedFile}
                onFileClick={onFileClick}
                level={level + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

interface FileContentProps {
  file: SkillFile;
}

const FileContent: FC<FileContentProps> = ({ file }) => {
  const content = useIntlayer('skills');

  if (file.type === 'dir') {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {content.detail.directoryNoContent}
      </div>
    );
  }

  if (file.isBinary) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <File className="h-5 w-5" />
        <span>{content.detail.binaryFile}</span>
      </div>
    );
  }

  if (file.isTooLarge) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <File className="h-5 w-5" />
        <span>{content.detail.tooLarge}</span>
      </div>
    );
  }

  if (file.content === undefined) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <File className="h-5 w-5" />
        <span>{content.detail.noContent}</span>
      </div>
    );
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const isSkillMd = file.name === 'SKILL.md';

  // Markdown files - render as rich content
  if (extension === 'md') {
    return <MarkdownRenderer content={file.content} skipFrontmatter={isSkillMd} />;
  }

  // Code files - syntax highlighting
  return <CodeRenderer content={file.content} filename={file.name} />;
};

interface MarkdownRendererProps {
  content: string;
  skipFrontmatter?: boolean;
}

const MarkdownRenderer: FC<MarkdownRendererProps> = ({ content, skipFrontmatter = false }) => {
  // Parse and optionally skip frontmatter
  const displayContent = useMemo(() => {
    if (!skipFrontmatter) return content;
    const { body } = parseSkillFrontmatter(content);
    return body;
  }, [content, skipFrontmatter]);

  return (
    <div className="p-6 max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        className="prose prose-sm dark:prose-invert max-w-none
          prose-headings:font-semibold prose-headings:tracking-tight
          prose-h1:text-2xl prose-h1:border-b prose-h1:pb-2 prose-h1:mb-4
          prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-3
          prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-2
          prose-p:leading-relaxed prose-p:my-3
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
          prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-[#282c34] prose-pre:rounded-lg prose-pre:p-0 prose-pre:my-4
          prose-ul:my-2 prose-ol:my-2
          prose-li:my-0.5
          prose-blockquote:border-l-primary prose-blockquote:bg-muted/50 prose-blockquote:py-1 prose-blockquote:pr-4 prose-blockquote:rounded-r
        "
        components={{
          // Custom table wrapper for horizontal scrolling
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-lg border">
                <table className="w-full text-sm border-collapse">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="px-4 py-2.5 text-left font-semibold border-b border-r last:border-r-0">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-2.5 border-b border-r last:border-r-0">
                {children}
              </td>
            );
          },
          tr({ children }) {
            return <tr className="hover:bg-muted/50">{children}</tr>;
          },
          // Custom code block renderer with syntax highlighting
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !className;

            if (isInline) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }

            const language = match ? match[1] : 'text';
            const codeString = String(children).replace(/\n$/, '');

            return (
              <SyntaxHighlighter
                style={oneDark}
                language={language}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
              >
                {codeString}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
};

interface CodeRendererProps {
  content: string;
  filename: string;
}

const CodeRenderer: FC<CodeRendererProps> = ({ content, filename }) => {
  const extension = filename.split('.').pop()?.toLowerCase() || '';

  // Map extensions to Prism language names
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
  };

  const language = languageMap[extension] || 'text';

  return (
    <div className="h-full">
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        showLineNumbers
        lineNumberStyle={{
          minWidth: '3em',
          paddingRight: '1em',
          color: '#636d83',
          userSelect: 'none',
        }}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          minHeight: '100%',
          fontSize: '0.875rem',
          lineHeight: '1.5',
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};

// Helper functions
function findFileByName(files: SkillFile[], name: string): SkillFile | null {
  for (const file of files) {
    if (file.type === 'file' && file.name === name) {
      return file;
    }
    if (file.type === 'dir' && file.children) {
      const found = findFileByName(file.children, name);
      if (found) return found;
    }
  }
  return null;
}

function findFirstFile(files: SkillFile[]): SkillFile | null {
  for (const file of files) {
    if (file.type === 'file') {
      return file;
    }
    if (file.type === 'dir' && file.children) {
      const found = findFirstFile(file.children);
      if (found) return found;
    }
  }
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
