import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import type { App, WorkspaceLeaf } from "obsidian";

import {
  activatePiviView,
  ensurePiviViewOpen,
  openPiviNewTab,
} from "@/app/piviViewActivation";
import { createMockApp } from "@test/helpers/mockApp";

function createView(createTab = jest.fn(async () => undefined)) {
  return {
    leaf: {} as WorkspaceLeaf,
    getChatHandle: () => ({
      commands: {
        createTab,
        getState: () => ({ canCreateTab: true }),
      },
      maintenance: {},
    }),
  };
}

describe("Pivi view activation", () => {
  it("awaits revealing an existing deferred view", async () => {
    const app = createMockApp();
    const leaf = { view: createView() } as unknown as WorkspaceLeaf;
    app.workspace.getLeavesOfType = jest.fn().mockReturnValue([leaf]);
    let finishReveal!: () => void;
    app.workspace.revealLeaf = jest.fn(() => new Promise<void>((resolve) => {
      finishReveal = resolve;
    }));

    const activation = activatePiviView(app, "right-sidebar");
    let settled = false;
    void activation.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    finishReveal();
    await activation;
    expect(settled).toBe(true);
  });

  it.each([
    ["main-tab", "getLeaf", ["tab"]],
    ["left-sidebar", "getLeftLeaf", [false]],
    ["right-sidebar", "getRightLeaf", [false]],
  ] as const)("creates a %s leaf and reveals it", async (placement, getter, args) => {
    const app = createMockApp();
    const leaf = {
      setViewState: jest.fn(async () => undefined),
    } as unknown as WorkspaceLeaf;
    app.workspace.getLeavesOfType = jest.fn().mockReturnValue([]);
    app.workspace[getter] = jest.fn().mockReturnValue(leaf);
    app.workspace.revealLeaf = jest.fn(async () => undefined);

    await activatePiviView(app, placement);

    expect(app.workspace[getter]).toHaveBeenCalledWith(...args);
    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_PIVI,
      active: true,
    });
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it("resolves a view that becomes available while reveal completes", async () => {
    const app = createMockApp();
    const view = createView();
    const leaf = {
      view,
      setViewState: jest.fn(async () => undefined),
    } as unknown as WorkspaceLeaf;
    let calls = 0;
    app.workspace.getLeavesOfType = jest.fn(() => {
      calls += 1;
      return calls === 1 ? [] : [leaf];
    });
    app.workspace.getRightLeaf = jest.fn().mockReturnValue(leaf);
    app.workspace.revealLeaf = jest.fn(async () => undefined);

    await expect(ensurePiviViewOpen(app, "right-sidebar")).resolves.toBe(view);
  });

  it("does not stack a blank tab on a cold open without restored tabs", async () => {
    const app = createMockApp();
    const createTab = jest.fn(async () => undefined);
    const view = createView(createTab);
    const leaf = {
      view,
      setViewState: jest.fn(async () => undefined),
    } as unknown as WorkspaceLeaf;
    let calls = 0;
    app.workspace.getLeavesOfType = jest.fn(() => (++calls === 1 ? [] : [leaf]));
    app.workspace.getRightLeaf = jest.fn().mockReturnValue(leaf);
    app.workspace.revealLeaf = jest.fn(async () => undefined);

    await openPiviNewTab(app, "right-sidebar", {
      activeTabId: null,
      openTabs: [],
    });

    expect(createTab).not.toHaveBeenCalled();
  });
});
