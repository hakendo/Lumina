# Evaluador de expresiones aritméticas sin eval ni Function()

Las columnas calculadas de Datasets Derivados usan expresiones aritméticas sobre campos del dataset (ej: `margen = (ingresos - costos) / ingresos`). La evaluación se implementa con un parser recursivo descendente en `services/exprEval.js` en lugar de `eval()` o `new Function()`. Los nombres de campo se sustituyen por valores numéricos antes del parsing; si queda cualquier letra en la expresión ya sustituida, se rechaza.

## Considered Options

- **`eval()` / `new Function()`**: descartado — RCE inmediato si cualquier valor de celda llega malformado o si la expresión proviene de usuario no confiable. El hook de seguridad del proyecto lo bloquea explícitamente.
- **Librería de expresiones (mathjs, expr-eval)**: descartado — dependencia externa solo para aritmética simple; el parser propio es ~100 líneas y cubre el caso de uso completo (+ - * / paréntesis unario minus).
- **Parser recursivo propio (elegido)**: sin dependencias, sin superficie de ataque, auditable en una sola lectura.
