import type { ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import { toPiImageContent } from '@pivi/pivi-agent-core/engine/pi/piImageContent';

function attachmentFixture(
  overrides: Partial<ImageAttachment> & Pick<ImageAttachment, 'id' | 'data' | 'mediaType'>,
): ImageAttachment {
  return {
    name: `${overrides.id}.png`,
    size: overrides.data.length,
    source: 'paste',
    ...overrides,
  };
}

describe('toPiImageContent (core)', () => {
  it('returns an empty array when images are undefined', () => {
    expect(toPiImageContent(undefined)).toEqual([]);
  });

  it('returns an empty array when images are an empty array', () => {
    expect(toPiImageContent([])).toEqual([]);
  });

  it('maps attachments to pi-ai image content preserving order, data, and mimeType', () => {
    const images: ImageAttachment[] = [
      attachmentFixture({ id: 'first', data: 'base64-a', mediaType: 'image/png' }),
      attachmentFixture({ id: 'second', data: 'base64-b', mediaType: 'image/jpeg' }),
      attachmentFixture({ id: 'third', data: 'base64-c', mediaType: 'image/webp' }),
    ];

    expect(toPiImageContent(images)).toEqual([
      { type: 'image', data: 'base64-a', mimeType: 'image/png' },
      { type: 'image', data: 'base64-b', mimeType: 'image/jpeg' },
      { type: 'image', data: 'base64-c', mimeType: 'image/webp' },
    ]);
  });

  it('omits Pivi-only attachment metadata from mapped content', () => {
    const images: ImageAttachment[] = [
      {
        id: 'img-1',
        name: 'screenshot.png',
        mediaType: 'image/png',
        data: 'payload',
        size: 7,
        source: 'drop',
        width: 1920,
        height: 1080,
      },
    ];

    const mapped = toPiImageContent(images);

    expect(mapped).toEqual([{ type: 'image', data: 'payload', mimeType: 'image/png' }]);
    expect(mapped[0]).not.toHaveProperty('id');
    expect(mapped[0]).not.toHaveProperty('name');
    expect(mapped[0]).not.toHaveProperty('size');
    expect(mapped[0]).not.toHaveProperty('source');
    expect(mapped[0]).not.toHaveProperty('width');
    expect(mapped[0]).not.toHaveProperty('height');
    expect(mapped[0]).not.toHaveProperty('mediaType');
  });
});