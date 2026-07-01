import type { ImageAttachment } from '../../../../src/pi/types';
import { restoreQueuedMessageToInput } from '../../../../src/features/chat/controllers/inputQueueRestore';

function createImage(id: string): ImageAttachment {
  return {
    id,
    name: `${id}.png`,
    mediaType: 'image/png',
    data: 'abc',
    size: 3,
    source: 'paste',
  };
}

describe('restoreQueuedMessageToInput', () => {
  it('restores queued content and images into an empty composer', () => {
    const image = createImage('queued');
    const inputEl = { value: 'draft', focus: jest.fn() };
    const imageContextManager = {
      getAttachedImages: jest.fn(() => [createImage('current')]),
      setImages: jest.fn(),
    };
    const resetInputHeight = jest.fn();

    restoreQueuedMessageToInput({
      message: {
        content: 'queued text',
        images: [image],
        editorContext: null,
        canvasContext: null,
      },
      inputEl: inputEl as never,
      imageContextManager: imageContextManager as never,
      resetInputHeight,
    });

    expect(inputEl.value).toBe('queued text');
    expect(imageContextManager.getAttachedImages).not.toHaveBeenCalled();
    expect(imageContextManager.setImages).toHaveBeenCalledWith([image]);
    expect(resetInputHeight).toHaveBeenCalled();
    expect(inputEl.focus).toHaveBeenCalled();
  });

  it('merges queued content and images with the current composer', () => {
    const queuedImage = createImage('queued');
    const currentImage = createImage('current');
    const inputEl = { value: 'current text', focus: jest.fn() };
    const imageContextManager = {
      getAttachedImages: jest.fn(() => [currentImage]),
      setImages: jest.fn(),
    };

    restoreQueuedMessageToInput({
      message: {
        content: 'queued text',
        images: [queuedImage],
        editorContext: null,
        canvasContext: null,
      },
      inputEl: inputEl as never,
      imageContextManager: imageContextManager as never,
      resetInputHeight: jest.fn(),
      mergeWithComposer: true,
    });

    expect(inputEl.value).toBe('queued text\n\ncurrent text');
    expect(imageContextManager.setImages).toHaveBeenCalledWith([queuedImage, currentImage]);
  });

  it('does nothing for an empty queued message', () => {
    const inputEl = { value: 'current text', focus: jest.fn() };
    const resetInputHeight = jest.fn();

    restoreQueuedMessageToInput({
      message: null,
      inputEl: inputEl as never,
      imageContextManager: null,
      resetInputHeight,
      mergeWithComposer: true,
    });

    expect(inputEl.value).toBe('current text');
    expect(resetInputHeight).not.toHaveBeenCalled();
    expect(inputEl.focus).not.toHaveBeenCalled();
  });
});
