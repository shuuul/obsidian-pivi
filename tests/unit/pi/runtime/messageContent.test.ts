import { extractTextContent } from '@pivi/pivi-agent-core/runtime/messageContent';

describe('extractTextContent', () => {
  it('returns empty string for undefined or empty content', () => {
    expect(extractTextContent(undefined)).toBe('');
    expect(extractTextContent([])).toBe('');
  });

  it('concatenates text blocks in order', () => {
    const text = extractTextContent([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
    ]);
    expect(text).toBe('Hello world');
  });

  it('ignores non-text blocks and blocks without string text', () => {
    const text = extractTextContent([
      { type: 'image', text: 'ignored' },
      { type: 'text', text: 'ok' },
      { type: 'text' },
    ]);
    expect(text).toBe('ok');
  });
});
