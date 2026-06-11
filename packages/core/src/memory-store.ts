import { isAbsolute, join, relative, resolve } from 'path';

export const OPENWRITER_STATE_DIR = '.openwriter';
export const OPENWRITER_MEMORY_DIR = join(OPENWRITER_STATE_DIR, 'memory');

export function resolveOpenWriterStateDir(workDir: string): string {
  return resolve(workDir, OPENWRITER_STATE_DIR);
}

export function resolveOpenWriterMemoryDir(workDir: string): string {
  return resolve(workDir, OPENWRITER_MEMORY_DIR);
}

export function resolveOpenWriterMemoryFile(
  workDir: string,
  file: string,
): { absolute: string; relative: string; fileName: string } {
  const memoryDir = resolveOpenWriterMemoryDir(workDir);
  const fileName = normalizeMemoryFileName(file);
  const absolute = resolve(memoryDir, fileName);
  const relToMemory = relative(memoryDir, absolute);
  if (relToMemory.startsWith('..') || isAbsolute(relToMemory)) {
    throw new Error(`memory path escapes OpenWriter state: ${file}`);
  }

  return {
    absolute,
    relative: normalizePath(relative(workDir, absolute)),
    fileName: normalizePath(fileName),
  };
}

export function normalizeMemoryFileName(file: string): string {
  const trimmed = file.trim().replace(/^[/\\]+/, '');
  const withExtension = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
  const segments = withExtension
    .split(/[/\\]+/)
    .filter(Boolean)
    .map(sanitizeMemoryPathSegment);

  return segments.length ? segments.join('/') : 'memory.md';
}

function sanitizeMemoryPathSegment(segment: string): string {
  const cleaned = segment
    .replace(/[<>:"|?*\u0000-\u001F]/g, '-')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return '_';
  return cleaned.slice(0, 120);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}
