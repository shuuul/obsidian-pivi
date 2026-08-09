import type { AtomicWorkspaceFileStore, WorkspaceFileStat } from '../../../ports';
import { PIVI_SESSION_ROOT, requireVaultSessionPath } from '../../../session/vaultSessionPaths';

export interface SessionContentRevision {
  sha256: string;
  bytes: number;
}

export interface SessionJsonlSnapshot {
  path: string;
  content: string;
  revision: SessionContentRevision;
}

export interface SessionJsonlCatalogEntry {
  path: string;
  stat?: WorkspaceFileStat;
}

export interface SessionJsonlStorage {
  list(): Promise<SessionJsonlCatalogEntry[]>;
  read(path: string): Promise<SessionJsonlSnapshot>;
  create(path: string, content: string): Promise<SessionJsonlSnapshot>;
  append(path: string, content: string, expectedRevision: SessionContentRevision): Promise<SessionJsonlSnapshot>;
  replace(path: string, content: string, expectedRevision: SessionContentRevision): Promise<SessionJsonlSnapshot>;
  delete(path: string, expectedRevision?: SessionContentRevision): Promise<void>;
}

export class SessionRevisionError extends Error {
  constructor(readonly path: string) {
    super(`Session content revision is stale: ${path}`);
    this.name = 'SessionRevisionError';
  }
}

export class SessionWriteUncertainError extends Error {
  constructor(readonly path: string, options?: ErrorOptions) {
    super(`Session mutation could not be verified: ${path}`, options);
    this.name = 'SessionWriteUncertainError';
  }
}

export type SessionDigest = (bytes: ArrayBuffer) => Promise<ArrayBuffer>;

function revisionsEqual(left: SessionContentRevision, right: SessionContentRevision): boolean {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function validateAppend(content: string): void {
  if (!content || !content.endsWith('\n')) {
    throw new TypeError('Appended JSONL must contain complete records ending in LF');
  }
  const lines = content.slice(0, -1).split('\n');
  for (const line of lines) {
    if (!line) throw new TypeError('Appended JSONL records must be non-empty');
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new TypeError('Appended JSONL records must be valid JSON objects', { cause: error });
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Appended JSONL records must be JSON objects');
    }
  }
}

export class FileStoreSessionJsonlStorage implements SessionJsonlStorage {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly files: AtomicWorkspaceFileStore,
    private readonly digest: SessionDigest = async (bytes) => crypto.subtle.digest('SHA-256', bytes),
    private readonly sanitizeWrite: (content: string) => string = content => content,
  ) {}

  async list(): Promise<SessionJsonlCatalogEntry[]> {
    if (!(await this.files.exists(PIVI_SESSION_ROOT))) return [];
    const paths = (await this.files.listFilesRecursive(PIVI_SESSION_ROOT))
      .filter((path) => path.endsWith('.jsonl'))
      .map(requireVaultSessionPath)
      .sort();
    return Promise.all(paths.map(async (path) => {
      try {
        const stat = await this.files.stat(path);
        return stat ? { path, stat } : { path };
      } catch {
        return { path };
      }
    }));
  }

  async read(path: string): Promise<SessionJsonlSnapshot> {
    const validPath = requireVaultSessionPath(path);
    return this.snapshot(validPath, await this.files.read(validPath));
  }

  async create(path: string, content: string): Promise<SessionJsonlSnapshot> {
    const validPath = requireVaultSessionPath(path);
    return this.serialize(validPath, async () => {
      if (await this.files.exists(validPath)) throw new Error(`Session already exists: ${validPath}`);
      await this.files.ensureFolder(validPath.slice(0, validPath.lastIndexOf('/')));
      const safeContent = this.sanitizeWrite(content);
      try {
        await this.files.write(validPath, safeContent);
      } catch (error) {
        try {
          const landed = await this.read(validPath);
          if (landed.content === safeContent) return landed;
        } catch {
          // The write result is still unknown; preserve the original failure as cause.
        }
        throw new SessionWriteUncertainError(validPath, { cause: error });
      }
      return this.verify(validPath, safeContent);
    });
  }

  async append(path: string, content: string, expectedRevision: SessionContentRevision): Promise<SessionJsonlSnapshot> {
    const validPath = requireVaultSessionPath(path);
    validateAppend(content);
    return this.serialize(validPath, async () => {
      const before = await this.read(validPath);
      this.requireRevision(validPath, before.revision, expectedRevision);
      return this.commit(validPath, (current) => {
        if (current !== before.content) throw new SessionRevisionError(validPath);
        const safeContent = this.sanitizeWrite(content);
        validateAppend(safeContent);
        return current + safeContent;
      });
    });
  }

  async replace(path: string, content: string, expectedRevision: SessionContentRevision): Promise<SessionJsonlSnapshot> {
    const validPath = requireVaultSessionPath(path);
    return this.serialize(validPath, async () => {
      const before = await this.read(validPath);
      this.requireRevision(validPath, before.revision, expectedRevision);
      return this.commit(validPath, (current) => {
        if (current !== before.content) throw new SessionRevisionError(validPath);
        return this.sanitizeWrite(content);
      });
    });
  }

  async delete(path: string, expectedRevision?: SessionContentRevision): Promise<void> {
    const validPath = requireVaultSessionPath(path);
    await this.serialize(validPath, async () => {
      if (expectedRevision) {
        const before = await this.read(validPath);
        this.requireRevision(validPath, before.revision, expectedRevision);
      }
      await this.files.delete(validPath);
    });
  }

  private requireRevision(path: string, actual: SessionContentRevision, expected: SessionContentRevision): void {
    if (!revisionsEqual(actual, expected)) throw new SessionRevisionError(path);
  }

  private async snapshot(path: string, content: string): Promise<SessionJsonlSnapshot> {
    const bytes = new TextEncoder().encode(content);
    const hash = new Uint8Array(await this.digest(bytes.buffer));
    const sha256 = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { path, content, revision: { sha256, bytes: bytes.byteLength } };
  }

  private async commit(
    path: string,
    transform: (current: string) => string,
  ): Promise<SessionJsonlSnapshot> {
    let committed: string;
    let expectedContent: string | undefined;
    try {
      committed = await this.files.process(path, (current) => {
        expectedContent = transform(current);
        return expectedContent;
      });
    } catch (error) {
      if (error instanceof SessionRevisionError) throw error;
      throw new SessionWriteUncertainError(path, { cause: error });
    }
    if (expectedContent === undefined || committed !== expectedContent) {
      throw new SessionWriteUncertainError(path);
    }
    return this.snapshot(path, committed);
  }

  private async verify(path: string, expectedContent: string): Promise<SessionJsonlSnapshot> {
    try {
      const actual = await this.read(path);
      if (actual.content !== expectedContent) throw new SessionWriteUncertainError(path);
      return actual;
    } catch (error) {
      if (error instanceof SessionWriteUncertainError) throw error;
      throw new SessionWriteUncertainError(path, { cause: error });
    }
  }

  private async serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(path, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(path) === current) this.queues.delete(path);
    }
  }
}
