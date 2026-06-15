# Dataset Derivado como tipo persistente (no join en memoria)

Para combinar fuentes de datos (joins, columnas calculadas, filtros), se crea un Dataset Derivado persistente en la base de datos en lugar de hacer joins ad-hoc por widget. Se implementa como `sourceType: 'derived'` en el modelo Dataset existente, con la lógica de transformación en el campo `config`. Decidimos contra joins en memoria por widget porque la lógica se duplicaría en cada widget, sería irrepetible, y no podría ser reutilizada por otros reportes del área.

## Considered Options

- **Join en memoria por widget**: descartado — lógica no reutilizable, duplicación, sin trazabilidad.
- **Modelo separado `DerivedDataset`**: descartado — innecesario, el polimorfismo por `sourceType` ya existe en el schema.
