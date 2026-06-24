const { getPooledPg, getPooledMysql, getPooledMssql } = require('./dataParser');

async function estimateQueryCost(dbType, connectionString, sqlQuery) {
  const result = { estimatedRows: null, hasFullTableScan: false, warnings: [], planSummary: '' };

  try {
    switch (dbType) {
      case 'pg': return await estimatePg(connectionString, sqlQuery, result);
      case 'mysql': return await estimateMysql(connectionString, sqlQuery, result);
      case 'mssql': return await estimateMssql(connectionString, sqlQuery, result);
      default: return result;
    }
  } catch {
    return result;
  }
}

async function estimatePg(connectionString, sqlQuery, result) {
  const pool = await getPooledPg(connectionString);
  const { rows } = await pool.query(`EXPLAIN (FORMAT JSON) ${sqlQuery}`);
  const plan = rows[0]?.['QUERY PLAN']?.[0]?.Plan;
  if (!plan) return result;

  result.estimatedRows = plan['Plan Rows'] ?? null;
  result.planSummary = JSON.stringify(plan, null, 2).slice(0, 500);

  const checkScan = (node) => {
    if (node['Node Type'] === 'Seq Scan' && (node['Plan Rows'] ?? 0) > 10000) {
      result.hasFullTableScan = true;
    }
    for (const child of node.Plans || []) checkScan(child);
  };
  checkScan(plan);

  addWarnings(result);
  return result;
}

async function estimateMysql(connectionString, sqlQuery, result) {
  const pool = await getPooledMysql(connectionString);
  const [rows] = await pool.execute(`EXPLAIN ${sqlQuery}`);
  if (!rows?.length) return result;

  let totalRows = 0;
  for (const row of rows) {
    totalRows += Number(row.rows || 0);
    if (row.type === 'ALL') result.hasFullTableScan = true;
  }
  result.estimatedRows = totalRows;
  result.planSummary = rows.map(r => `${r.table}: type=${r.type} rows=${r.rows}`).join('\n');

  addWarnings(result);
  return result;
}

async function estimateMssql(connectionString, sqlQuery, result) {
  const pool = await getPooledMssql(connectionString);
  try {
    const stripped = sqlQuery.replace(/^SELECT\s+(TOP\s+\d+\s+)?(.+?)\sFROM\s/is, 'SELECT 1 AS _x FROM ');
    const countQuery = `SELECT COUNT_BIG(1) AS cnt FROM (${stripped}) AS _est`;
    const countResult = await pool.request().query(countQuery);
    const cnt = Number(countResult.recordset?.[0]?.cnt);
    if (!isNaN(cnt)) result.estimatedRows = cnt;
    result.planSummary = `Filas: ${cnt ?? 'desconocido'}`;
  } catch (e) {
    try {
      const tables = sqlQuery.match(/FROM\s+(\[?\w+\]?\.\[?\w+\]?)/i);
      if (tables?.[1]) {
        const r = await pool.request().query(`SELECT SUM(p.rows) AS cnt FROM sys.partitions p JOIN sys.tables t ON p.object_id = t.object_id WHERE p.index_id IN (0,1) AND t.name = '${tables[1].replace(/[\[\]]/g, '').split('.').pop()}'`);
        const cnt = r.recordset?.[0]?.cnt;
        if (typeof cnt === 'number') { result.estimatedRows = cnt; result.planSummary = `Filas estimadas (tabla principal): ${cnt}`; return result; }
      }
    } catch {}
    result.planSummary = 'No se pudo estimar';
  }

  addWarnings(result);
  return result;
}

function addWarnings(result) {
  if (result.estimatedRows !== null && result.estimatedRows > 50000) {
    result.warnings.push({
      level: 'warning',
      message: `Consulta estimada en ~${result.estimatedRows.toLocaleString()} filas. Considera agregar un LIMIT.`,
      suggestLimit: true,
    });
  }
  if (result.hasFullTableScan) {
    result.warnings.push({
      level: 'critical',
      message: 'Scan completo de tabla detectado. La consulta puede ser lenta en tablas grandes.',
      suggestLimit: false,
    });
  }
}

module.exports = { estimateQueryCost };
