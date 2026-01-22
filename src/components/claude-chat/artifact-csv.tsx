/**
 * CSV Artifact Component
 *
 * Renders CSV content as an interactive data table.
 */

import type { FC } from 'react';
import { useState, useMemo } from 'react';
import { Copy, Check, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

interface CSVArtifactProps {
  content: string;
  title?: string;
}

/**
 * Parse CSV content into rows
 */
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Simple CSV parser (handles basic cases)
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        if (nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = false;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);

  return { headers, rows };
}

const PAGE_SIZE = 50;

export const CSVArtifact: FC<CSVArtifactProps> = ({ content, title }) => {
  const [copied, setCopied] = useState(false);
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  const { headers, rows } = useMemo(() => parseCSV(content), [content]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (sortColumn === null) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sortColumn] || '';
      const bVal = b[sortColumn] || '';
      // Try numeric comparison
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortAsc ? aNum - bNum : bNum - aNum;
      }
      // String comparison
      return sortAsc
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    });
  }, [rows, sortColumn, sortAsc]);

  // Paginated rows
  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);
  const paginatedRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (colIndex: number) => {
    if (sortColumn === colIndex) {
      setSortAsc(!sortAsc);
    } else {
      setSortColumn(colIndex);
      setSortAsc(true);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (headers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">空的 CSV 数据</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">CSV</span>
          <span className="text-xs text-muted-foreground">
            {rows.length} 行 × {headers.length} 列
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span className="text-xs">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="text-xs">复制</span>
            </>
          )}
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-muted/50 backdrop-blur">
            <tr>
              <th className="border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground w-12">
                #
              </th>
              {headers.map((header, index) => (
                <th
                  key={`header-${index}`}
                  className="border-b px-3 py-2 text-left text-xs font-medium cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleSort(index)}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{header || `列${index + 1}`}</span>
                    <ArrowUpDown
                      className={cn(
                        'h-3 w-3 shrink-0',
                        sortColumn === index
                          ? 'text-primary'
                          : 'text-muted-foreground opacity-50'
                      )}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, rowIndex) => (
              <tr
                key={`row-${page * PAGE_SIZE + rowIndex}`}
                className="hover:bg-muted/20 transition-colors"
              >
                <td className="border-b px-3 py-1.5 text-xs text-muted-foreground">
                  {page * PAGE_SIZE + rowIndex + 1}
                </td>
                {headers.map((_, colIndex) => (
                  <td
                    key={`cell-${rowIndex}-${colIndex}`}
                    className="border-b px-3 py-1.5 max-w-xs truncate"
                    title={row[colIndex] || ''}
                  >
                    {row[colIndex] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            第 {page + 1} / {totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-7 w-7"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="h-7 w-7"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CSVArtifact;
