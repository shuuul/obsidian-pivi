/**
 * Shared contract for remote model catalog refresh outcomes. The engine
 * (`@pivi/engine-pi`) produces it, while settings ports and UI surfaces in
 * app/React consume it without importing the engine.
 */
export interface ModelCatalogRefreshResult {
  /**
   * `updated`: a fresh catalog overlay was applied. `current`: the cached
   * catalog is inside its freshness window or unchanged (ETag). `unavailable`:
   * the provider has no remote catalog; bundled models remain in effect.
   */
  readonly status: 'updated' | 'current' | 'unavailable';
  /** Overlay models absent from the bundled baseline. */
  readonly addedModels: number;
  /** Overlay models that replaced a bundled entry by id. */
  readonly updatedModels: number;
  readonly totalModels: number;
}
