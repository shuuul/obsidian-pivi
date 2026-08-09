import * as fs from "fs";

import { App } from "obsidian";

import { HomeFileAdapter, ObsidianVaultFileAdapter } from "@pivi/obsidian-host";

describe("VaultFileAdapter", () => {
  function createAdapter(initialFiles: Record<string, string> = {}) {
    const app = new App();
    const files = new Map(Object.entries(initialFiles));
    const readMock = jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined)
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    });
    const writeMock = jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    });
    const appendMock = jest.fn(async (path: string, content: string) => {
      files.set(path, (files.get(path) ?? "") + content);
    });
    const processMock = jest.fn(async (path: string, transform: (content: string) => string) => {
      const next = transform(files.get(path) ?? "");
      files.set(path, next);
      return next;
    });

    app.vault.adapter.exists = jest.fn(async (path: string) => files.has(path));
    app.vault.adapter.read = readMock;
    app.vault.adapter.write = writeMock;
    app.vault.adapter.append = appendMock;
    app.vault.adapter.process = processMock;
    app.vault.adapter.mkdir = jest.fn(async () => undefined);

    return {
      adapter: new ObsidianVaultFileAdapter(app),
      files,
      readMock,
      writeMock,
      appendMock,
      processMock,
    };
  }

  it("uses DataAdapter.append for vault appends", async () => {
    const { adapter, files, appendMock, readMock, writeMock } = createAdapter({
      "log.jsonl": "before\n",
    });

    await expect(
      adapter.append("log.jsonl", "after\n"),
    ).resolves.toBeUndefined();

    expect(appendMock).toHaveBeenCalledWith("log.jsonl", "after\n");
    expect(readMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(files.get("log.jsonl")).toBe("before\nafter\n");
  });

  it("uses DataAdapter.process for atomic transforms", async () => {
    const { adapter, files, processMock } = createAdapter({ "log.jsonl": "before\n" });

    await expect(adapter.process("log.jsonl", content => `${content}after\n`))
      .resolves.toBe("before\nafter\n");

    expect(processMock).toHaveBeenCalledTimes(1);
    expect(files.get("log.jsonl")).toBe("before\nafter\n");
  });

  it("rejects append failures", async () => {
    const { adapter, appendMock } = createAdapter({ "log.jsonl": "before\n" });
    const failure = new Error("disk full");
    appendMock.mockRejectedValueOnce(failure);

    await expect(adapter.append("log.jsonl", "after\n")).rejects.toBe(failure);
  });

  it("allows later appends after a failed append without read/write fallback", async () => {
    const { adapter, files, appendMock, readMock, writeMock } = createAdapter({
      "log.jsonl": "before\n",
    });
    appendMock.mockRejectedValueOnce(new Error("transient append failure"));

    await expect(adapter.append("log.jsonl", "failed\n")).rejects.toThrow(
      "transient append failure",
    );
    await expect(
      adapter.append("log.jsonl", "after\n"),
    ).resolves.toBeUndefined();

    expect(appendMock).toHaveBeenCalledTimes(2);
    expect(readMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
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
