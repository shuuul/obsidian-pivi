/** In-session open state for provider <details> cards across settings redisplay. */
const expandedProviderIds = new Set<string>();

export function setProviderCardExpanded(providerId: string, open: boolean): void {
  if (open) {
    expandedProviderIds.add(providerId);
  } else {
    expandedProviderIds.delete(providerId);
  }
}

export function isProviderCardExpanded(providerId: string): boolean {
  return expandedProviderIds.has(providerId);
}
