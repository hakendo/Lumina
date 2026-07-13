function quoteIdent(name, dbType) {
  if (dbType === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (dbType === 'mssql') return '[' + name.replace(/\]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

function qualifiedTable(table, dbType) {
  const parts = [];
  if (table.schema) parts.push(quoteIdent(table.schema, dbType));
  parts.push(quoteIdent(table.name, dbType));
  return parts.join('.');
}

function validateIdentifier(name, validSet, type) {
  if (!validSet.has(name)) {
    throw new Error(`${type} "${name}" no existe en el esquema`);
  }
}

function buildSelectQuery(definition, dbType, schema) {
  const { tables, columns, joins, limit } = definition;
  if (!tables?.length) throw new Error('Selecciona al menos una tabla');

  const schemaTableNames = new Set(schema.tables.map(t => t.name));
  const schemaColumnMap = new Map();
  for (const t of schema.tables) {
    schemaColumnMap.set(t.name, new Set(t.columns.map(c => c.name)));
  }

  for (const t of tables) {
    validateIdentifier(t.name, schemaTableNames, 'Tabla');
  }

  const aliasMap = new Map();
  tables.forEach((t, i) => {
    const alias = t.alias || `t${i}`;
    aliasMap.set(alias, t);
  });

  // Build FROM clause
  const firstAlias = tables[0].alias || 't0';
  const firstTable = aliasMap.get(firstAlias);
  let fromClause = `${qualifiedTable(firstTable, dbType)} ${quoteIdent(firstAlias, dbType)}`;
  const added = new Set([firstAlias]);

  if (joins?.length) {
    const declared = new Set([firstAlias]);

    // Order joins so each introduces exactly one new table
    const remaining = [...joins];
    const ordered = [];
    let safety = remaining.length * 2;
    while (remaining.length > 0 && safety-- > 0) {
      const idx = remaining.findIndex(j =>
        declared.has(j.leftTable) || declared.has(j.rightTable)
      );
      if (idx === -1) {
        ordered.push(...remaining);
        break;
      }
      ordered.push(remaining.splice(idx, 1)[0]);
      const last = ordered[ordered.length - 1];
      declared.add(last.leftTable);
      declared.add(last.rightTable);
    }

    for (const join of ordered) {
      const joinType = ['INNER', 'LEFT', 'RIGHT'].includes(join.type?.toUpperCase()) ? join.type.toUpperCase() : 'INNER';

      // Determine which side is the new table to add
      let newAlias, onLeft, onRight;
      if (added.has(join.leftTable) && !added.has(join.rightTable)) {
        newAlias = join.rightTable;
        onLeft = join.leftTable;
        onRight = join.rightTable;
      } else if (added.has(join.rightTable) && !added.has(join.leftTable)) {
        newAlias = join.leftTable;
        onLeft = join.leftTable;
        onRight = join.rightTable;
      } else if (added.has(join.leftTable) && added.has(join.rightTable)) {
        // Both already declared — add ON condition to existing (extra join condition)
        // SQL doesn't support this cleanly, use AND in WHERE or just reference it
        // For simplicity, skip duplicate joins
        continue;
      } else {
        // Neither declared — add the right side
        newAlias = join.rightTable;
        onLeft = join.leftTable;
        onRight = join.rightTable;
      }

      const newEntry = aliasMap.get(newAlias);
      if (!newEntry) throw new Error(`Alias "${newAlias}" no encontrado`);

      // Validate join columns against their respective tables
      const leftEntry = aliasMap.get(onLeft);
      const rightEntry = aliasMap.get(onRight);
      if (leftEntry) {
        const leftCols = schemaColumnMap.get(leftEntry.name);
        if (leftCols) validateIdentifier(join.leftColumn, leftCols, `Columna de join en ${leftEntry.name}`);
      }
      if (rightEntry) {
        const rightCols = schemaColumnMap.get(rightEntry.name);
        if (rightCols) validateIdentifier(join.rightColumn, rightCols, `Columna de join en ${rightEntry.name}`);
      }

      fromClause += `\n  ${joinType} JOIN ${qualifiedTable(newEntry, dbType)} ${quoteIdent(newAlias, dbType)}`;
      fromClause += ` ON ${quoteIdent(join.leftTable, dbType)}.${quoteIdent(join.leftColumn, dbType)}`;
      fromClause += ` = ${quoteIdent(join.rightTable, dbType)}.${quoteIdent(join.rightColumn, dbType)}`;

      added.add(newAlias);
    }
  }

  // Build SELECT clause — only after FROM is known, so we can reject columns
  // from tables that were selected but never actually joined into the query.
  let selectClause;
  if (!columns?.length) {
    selectClause = '*';
  } else {
    const colParts = [];
    for (const col of columns) {
      const tableEntry = aliasMap.get(col.table);
      if (!tableEntry) throw new Error(`Alias "${col.table}" no encontrado`);
      if (!added.has(col.table)) {
        throw new Error(`La tabla "${tableEntry.name}" (${col.table}) no está unida a la query — agrega un join o quita sus columnas`);
      }
      const validCols = schemaColumnMap.get(tableEntry.name);
      if (!validCols) throw new Error(`Tabla "${tableEntry.name}" no encontrada en esquema`);

      if (col.column === '*') {
        colParts.push(`${quoteIdent(col.table, dbType)}.*`);
      } else {
        validateIdentifier(col.column, validCols, `Columna en ${tableEntry.name}`);
        const colRef = `${quoteIdent(col.table, dbType)}.${quoteIdent(col.column, dbType)}`;
        colParts.push(col.alias ? `${colRef} AS ${quoteIdent(col.alias, dbType)}` : colRef);
      }
    }
    selectClause = colParts.join(', ');
  }

  let sql = `SELECT ${selectClause}\nFROM ${fromClause}`;

  if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0) {
    const n = Number(limit);
    if (dbType === 'mssql') {
      sql = sql.replace('SELECT ', `SELECT TOP ${n} `);
    } else if (dbType === 'oracle') {
      sql += `\nFETCH FIRST ${n} ROWS ONLY`;
    } else {
      sql += `\nLIMIT ${n}`;
    }
  }

  return sql;
}

module.exports = { buildSelectQuery };
