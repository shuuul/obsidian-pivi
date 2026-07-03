import { createContextBadgeElement } from '@/ui/shared/context-badge/ContextBadgeRenderer';

export interface FileChipsViewCallbacks {
  onRemoveAttachment: (path: string) => void;
  onOpenFile: (path: string) => void;
}

export class FileChipsView {
  private containerEl: HTMLElement;
  private callbacks: FileChipsViewCallbacks;
  private fileIndicatorEl: HTMLElement;

  constructor(containerEl: HTMLElement, callbacks: FileChipsViewCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;

    const firstChild = this.containerEl.firstChild;
    this.fileIndicatorEl = this.containerEl.createDiv({ cls: 'pivi-file-indicator' });
    if (firstChild) {
      this.containerEl.insertBefore(this.fileIndicatorEl, firstChild);
    }
  }

  destroy(): void {
    this.fileIndicatorEl.remove();
  }

  renderCurrentNote(filePath: string | null): void {
    this.fileIndicatorEl.empty();

    if (!filePath) {
      this.fileIndicatorEl.removeClass('pivi-visible-flex');
      this.fileIndicatorEl.addClass('pivi-hidden');
      return;
    }

    this.fileIndicatorEl.addClass('pivi-visible-flex');
    this.fileIndicatorEl.removeClass('pivi-hidden');
    this.renderFileChip(filePath, () => {
      this.callbacks.onRemoveAttachment(filePath);
    });
  }

  private renderFileChip(filePath: string, onRemove: () => void): void {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const filename = normalizedPath.split('/').pop() || filePath;
    this.fileIndicatorEl.appendChild(createContextBadgeElement({
      kind: 'attachment',
      token: filePath,
      path: filePath,
      label: filename,
    }, {
      onClick: () => this.callbacks.onOpenFile(filePath),
      onRemove: () => onRemove(),
    }));
  }
}
