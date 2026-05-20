import { promises as fs } from 'fs';
import path from 'path';

export const DEFAULT_REPORTS_DIR =
  process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');

export interface FilesystemSavedReport {
  id: string;
  filename: string;
  title: string | null;
  summary: string | null;
  storage_path: string;
  report_kind: string | null;
  report_date: string | null;
  created_at: string;
}

export function encodeReportStorageId(storagePath: string): string {
  return `fs_${Buffer.from(storagePath, 'utf8').toString('base64url')}`;
}

export function decodeReportStorageId(id: string): string | null {
  if (!id.startsWith('fs_')) return null;
  try {
    const decoded = Buffer.from(id.slice(3), 'base64url').toString('utf8');
    return sanitizeReportStoragePath(decoded);
  } catch {
    return null;
  }
}

export function sanitizeReportStoragePath(rawPath: string): string | null {
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.includes('..') || !normalized.endsWith('.md')) {
    return null;
  }
  return normalized;
}

export function getReportFilePath(storagePath: string, reportsDir = DEFAULT_REPORTS_DIR): string | null {
  const safePath = sanitizeReportStoragePath(storagePath);
  if (!safePath) return null;
  const absoluteReportsDir = path.resolve(reportsDir);
  const absoluteFilePath = path.resolve(absoluteReportsDir, safePath);
  if (absoluteFilePath !== absoluteReportsDir && absoluteFilePath.startsWith(`${absoluteReportsDir}${path.sep}`)) {
    return absoluteFilePath;
  }
  return null;
}

export async function readReportFile(storagePath: string): Promise<{ content: string; filename: string } | null> {
  const filePath = getReportFilePath(storagePath);
  if (!filePath) return null;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { content, filename: path.basename(filePath) };
  } catch {
    return null;
  }
}

export async function deleteReportFile(storagePath: string): Promise<boolean> {
  const filePath = getReportFilePath(storagePath);
  if (!filePath) return false;
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdownFiles(dir: string, rootDir: string): Promise<string[]> {
  let entries: Array<import('fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(absolutePath, rootDir);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      return [path.relative(rootDir, absolutePath).split(path.sep).join(path.posix.sep)];
    }
    return [];
  }));

  return nested.flat();
}

function deriveReportMeta(content: string, filename: string): Pick<FilesystemSavedReport, 'title' | 'summary'> {
  const codeFence = String.fromCharCode(96).repeat(3);
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || filename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  const summary = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line
      && !line.startsWith('#')
      && !line.startsWith('|')
      && !line.startsWith(codeFence)
      && !line.startsWith('- ')
      && !line.startsWith('_Legend:'))
    || null;
  return { title, summary };
}

export async function listFilesystemReports(): Promise<FilesystemSavedReport[]> {
  const rootDir = path.resolve(DEFAULT_REPORTS_DIR);
  const storagePaths = await collectMarkdownFiles(rootDir, rootDir);
  const reports = await Promise.all(storagePaths.map(async (storagePath): Promise<FilesystemSavedReport | null> => {
    const filePath = getReportFilePath(storagePath);
    if (!filePath) return null;
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
      ]);
      const filename = path.basename(filePath);
      const dateFromPath = storagePath.split('/')[0];
      const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(dateFromPath) ? dateFromPath : null;
      const meta = deriveReportMeta(content, filename);
      const report: FilesystemSavedReport = {
        id: encodeReportStorageId(storagePath),
        filename,
        title: meta.title,
        summary: meta.summary,
        storage_path: storagePath,
        report_kind: null,
        report_date: reportDate,
        created_at: stat.mtime.toISOString(),
      };
      return report;
    } catch {
      return null;
    }
  }));

  return reports
    .filter((report): report is FilesystemSavedReport => Boolean(report))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
