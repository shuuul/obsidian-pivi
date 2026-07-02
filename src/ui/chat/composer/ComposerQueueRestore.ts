import { appendMarkdownSnippet } from '../../shared/utils/markdown';
import type { QueuedMessage } from '../state/types';
import type { ImageContextManager } from '../ui/ImageContext';
import type { RichChatInput } from '../ui/RichChatInput';

export interface RestoreQueuedMessageToInputOptions {
  message: QueuedMessage | null;
  inputEl: RichChatInput;
  imageContextManager: ImageContextManager | null;
  resetInputHeight: () => void;
  mergeWithComposer?: boolean;
}

export function restoreQueuedMessageToInput(
  options: RestoreQueuedMessageToInputOptions,
): void {
  if (!options.message) {
    return;
  }

  const { content, images } = options.message;
  const currentContent = options.mergeWithComposer ? options.inputEl.value.trim() : '';
  options.inputEl.value = currentContent
    ? appendMarkdownSnippet(content, currentContent)
    : content;

  const currentImages = options.mergeWithComposer
    ? (options.imageContextManager?.getAttachedImages() ?? [])
    : [];
  const restoredImages = [...(images ?? []), ...currentImages];
  if (restoredImages.length > 0) {
    options.imageContextManager?.setImages(restoredImages);
  }

  options.resetInputHeight();
  options.inputEl.focus();
}
