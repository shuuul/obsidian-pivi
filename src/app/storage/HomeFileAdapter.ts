import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { HomeFileStore } from "../../core/storage/FileStore";

/**
 * Filesystem adapter rooted at the user's home directory for agent-owned
 * workspace paths outside the vault.
 */
export class HomeFileAdapter implements HomeFileStore {
  private readonly root: string;

  constructor(root: string = os.homedir()) {
    this.root = root;
  }

  private resolve(relativePath: string): string {
    return path.join(this.root, relativePath);
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolve(p));
      return true;
    } catch {
      return false;
    }
  }

  async read(p: string): Promise<string> {
    return fs.promises.readFile(this.resolve(p), "utf-8");
  }

  async write(p: string, content: string): Promise<void> {
    const full = this.resolve(p);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, content, "utf-8");
  }

  async delete(p: string): Promise<void> {
    try {
      await fs.promises.unlink(this.resolve(p));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async deleteFolder(p: string): Promise<void> {
    try {
      await fs.promises.rmdir(this.resolve(p));
    } catch (err: unknown) {
      if (!isExpectedDeleteFolderError(err)) throw err;
    }
  }

  async listFolders(folder: string): Promise<string[]> {
    const full = this.resolve(folder);
    try {
      const entries = await fs.promises.readdir(full, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => `${folder}/${e.name}`);
    } catch {
      return [];
    }
  }

  async ensureFolder(p: string): Promise<void> {
    await fs.promises.mkdir(this.resolve(p), { recursive: true });
  }
}

function isExpectedDeleteFolderError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTEMPTY";
}
