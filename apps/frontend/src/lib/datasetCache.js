// Caché en memoria de filas por dataset, compartido entre widgets.
// Invalidar tras cualquier operación que cambie las filas (sync, re-upload).
export const CACHE = {};

export function invalidateDatasetCache(datasetId) {
  delete CACHE[datasetId];
}
