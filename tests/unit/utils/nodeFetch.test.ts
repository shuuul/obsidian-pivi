import { readFileSync } from 'node:fs';
import path from 'node:path';

import { applyNodeFetchDefaultHeaders } from '@pivi/obsidian-host/nodeFetch';

const packageVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
).version as string;

describe('nodeFetch', () => {
  it('adds default headers for Node HTTP requests', () => {
    const headers = new Headers();

    applyNodeFetchDefaultHeaders(headers);

    expect(headers.get('user-agent')).toBe(`Mozilla/5.0 Pivi/${packageVersion}`);
    expect(headers.get('accept')).toBe('*/*');
  });

  it('preserves caller-provided headers', () => {
    const headers = new Headers({
      accept: 'application/json',
      'user-agent': 'CustomAgent/1.0',
    });

    applyNodeFetchDefaultHeaders(headers);

    expect(headers.get('user-agent')).toBe('CustomAgent/1.0');
    expect(headers.get('accept')).toBe('application/json');
  });
});
