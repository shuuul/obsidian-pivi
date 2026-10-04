import { readFileSync } from 'node:fs';
import path from 'node:path';

import { applyScopedHttpDefaultHeaders } from '@pivi/obsidian-host/scopedHttpClient';

const packageVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
).version as string;

describe('scoped HTTP default headers', () => {
  it('adds default headers for Node HTTP requests', () => {
    const headers = new Headers();

    applyScopedHttpDefaultHeaders(headers);

    expect(headers.get('user-agent')).toBe(`Mozilla/5.0 Pivi/${packageVersion}`);
    expect(headers.get('accept')).toBe('*/*');
  });

  it('preserves caller-provided headers', () => {
    const headers = new Headers({
      accept: 'application/json',
      'user-agent': 'CustomAgent/1.0',
    });

    applyScopedHttpDefaultHeaders(headers);

    expect(headers.get('user-agent')).toBe('CustomAgent/1.0');
    expect(headers.get('accept')).toBe('application/json');
  });
});
