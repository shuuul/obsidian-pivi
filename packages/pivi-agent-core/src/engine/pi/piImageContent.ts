import type { ImageContent } from '@earendil-works/pi-ai';

import type { ImageAttachment } from '../../foundation';

export function toPiImageContent(
  images: ImageAttachment[] | undefined,
): ImageContent[] {
  return (images ?? []).map((image) => ({
    type: 'image',
    data: image.data,
    mimeType: image.mediaType,
  }));
}
