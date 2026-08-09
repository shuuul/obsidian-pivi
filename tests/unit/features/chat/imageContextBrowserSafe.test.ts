import { ImageContextManager } from '@/ui/chat/ui/ImageContext';

/**
 * Locks browser-safe filename-extension and base64 helpers without constructing
 * the full DOM graph (createDiv is only needed at construction for previews).
 */
type ImageContextTestAccess = {
  getMediaType(filename: string): string | null;
  fileToBase64(file: File): Promise<string>;
  truncateName(name: string, maxLen: number): string;
};

function createManagerForHelpers(): ImageContextTestAccess {
  const manager = Object.create(ImageContextManager.prototype) as ImageContextManager;
  return manager as unknown as ImageContextTestAccess;
}

describe('ImageContextManager browser-safe helpers', () => {
  it('resolves image media types from filename extensions without path.extname', () => {
    const helpers = createManagerForHelpers();
    expect(helpers.getMediaType('photo.PNG')).toBe('image/png');
    expect(helpers.getMediaType('a/b/c.JPEG')).toBe('image/jpeg');
    expect(helpers.getMediaType('note.md')).toBeNull();
  });

  it('encodes file bytes as standard base64 without Buffer', async () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    const file = {
      name: 'hi.png',
      type: 'image/png',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as File;
    const encoded = await createManagerForHelpers().fileToBase64(file);
    expect(encoded).toBe(btoa('Hi'));
  });

  it('truncates long names while preserving the extension', () => {
    // maxLen 12, ext ".png" (4) => base slice length 12 - 4 - 3 = 5
    // "veryl" + "..." + ".png" === "veryl....png"
    expect(createManagerForHelpers().truncateName('verylongfilename.png', 12)).toBe('veryl....png');
  });
});
