import type { ImageAttachment } from '@pivi/agent/runtime';
import {
  chatTurnRequestFromSnapshot,
  cloneImages,
  hasMissingImagePayload,
} from '@pivi/agent/runtime/queuedTurn';

function image(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    id: 'img-1',
    name: 'shot.png',
    mediaType: 'image/png',
    data: 'abc123',
    size: 6,
    source: 'paste',
    ...overrides,
  };
}

describe('cloneImages', () => {
  it('copies attachments without sharing the original records', () => {
    const original = [image()];
    const cloned = cloneImages(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned?.[0]).not.toBe(original[0]);

    if (!cloned?.[0]) {
      throw new Error('Expected a cloned attachment');
    }
    cloned[0].data = '';
    expect(original[0]?.data).toBe('abc123');
  });

  it('drops empty payloads instead of preserving blank image records', () => {
    expect(cloneImages([
      image({ id: 'empty', data: '', size: 0 }),
      image({ id: 'kept', data: 'payload' }),
    ])).toEqual([image({ id: 'kept', data: 'payload' })]);
    expect(cloneImages([image({ data: '   ', size: 0 })])).toBeUndefined();
  });
});

describe('hasMissingImagePayload', () => {
  it('detects blank base64 bytes on otherwise present attachments', () => {
    expect(hasMissingImagePayload(undefined)).toBe(false);
    expect(hasMissingImagePayload([image()])).toBe(false);
    expect(hasMissingImagePayload([image({ data: '' })])).toBe(true);
    expect(hasMissingImagePayload([image({ data: '   ' })])).toBe(true);
  });
});

describe('chatTurnRequestFromSnapshot', () => {
  it('restores only attachments that still have image bytes', () => {
    const request = chatTurnRequestFromSnapshot(
      { text: 'see this' },
      [image({ id: 'empty', data: '' }), image({ id: 'kept', data: 'payload' })],
    );

    expect(request.images).toEqual([image({ id: 'kept', data: 'payload' })]);
  });
});
