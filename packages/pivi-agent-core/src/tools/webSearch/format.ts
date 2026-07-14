import type { WebFetchResponse, WebSearchResponse } from './types';

export function formatResponse(response: WebSearchResponse): string {
  const links = response.sources.map((source) => ({
    title: source.title,
    url: source.url,
  }));
  const lines: string[] = [];
  lines.push(`Links: ${JSON.stringify(links)}`);
  lines.push(`Provider: ${response.provider}`);
  lines.push(`Query: ${response.query}`);
  if (response.summary) {
    lines.push(`Summary: ${response.summary}`);
  }
  const snippets = response.sources
    .filter((source) => source.snippet)
    .slice(0, 5)
    .map((source) => `- ${source.title}: ${source.snippet}`);
  if (snippets.length > 0) {
    lines.push('Sources:');
    lines.push(...snippets);
  }
  return lines.join('\n');
}

export function formatFetchResponse(response: WebFetchResponse): string {
  const lines = [`URL: ${response.url}`, `Provider: ${response.provider}`];
  if (response.title) {
    lines.push(`Title: ${response.title}`);
  }
  lines.push('', response.content);
  return lines.join('\n');
}
