import { setIcon, setTooltip } from 'obsidian';

/**
 * The Obsidian mock renders nothing for icons and tooltips. These probes make
 * them observable in jsdom as `data-test-icon` and `title`.
 */
export function installObsidianPresentationProbes(): void {
  beforeEach(() => {
    jest.mocked(setIcon).mockImplementation((container, name) => {
      container.dataset.testIcon = name;
    });
    jest.mocked(setTooltip).mockImplementation((container, label) => {
      container.title = label;
    });
  });
  afterEach(() => {
    jest.mocked(setIcon).mockReset();
    jest.mocked(setTooltip).mockReset();
  });
}
