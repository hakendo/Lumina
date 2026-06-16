# Deduplicación por hash SHA-256 y upsert por campo ID en sync

Cada sync almacena un hash SHA-256 (primeros 16 chars) del conjunto de filas ordenadas por clave en `config.dataHash`. Si el hash coincide con el sync anterior, se omite completamente la escritura a la DB. Cuando el usuario configura un `idField`, syncs posteriores hacen upsert fila a fila (insert, update, delete por diferencia) en lugar de borrar y reinsertar todo.

## Alternativas consideradas

- **Borrar y reinsertar siempre**: simple pero destruye el historial de IDs y genera escrituras innecesarias cuando la fuente no cambió. Descartado porque con datasets grandes el costo de escritura es alto y los widgets perderían consistencia durante el sync.
- **Timestamp del último sync sin hash**: evita el sync si no pasó suficiente tiempo, pero no detecta si los datos realmente cambiaron. Descartado porque el criterio correcto es la igualdad de datos, no el tiempo.
- **Hash + upsert (elegido)**: el hash es O(n) en lectura y evita cualquier escritura si no hay cambios. El upsert por `idField` preserva filas no modificadas y es correcto para fuentes que entregan deltas implícitos. El `idField` es opt-in para no forzar a fuentes sin clave natural a designar una.

## Consecuencias

- `idField` tiene tres estados: `undefined` (nunca configurado → modal de primera vez), `null` (explícitamente sin ID → delete+insert), `"campo"` (upsert por ese campo).
- El hash depende del orden de claves dentro de cada fila y del orden de filas — ambos normalizados antes de hashear.
