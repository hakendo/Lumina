// In-memory row cache shared across all widgets.
// PENDING deduplicates simultaneous fetches for the same dataset.
export const CACHE = {};
export const PENDING = {}; // { datasetId: Promise<rows[]> }

export function invalidateDatasetCache(datasetId) {
  delete CACHE[datasetId];
  delete PENDING[datasetId];
}
