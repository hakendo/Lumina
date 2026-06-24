const crypto = require('crypto');
const { getPooledPg, getPooledMysql, getPooledMssql, poolKey } = require('./dataParser');

const CACHE_TTL = 60_000;
const cache = new Map();

function cacheKey(dbType, connectionString) {
  return 'schema:' + poolKey(dbType, connectionString);
}

function getCached(dbType, connectionString) {
  const key = cacheKey(dbType, connectionString);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(dbType, connectionString, data) {
  cache.set(cacheKey(dbType, connectionString), { data, ts: Date.now() });
}

async function withTimeout(promise, ms = 10_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Introspección excedió el tiempo límite')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── PostgreSQL ───────────────────────────────────────────────────────

async function introspectPg(connectionString) {
  const pool = await getPooledPg(connectionString);

  const tablesQuery = `
    SELECT t.table_schema AS schema, t.table_name AS name, t.table_type,
           c.column_name, c.data_type, c.is_nullable,
           CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk,
           CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END AS is_fk
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    LEFT JOIN (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.table_schema = c.table_schema AND pk.table_name = c.table_name AND pk.column_name = c.column_name
    LEFT JOIN (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
    ) fk ON fk.table_schema = c.table_schema AND fk.table_name = c.table_name AND fk.column_name = c.column_name
    WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND t.table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY t.table_schema, t.table_name, c.ordinal_position`;

  const fkQuery = `
    SELECT tc.constraint_name,
           kcu.table_schema AS from_schema, kcu.table_name AS from_table, kcu.column_name AS from_column,
           ccu.table_schema AS to_schema, ccu.table_name AS to_table, ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`;

  const [tablesResult, fkResult] = await Promise.all([
    pool.query(tablesQuery),
    pool.query(fkQuery),
  ]);

  return { rows: tablesResult.rows, fkRows: fkResult.rows, engine: 'pg' };
}

// ── MySQL ────────────────────────────────────────────────────────────

async function introspectMysql(connectionString) {
  const pool = await getPooledMysql(connectionString);

  const [[{ db }]] = await pool.execute('SELECT DATABASE() AS db');

  const tablesQuery = `
    SELECT t.TABLE_SCHEMA AS \`schema\`, t.TABLE_NAME AS name, t.TABLE_TYPE AS table_type,
           c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable,
           CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
           CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_fk
    FROM information_schema.TABLES t
    JOIN information_schema.COLUMNS c
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
    LEFT JOIN (
      SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
      FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
    LEFT JOIN (
      SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
      FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) fk ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA AND fk.TABLE_NAME = c.TABLE_NAME AND fk.COLUMN_NAME = c.COLUMN_NAME
    WHERE t.TABLE_SCHEMA = ?
      AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
    ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`;

  const fkQuery = `
    SELECT tc.CONSTRAINT_NAME AS constraint_name,
           kcu.TABLE_SCHEMA AS from_schema, kcu.TABLE_NAME AS from_table, kcu.COLUMN_NAME AS from_column,
           kcu.REFERENCED_TABLE_SCHEMA AS to_schema, kcu.REFERENCED_TABLE_NAME AS to_table, kcu.REFERENCED_COLUMN_NAME AS to_column
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.KEY_COLUMN_USAGE kcu
      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND tc.TABLE_SCHEMA = ?`;

  const [[tablesRows], [fkRows]] = await Promise.all([
    pool.execute(tablesQuery, [db]),
    pool.execute(fkQuery, [db]),
  ]);

  return { rows: tablesRows, fkRows, engine: 'mysql' };
}

// ── SQL Server ───────────────────────────────────────────────────────

async function introspectMssql(connectionString) {
  const pool = await getPooledMssql(connectionString);

  const tablesQuery = `
    SELECT * FROM (
      SELECT s.name AS [schema], t.name, t.type_desc AS table_type,
             c.name AS column_name, tp.name AS data_type, c.is_nullable,
             CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
             CASE WHEN fkc.parent_column_id IS NOT NULL THEN 1 ELSE 0 END AS is_fk,
             c.column_id AS col_order
      FROM sys.tables t
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      JOIN sys.columns c ON c.object_id = t.object_id
      JOIN sys.types tp ON tp.user_type_id = c.user_type_id
      LEFT JOIN (
        SELECT ic.object_id, ic.column_id
        FROM sys.index_columns ic
        JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        WHERE i.is_primary_key = 1
      ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
      LEFT JOIN sys.foreign_key_columns fkc
        ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
      WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
      UNION ALL
      SELECT s.name AS [schema], v.name, 'VIEW' AS table_type,
             c.name AS column_name, tp.name AS data_type, c.is_nullable,
             0 AS is_pk, 0 AS is_fk,
             c.column_id AS col_order
      FROM sys.views v
      JOIN sys.schemas s ON v.schema_id = s.schema_id
      JOIN sys.columns c ON c.object_id = v.object_id
      JOIN sys.types tp ON tp.user_type_id = c.user_type_id
      WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
    ) _all ORDER BY [schema], name, col_order`;

  const fkQuery = `
    SELECT fk.name AS constraint_name,
           ps.name AS from_schema, OBJECT_NAME(fkc.parent_object_id) AS from_table, pc.name AS from_column,
           rs.name AS to_schema, OBJECT_NAME(fkc.referenced_object_id) AS to_table, rc.name AS to_column
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
    JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
    JOIN sys.schemas ps ON fk.schema_id = ps.schema_id
    JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
    JOIN sys.schemas rs ON rt.schema_id = rs.schema_id`;

  const [tablesResult, fkResult] = await Promise.all([
    pool.request().query(tablesQuery),
    pool.request().query(fkQuery),
  ]);

  return { rows: tablesResult.recordset, fkRows: fkResult.recordset, engine: 'mssql' };
}

// ── Oracle ───────────────────────────────────────────────────────────

async function introspectOracle(connectionString) {
  const oracledb = require('oracledb');
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  const conn = await oracledb.getConnection(connectionString);

  try {
    const tablesQuery = `
      SELECT 'TABLE' AS table_type, t.TABLE_NAME AS name, c.COLUMN_NAME, c.DATA_TYPE,
             CASE WHEN c.NULLABLE = 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable,
             CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
             CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_fk
      FROM USER_TABLES t
      JOIN USER_TAB_COLUMNS c ON c.TABLE_NAME = t.TABLE_NAME
      LEFT JOIN (
        SELECT acc.TABLE_NAME, acc.COLUMN_NAME
        FROM USER_CONSTRAINTS ac
        JOIN USER_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
        WHERE ac.CONSTRAINT_TYPE = 'P'
      ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
      LEFT JOIN (
        SELECT acc.TABLE_NAME, acc.COLUMN_NAME
        FROM USER_CONSTRAINTS ac
        JOIN USER_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
        WHERE ac.CONSTRAINT_TYPE = 'R'
      ) fk ON fk.TABLE_NAME = c.TABLE_NAME AND fk.COLUMN_NAME = c.COLUMN_NAME
      UNION ALL
      SELECT 'VIEW' AS table_type, v.VIEW_NAME AS name, c.COLUMN_NAME, c.DATA_TYPE,
             CASE WHEN c.NULLABLE = 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable,
             0 AS is_pk, 0 AS is_fk
      FROM USER_VIEWS v
      JOIN USER_TAB_COLUMNS c ON c.TABLE_NAME = v.VIEW_NAME
      ORDER BY name, COLUMN_NAME`;

    const fkQuery = `
      SELECT ac.CONSTRAINT_NAME,
             acc.TABLE_NAME AS from_table, acc.COLUMN_NAME AS from_column,
             rcc.TABLE_NAME AS to_table, rcc.COLUMN_NAME AS to_column
      FROM USER_CONSTRAINTS ac
      JOIN USER_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
      JOIN USER_CONS_COLUMNS rcc ON ac.R_CONSTRAINT_NAME = rcc.CONSTRAINT_NAME AND acc.POSITION = rcc.POSITION
      WHERE ac.CONSTRAINT_TYPE = 'R'`;

    const [tablesResult, fkResult] = await Promise.all([
      conn.execute(tablesQuery),
      conn.execute(fkQuery),
    ]);

    const rows = (tablesResult.rows ?? []).map(r => ({
      schema: null,
      name: r.NAME,
      table_type: r.TABLE_TYPE,
      column_name: r.COLUMN_NAME,
      data_type: r.DATA_TYPE,
      is_nullable: r.IS_NULLABLE,
      is_pk: r.IS_PK,
      is_fk: r.IS_FK,
    }));

    const fkRows = (fkResult.rows ?? []).map(r => ({
      constraint_name: r.CONSTRAINT_NAME,
      from_schema: null,
      from_table: r.FROM_TABLE,
      from_column: r.FROM_COLUMN,
      to_schema: null,
      to_table: r.TO_TABLE,
      to_column: r.TO_COLUMN,
    }));

    return { rows, fkRows, engine: 'oracle' };
  } finally {
    await conn.close();
  }
}

// ── Normalize results ────────────────────────────────────────────────

function normalize({ rows, fkRows, engine }) {
  const tableMap = new Map();

  for (const row of rows) {
    const schema = row.schema || row.from_schema || null;
    const tKey = `${schema || ''}.${row.name}`;
    if (!tableMap.has(tKey)) {
      const rawType = (row.table_type || '').toUpperCase();
      tableMap.set(tKey, {
        name: row.name,
        schema,
        type: rawType.includes('VIEW') ? 'view' : 'table',
        columns: [],
      });
    }
    tableMap.get(tKey).columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: String(row.is_nullable).toUpperCase() === 'YES' || row.is_nullable === true,
      isPrimaryKey: row.is_pk === true || row.is_pk === 1,
      isForeignKey: row.is_fk === true || row.is_fk === 1,
    });
  }

  const foreignKeys = fkRows.map(r => ({
    constraintName: r.constraint_name,
    fromTable: r.from_table,
    fromSchema: r.from_schema || null,
    fromColumn: r.from_column,
    toTable: r.to_table,
    toSchema: r.to_schema || null,
    toColumn: r.to_column,
  }));

  return { tables: Array.from(tableMap.values()), foreignKeys };
}

// ── Public API ───────────────────────────────────────────────────────

async function introspectSchema(dbType, connectionString) {
  const cached = getCached(dbType, connectionString);
  if (cached) return cached;

  let raw;
  switch (dbType) {
    case 'pg':     raw = await withTimeout(introspectPg(connectionString)); break;
    case 'mysql':  raw = await withTimeout(introspectMysql(connectionString)); break;
    case 'mssql':  raw = await withTimeout(introspectMssql(connectionString)); break;
    case 'oracle': raw = await withTimeout(introspectOracle(connectionString)); break;
    default: throw new Error(`Introspección no soportada para ${dbType}`);
  }

  const result = normalize(raw);
  setCache(dbType, connectionString, result);
  return result;
}

module.exports = { introspectSchema };
