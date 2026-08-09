/** Reads truncated subagent full-output files. Desktop composition injects the implementation. */
export type TrustedFullOutputReader = (fullOutputPath: string) => string | null;

let trustedFullOutputReader: TrustedFullOutputReader | null = null;

/** Desktop composition installs the Node-backed reader; Mobile leaves this unset. */
export function configureTrustedFullOutputReader(reader: TrustedFullOutputReader | null): void {
  trustedFullOutputReader = reader;
}

export function extractFullOutputPath(content: string): string | null {
  const truncatedPattern = /\[Truncated\.\s*Full output:\s*([^\]\n]+)\]/i;
  const match = content.match(truncatedPattern);
  if (!match || !match[1]) {
    return null;
  }

  const outputPath = match[1].trim();
  return outputPath.length > 0 ? outputPath : null;
}

/** Delegates to the Desktop-injected reader; returns null when none is configured. */
export function readTrustedFullOutputFile(fullOutputPath: string): string | null {
  return trustedFullOutputReader?.(fullOutputPath) ?? null;
}
