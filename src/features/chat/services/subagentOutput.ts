import { existsSync, readFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, sep } from 'path';

const TRUSTED_OUTPUT_EXT = '.output';
const TRUSTED_TMP_ROOTS = resolveTrustedTmpRoots();

export function extractFullOutputPath(content: string): string | null {
  const truncatedPattern = /\[Truncated\.\s*Full output:\s*([^\]\n]+)\]/i;
  const match = content.match(truncatedPattern);
  if (!match || !match[1]) {
    return null;
  }

  const outputPath = match[1].trim();
  return outputPath.length > 0 ? outputPath : null;
}

export function readTrustedFullOutputFile(fullOutputPath: string): string | null {
  try {
    if (!isTrustedOutputPath(fullOutputPath)) {
      return null;
    }

    if (!existsSync(fullOutputPath)) {
      return null;
    }

    const fileContent = readFileSync(fullOutputPath, 'utf-8');
    const trimmed = fileContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function resolveTrustedTmpRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [tmpdir(), '/tmp', '/private/tmp'];
  for (const candidate of candidates) {
    try {
      roots.add(realpathSync(candidate));
    } catch {
      // Ignore unavailable temp roots.
    }
  }
  return Array.from(roots);
}

function isTrustedOutputPath(fullOutputPath: string): boolean {
  if (!isAbsolute(fullOutputPath)) {
    return false;
  }

  if (!fullOutputPath.toLowerCase().endsWith(TRUSTED_OUTPUT_EXT)) {
    return false;
  }

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(fullOutputPath);
  } catch {
    return false;
  }

  return TRUSTED_TMP_ROOTS.some((root) =>
    resolvedPath === root || resolvedPath.startsWith(`${root}${sep}`)
  );
}
