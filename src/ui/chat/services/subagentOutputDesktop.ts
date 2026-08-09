import { existsSync, readFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, sep } from 'path';

const TRUSTED_OUTPUT_EXT = '.output';
const TRUSTED_TMP_ROOTS = resolveTrustedTmpRoots();

/** Desktop-only trusted read of a truncated subagent full-output file. */
export function readTrustedFullOutputFileDesktop(fullOutputPath: string): string | null {
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
