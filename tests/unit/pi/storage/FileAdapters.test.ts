import * as fs from "fs";

import { App } from "obsidian";

import { HomeFileAdapter } from "../../../../src/app/storage/HomeFileAdapter";
import { ObsidianVaultFileAdapter } from "../../../../src/app/storage/ObsidianVaultFileAdapter";

describe("VaultFileAdapter", () => {
  function createAdapter(initialFiles: Record<string, string> = {}) {
    const app = new App();
    const files = new Map(Object.entries(initialFiles));
    const writeMock = jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    });

    app.vault.adapter.exists = jest.fn(async (path: string) => files.has(path));
    app.vault.adapter.read = jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined)
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    });
    app.vault.adapter.write = writeMock;
    app.vault.adapter.mkdir = jest.fn(async () => undefined);

    return { adapter: new ObsidianVaultFileAdapter(app), files, writeMock };
  }

  it("rejects append write failures", async () => {
    const { adapter, writeMock } = createAdapter({ "log.jsonl": "before\n" });
    const failure = new Error("disk full");
    writeMock.mockRejectedValueOnce(failure);

    await expect(adapter.append("log.jsonl", "after\n")).rejects.toBe(failure);
  });

  it("allows later appends after a failed append", async () => {
    const { adapter, files, writeMock } = createAdapter({
      "log.jsonl": "before\n",
    });
    writeMock.mockRejectedValueOnce(new Error("transient write failure"));

    await expect(adapter.append("log.jsonl", "failed\n")).rejects.toThrow(
      "transient write failure",
    );
    await expect(
      adapter.append("log.jsonl", "after\n"),
    ).resolves.toBeUndefined();

    expect(files.get("log.jsonl")).toBe("before\nafter\n");
  });
});

describe("HomeFileAdapter", () => {
  it("rethrows unexpected deleteFolder errors", async () => {
    const adapter = new HomeFileAdapter("/root-that-should-not-be-used");
    const failure = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    jest
      .spyOn(adapter as unknown as { resolve(path: string): string }, "resolve")
      .mockReturnValue("/root-that-should-not-be-used/folder");
    jest.spyOn(fs.promises, "rmdir").mockRejectedValueOnce(failure);

    await expect(adapter.deleteFolder("folder")).rejects.toBe(failure);
  });
});
