import {
  pickDirectoryPath,
  validateDirectoryPath,
} from "@/app/ui/externalDirectory";

function createHostWindow(result: { canceled: boolean; filePaths: string[] }) {
  const showOpenDialog = jest.fn(async () => result);
  const hostRequire = jest.fn(() => ({ remote: { dialog: { showOpenDialog } } }));
  const hostWindow = { require: hostRequire } as unknown as Window;
  return { hostRequire, hostWindow, showOpenDialog };
}

describe("external directory helpers", () => {
  it("uses the owning window Electron bridge and returns the selected directory", async () => {
    const harness = createHostWindow({
      canceled: false,
      filePaths: ["/external/research"],
    });

    await expect(pickDirectoryPath({
      hostWindow: harness.hostWindow,
      title: "Choose a folder",
    })).resolves.toBe("/external/research");

    expect(harness.hostRequire).toHaveBeenCalledWith("electron");
    expect(harness.showOpenDialog).toHaveBeenCalledWith({
      properties: ["openDirectory"],
      title: "Choose a folder",
    });
  });

  it.each([
    { canceled: true, filePaths: ["/ignored"] },
    { canceled: false, filePaths: [] },
  ])("returns null when no directory is selected", async (result) => {
    const { hostWindow } = createHostWindow(result);
    await expect(pickDirectoryPath({ hostWindow })).resolves.toBeNull();
  });

  it("fails explicitly when the desktop Electron bridge is unavailable", async () => {
    const hostWindow = { require: jest.fn(() => ({})) } as unknown as Window;
    await expect(pickDirectoryPath({ hostWindow })).rejects.toThrow(
      "Electron remote API is unavailable",
    );
  });

  it("validates accessible directories and rejects files or missing paths", () => {
    expect(validateDirectoryPath(process.cwd())).toEqual({ valid: true });
    expect(validateDirectoryPath(__filename)).toEqual({
      valid: false,
      error: "Path exists but is not a directory",
    });
    expect(validateDirectoryPath(`${__filename}.missing`)).toEqual({
      valid: false,
      error: "Path does not exist",
    });
  });
});
