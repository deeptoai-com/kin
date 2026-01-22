/**
 * Skills Compatibility Checker
 *
 * Detects potential compatibility issues with skills before installation.
 *
 * Checks for:
 * - Browser/CDP dependencies (playwright, puppeteer, selenium, etc.)
 * - MCP server dependencies
 *
 * Performance protections:
 * - Skips files larger than MAX_FILE_SIZE (1MB)
 * - Uses async file operations
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Maximum file size to scan (1 MB)
 * Larger files are skipped to avoid performance issues
 */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/**
 * Negative keywords that indicate browser/CDP dependencies
 */
const BROWSER_KEYWORDS = [
  'playwright',
  'puppeteer',
  'selenium',
  'cdp',
  'chrome-devtools',
  'chromium',
  'headless',
  'browser automation',
  'screenshot',
  '@anthropic-ai/claude-agent-sdk/browser',
];

/**
 * MCP-related keywords
 */
const MCP_KEYWORDS = [
  'mcp__',
  '@modelcontextprotocol',
  'mcp-server',
  'mcp server',
];

/**
 * File extensions to check for skill dependencies
 */
const CHECKABLE_EXTENSIONS = [
  '.md',
  '.ts',
  '.js',
  '.py',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
];

/**
 * Files that commonly contain dependency information
 */
const DEPENDENCY_FILES = [
  'SKILL.md',
  'requirements.txt',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'skill.ts',
  'skill.js',
  'skill.py',
];

/**
 * Compatibility check result
 */
export interface CompatibilityCheckResult {
  compatible: boolean;
  warnings: string[];
}

/**
 * Check if a file should be scanned for compatibility issues
 */
function shouldCheckFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // Check by extension
  if (CHECKABLE_EXTENSIONS.includes(ext)) {
    return true;
  }

  // Check by basename (dependency files)
  if (DEPENDENCY_FILES.includes(basename)) {
    return true;
  }

  return false;
}

/**
 * Scan a single file for compatibility issues
 * Skips files larger than MAX_FILE_SIZE for performance
 */
async function scanFile(filePath: string): Promise<string[]> {
  const warnings: string[] = [];

  try {
    // Check file size before reading (performance protection)
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      // Skip large files
      return warnings;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const contentLower = content.toLowerCase();

    // Check for browser/CDP dependencies
    for (const keyword of BROWSER_KEYWORDS) {
      if (contentLower.includes(keyword)) {
        warnings.push(`Browser/CDP dependency detected: "${keyword}"`);
        break; // Only report once per file
      }
    }

    // Check for MCP dependencies (report each unique MCP)
    const mcpMatches = contentLower.match(/mcp__[a-z0-9_-]+/gi) || [];
    const uniqueMcp = [...new Set(mcpMatches)];
    for (const mcp of uniqueMcp) {
      warnings.push(`MCP dependency detected: "${mcp}"`);
    }

    // Check for generic MCP references
    if (contentLower.includes('@modelcontextprotocol') || contentLower.includes('mcp-server') || contentLower.includes('mcp server')) {
      if (!warnings.some(w => w.includes('MCP'))) {
        warnings.push('MCP dependency detected (may require MCP server)');
      }
    }
  } catch (error) {
    // Skip files that can't be read
  }

  return warnings;
}

/**
 * Recursively scan a directory for compatibility issues
 */
async function scanDirectory(dirPath: string, maxDepth = 5, currentDepth = 0): Promise<string[]> {
  const warnings: string[] = [];

  if (currentDepth >= maxDepth) {
    return warnings;
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Scan files in parallel for better performance
    const scanPromises: Promise<string[]>[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip node_modules, .git, and other common exclusions
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.venv' ||
        entry.name === 'venv' ||
        entry.name === '__pycache__' ||
        entry.name.startsWith('.')
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        scanPromises.push(scanDirectory(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && shouldCheckFile(fullPath)) {
        // Scan individual files
        scanPromises.push(scanFile(fullPath));
      }
    }

    // Collect all warnings from parallel scans
    const allWarnings = await Promise.all(scanPromises);
    for (const fileWarnings of allWarnings) {
      warnings.push(...fileWarnings);
    }
  } catch (error) {
    // Skip directories that can't be read
  }

  return warnings;
}

/**
 * Check skill compatibility by scanning its files
 *
 * @param skillPath - Path to the skill directory
 * @returns Compatibility check result with warnings
 */
export async function checkSkillCompatibility(skillPath: string): Promise<CompatibilityCheckResult> {
  // Validate path exists
  try {
    await fs.access(skillPath);
  } catch {
    return {
      compatible: true,
      warnings: [],
    };
  }

  const warnings = await scanDirectory(skillPath);

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(warnings)];

  // Skills are always "compatible" (we just warn)
  return {
    compatible: true,
    warnings: uniqueWarnings,
  };
}

/**
 * Format compatibility warnings for user display
 */
export function formatCompatibilityWarnings(result: CompatibilityCheckResult): string[] {
  const messages: string[] = [];

  if (result.warnings.length === 0) {
    return messages;
  }

  // Group warnings by type
  const browserWarnings = result.warnings.filter(w =>
    w.includes('Browser') || w.includes('CDP')
  );
  const mcpWarnings = result.warnings.filter(w => w.includes('MCP'));

  if (browserWarnings.length > 0) {
    messages.push(
      '⚠️ 该技能可能依赖浏览器/CDP 功能（如 Playwright、Puppeteer 等），',
      '安装后可能无法正常使用，请谨慎安装。'
    );
  }

  if (mcpWarnings.length > 0) {
    const mcpList = mcpWarnings
      .map(w => w.match(/mcp__[a-z0-9_-]+/i)?.[0])
      .filter(Boolean)
      .join(', ');

    if (mcpList) {
      messages.push(
        `⚠️ 该技能可能依赖 MCP 服务器: ${mcpList}`,
        '安装后可能无法正常使用，请谨慎安装。'
      );
    } else {
      messages.push(
        '⚠️ 该技能可能依赖 MCP 服务器，',
        '安装后可能无法正常使用，请谨慎安装。'
      );
    }
  }

  return messages;
}
