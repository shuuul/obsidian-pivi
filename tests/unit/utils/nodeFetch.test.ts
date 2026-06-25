import { applyNodeFetchDefaultHeaders } from '../../../src/utils/nodeFetch';

describe('nodeFetch', () => {
  it('adds default headers for Node HTTP requests', () => {
    const headers = new Headers();

    applyNodeFetchDefaultHeaders(headers);

    expect(headers.get('user-agent')).toContain('Obsius');
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
