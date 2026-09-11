import type { ImageContent } from '@earendil-works/pi-ai';
import type { ImageAttachment } from '@pivi/agent/runtime';

export function toPiImageContent(
  images: ImageAttachment[] | undefined,
): ImageContent[] {
  return (images ?? [])
    .filter((image) => image.data.trim().length > 0)
    .map((image) => ({
      type: 'image',
      data: image.data,
      mimeType: image.mediaType,
    }));
}
