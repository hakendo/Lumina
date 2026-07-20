/**
 * One-time: builds the "Dashboard KPI - Bici Moto QA" report from the KPI
 * queries in querys_KPI.config, rewritten against the REAL schema of the
 * "Bici Moto - QA" DB-connector dataset (Receipt/OutboundOrder/MovementLog/
 * Stock/etc, NOT the "He"/"Dm" prefixed schema the original config file
 * assumed; that schema doesn't exist in this DB, confirmed by introspection).
 *
 * Reuses the existing "Bici Moto - QA" dataset's connection (dbType +
 * connectionString) for every new KPI dataset it creates, so credentials
 * only live encrypted in one place per new row (same encryption service,
 * just re-encrypted per dataset).
 *
 * Idempotent: re-running skips datasets/report/pages/widgets that already
 * exist by name.
 *
 * Usage: node scripts/create-bici-moto-kpi-dashboard.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { resolveConfig } = require('../src/services/dataParser');
const { encrypt } = require('../src/services/encryption');

const prisma = new PrismaClient();

const SOURCE_DATASET_NAME = 'Bici Moto - QA';
const REPORT_NAME = 'Dashboard KPI - Bici Moto QA';

// Catalogo de KPIs.
// kind: 'chart' (1 fila = 1 punto ya agregado en SQL, ratio o sum pre-calculado)
//       'pivot' (row-level, agregacion+filtro client-side)
//       'table' (multi-columna pre-agregada, sin single yField)
const KPIS = [
  // -- Inbound --
  {
    category: 'Inbound',
    name: 'Fill Rate Vendor (resumen)',
    kind: 'kpi',
    sourceName: 'Fill Rate Vendor',
    valueField: 'Ratio',
    aggregation: 'avg',
    suffix: '%',
  },
  {
    category: 'Inbound',
    name: 'Fill Rate Vendor',
    kind: 'chart',
    chartType: 'line',
    xField: 'ReceiptDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT V1.ReceiptDate,
             SUM(V1.ItemQtyReceipt) AS ItemQtyReceipt,
             SUM(V1.ItemQtyInbound) AS ItemQtyInbound,
             CONVERT(DECIMAL(10,3), SUM(V1.ItemQtyReceipt) * 100.0 / NULLIF(SUM(V1.ItemQtyInbound), 0)) AS Ratio
      FROM (
        SELECT R.IdInboundOrder, RD.IdItem,
               SUM(RD.ItemQty) AS ItemQtyReceipt,
               (SELECT TOP 1 ID.ItemQty FROM InboundDetail ID
                 WHERE ID.IdInboundOrder = R.IdInboundOrder AND ID.IdItem = RD.IdItem) AS ItemQtyInbound,
               CONVERT(DATE, R.ReceiptDate) AS ReceiptDate
        FROM ReceiptDetail RD
        INNER JOIN Receipt R ON R.IdReceipt = RD.IdReceipt
        WHERE R.ReceiptDate IS NOT NULL
        GROUP BY R.IdInboundOrder, RD.IdItem, CONVERT(DATE, R.ReceiptDate)
      ) V1
      GROUP BY V1.ReceiptDate
      ORDER BY V1.ReceiptDate`,
  },
  {
    category: 'Inbound',
    name: 'Rejection by Vendor',
    kind: 'table',
    columns: ['TrackDate', 'VendorName', 'CountRejected', 'CountAccepted'],
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, IT.DateTrack) AS TrackDate,
             ISNULL(V.VendorName, 'Sin vendor') AS VendorName,
             SUM(CASE WHEN IT.IdTrackInboundType IN (102, 111) THEN 1 ELSE 0 END) AS CountRejected,
             SUM(CASE WHEN IT.IdTrackInboundType NOT IN (102, 111) THEN 1 ELSE 0 END) AS CountAccepted
      FROM InboundTrack IT
      INNER JOIN InboundOrder IO ON IO.IdInboundOrder = IT.IdInboundOrder
      LEFT JOIN Vendor V ON V.IdVendor = IO.IdVendor
      WHERE IT.IdTrackInboundType IS NOT NULL
      GROUP BY CONVERT(DATE, IT.DateTrack), V.VendorName
      ORDER BY TrackDate`,
  },
  {
    category: 'Inbound',
    name: 'Received LPNs',
    kind: 'pivot',
    rowField: 'MovementDate',
    valueField: 'IdLpnCodeSource',
    aggregation: 'count',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS MovementDate, ML.IdLpnCodeSource, ML.IdItem,
             ML.ItemQtyMov, W.WhsCode, W.WhsName
      FROM MovementLog ML
      LEFT JOIN Warehouse W ON W.IdWhs = ML.IdWhs
      WHERE ML.IdLpnCodeSource IS NOT NULL
        AND ML.IdMovementType IN (53001,53003,53004,53101,53102,53111,53112,53201,53202,53401,53402)`,
  },
  {
    category: 'Inbound',
    name: 'Received Units',
    kind: 'pivot',
    rowField: 'MovementDate',
    valueField: 'ItemQtyMov',
    aggregation: 'sum',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS MovementDate, ML.IdLpnCodeSource, ML.IdItem,
             ML.ItemQtyMov, W.WhsCode, W.WhsName
      FROM MovementLog ML
      LEFT JOIN Warehouse W ON W.IdWhs = ML.IdWhs
      WHERE ML.IdLpnCodeSource IS NOT NULL
        AND ML.IdMovementType IN (53001,53003,53004,53101,53102,53111,53112,53201,53202,53401,53402)`,
  },
  {
    category: 'Inbound',
    name: 'Received Lines',
    kind: 'pivot',
    rowField: 'MovementDate',
    valueField: 'IdMovement',
    aggregation: 'count',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS MovementDate, ML.IdMovement, ML.IdItem,
             ML.ItemQtyMov, W.WhsCode, W.WhsName
      FROM MovementLog ML
      LEFT JOIN Warehouse W ON W.IdWhs = ML.IdWhs
      WHERE ML.IdLpnCodeSource IS NOT NULL
        AND ML.IdMovementType IN (53001,53003,53004,53101,53102,53111,53112,53201,53202,53401,53402)`,
  },
  {
    category: 'Inbound',
    name: 'Stored LPNs',
    kind: 'pivot',
    rowField: 'MovementDate',
    valueField: 'IdLpnCodeSource',
    aggregation: 'count',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS MovementDate, ML.IdLpnCodeSource, ML.IdItem,
             ML.ItemQtyMov, W.WhsCode, W.WhsName
      FROM MovementLog ML
      LEFT JOIN Warehouse W ON W.IdWhs = ML.IdWhs
      WHERE ML.IdLpnCodeSource IS NOT NULL AND ML.IdMovementType = 53002`,
  },

  // -- Inventory --
  {
    category: 'Inventory',
    name: 'Precision (resumen)',
    kind: 'kpi',
    sourceName: 'Accuracy per Location',
    valueField: 'Ratio',
    aggregation: 'avg',
    suffix: '%',
  },
  {
    category: 'Inventory',
    name: 'Warehouse Utilization',
    kind: 'chart',
    chartType: 'bar',
    xField: 'WhsCode',
    yField: 'OccupiedLocations',
    query: `
      SELECT TOP 100 PERCENT W.WhsCode, COUNT(DISTINCT S.IdLocCode) AS OccupiedLocations
      FROM Stock S
      INNER JOIN Warehouse W ON W.IdWhs = S.IdWhs
      GROUP BY W.WhsCode
      ORDER BY W.WhsCode`,
  },
  {
    category: 'Inventory',
    name: 'Stored Stock (Avg Price)',
    kind: 'chart',
    chartType: 'line',
    xField: 'MonthDate',
    yField: 'AvgPrice',
    query: `
      SELECT TOP 100 PERCENT AVG(S.Price) AS AvgPrice,
             CONVERT(DATE, DATEFROMPARTS(YEAR(S.DateCreated), MONTH(S.DateCreated), 1)) AS MonthDate
      FROM Stock S
      WHERE S.DateCreated IS NOT NULL
      GROUP BY DATEFROMPARTS(YEAR(S.DateCreated), MONTH(S.DateCreated), 1)
      ORDER BY MonthDate`,
  },
  {
    category: 'Inventory',
    name: 'SKU per Warehouse',
    kind: 'chart',
    chartType: 'area',
    xField: 'MonthDate',
    yField: 'ItemQty',
    query: `
      SELECT TOP 100 PERCENT SUM(S.ItemQty) AS ItemQty,
             CONVERT(DATE, DATEFROMPARTS(YEAR(S.DateCreated), MONTH(S.DateCreated), 1)) AS MonthDate
      FROM Stock S
      WHERE S.DateCreated IS NOT NULL
      GROUP BY DATEFROMPARTS(YEAR(S.DateCreated), MONTH(S.DateCreated), 1)
      ORDER BY MonthDate`,
  },
  {
    category: 'Inventory',
    name: 'Cubic Meters Stored',
    kind: 'chart',
    chartType: 'area',
    xField: 'MonthDate',
    yField: 'M3',
    query: `
      SELECT TOP 100 PERCENT SUM(S.TotalVolumen) AS M3,
             CONVERT(DATE, DATEFROMPARTS(YEAR(S.DateCreated), MONTH(S.DateCreated), 1)) AS MonthDate
      FROM Stock S
      WHERE S.DateCreated IS NOT NULL
      GROUP BY DATEFROMPARTS(YEAR(S.DateCreated), MONTH(S.DateCreated), 1)
      ORDER BY MonthDate`,
  },
  {
    category: 'Inventory',
    name: 'Accuracy per LPN',
    kind: 'chart',
    chartType: 'line',
    xField: 'MonthDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT
             CONVERT(DECIMAL(10,3), SUM(CASE WHEN ID.QtyActual = ID.ItemQty THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS Ratio,
             CONVERT(DATE, DATEFROMPARTS(YEAR(ID.DateCreated), MONTH(ID.DateCreated), 1)) AS MonthDate
      FROM InventoryDetail ID
      WHERE ID.IdLpnCode IS NOT NULL AND ID.DateCreated IS NOT NULL
      GROUP BY DATEFROMPARTS(YEAR(ID.DateCreated), MONTH(ID.DateCreated), 1)
      ORDER BY MonthDate`,
  },
  {
    category: 'Inventory',
    name: 'Accuracy per Location',
    kind: 'chart',
    chartType: 'line',
    xField: 'MonthDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT
             CONVERT(DECIMAL(10,3), SUM(CASE WHEN ID.QtyActual = ID.ItemQty THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS Ratio,
             CONVERT(DATE, DATEFROMPARTS(YEAR(ID.DateCreated), MONTH(ID.DateCreated), 1)) AS MonthDate
      FROM InventoryDetail ID
      WHERE ID.IdLocCode IS NOT NULL AND ID.DateCreated IS NOT NULL
      GROUP BY DATEFROMPARTS(YEAR(ID.DateCreated), MONTH(ID.DateCreated), 1)
      ORDER BY MonthDate`,
  },

  // -- Picking --
  {
    category: 'Picking',
    name: 'Productividad Unidades (resumen)',
    kind: 'kpi',
    sourceName: 'Units Productivity',
    valueField: 'Ratio',
    aggregation: 'avg',
    suffix: ' u/h',
  },
  {
    category: 'Picking',
    name: 'LPNs Productivity',
    kind: 'chart',
    chartType: 'line',
    xField: 'EndDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS EndDate,
             CONVERT(DECIMAL(10,3), CAST(COUNT(DISTINCT ML.IdLpnCodeSource) AS float) / 8) AS Ratio
      FROM MovementLog ML
      WHERE ML.DocumentType LIKE 'PIK%' AND ML.IdLpnCodeSource IS NOT NULL
      GROUP BY CONVERT(DATE, ML.EndTime)
      ORDER BY EndDate`,
  },
  {
    category: 'Picking',
    name: 'Units Productivity',
    kind: 'chart',
    chartType: 'line',
    xField: 'EndDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS EndDate,
             CONVERT(DECIMAL(10,3), CAST(SUM(ML.ItemQtyMov) AS float) / 8) AS Ratio
      FROM MovementLog ML
      WHERE ML.DocumentType LIKE 'PIK%'
      GROUP BY CONVERT(DATE, ML.EndTime)
      ORDER BY EndDate`,
  },
  {
    category: 'Picking',
    name: 'Lines Productivity',
    kind: 'chart',
    chartType: 'line',
    xField: 'EndDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, ML.EndTime) AS EndDate,
             CONVERT(DECIMAL(10,3), CAST(COUNT(ML.DocumentLineNumber) AS float) / 8) AS Ratio
      FROM MovementLog ML
      WHERE ML.DocumentType LIKE 'PIK%'
      GROUP BY CONVERT(DATE, ML.EndTime)
      ORDER BY EndDate`,
  },

  // -- Outbound --
  {
    category: 'Outbound',
    name: 'Fill Rate Despacho (resumen)',
    kind: 'kpi',
    sourceName: 'Fill Rate Dispatch',
    valueField: 'Ratio',
    aggregation: 'avg',
    suffix: '%',
  },
  {
    category: 'Outbound',
    name: 'LPNs Dispatched',
    kind: 'chart',
    chartType: 'line',
    xField: 'TrackOutboundDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate,
             CONVERT(DECIMAL(10,3), CAST(COUNT(DISTINCT DD.IdLpnCode) AS float) / 8) AS Ratio
      FROM Dispatch D
      INNER JOIN DispatchDetail DD ON DD.IdDispatch = D.IdDispatch
      WHERE D.IdDispatchType IN (6, 23)
      GROUP BY CONVERT(DATE, D.TrackOutboundDate)
      ORDER BY TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'M3 Dispatched',
    kind: 'chart',
    chartType: 'area',
    xField: 'TrackOutboundDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate,
             CONVERT(DECIMAL(10,3), CAST(SUM(DD.ItemQty * I.Volume) AS float) / 8) AS Ratio
      FROM Dispatch D
      INNER JOIN DispatchDetail DD ON DD.IdDispatch = D.IdDispatch
      INNER JOIN Item I ON I.IdItem = DD.IdItem
      WHERE D.IdDispatchType IN (6, 23)
      GROUP BY CONVERT(DATE, D.TrackOutboundDate)
      ORDER BY TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'LPNs Sorted',
    kind: 'chart',
    chartType: 'line',
    xField: 'TrackOutboundDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate,
             CONVERT(DECIMAL(10,3), CAST(COUNT(DISTINCT DD.IdLpnCode) AS float) / 8) AS Ratio
      FROM Dispatch D
      INNER JOIN DispatchDetail DD ON DD.IdDispatch = D.IdDispatch
      WHERE D.IdDispatchType = 11
      GROUP BY CONVERT(DATE, D.TrackOutboundDate)
      ORDER BY TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'Units Sorted',
    kind: 'chart',
    chartType: 'area',
    xField: 'TrackOutboundDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate,
             CONVERT(DECIMAL(10,3), CAST(SUM(DD.ItemQty) AS float) / 8) AS Ratio
      FROM Dispatch D
      INNER JOIN DispatchDetail DD ON DD.IdDispatch = D.IdDispatch
      WHERE D.IdDispatchType = 11
      GROUP BY CONVERT(DATE, D.TrackOutboundDate)
      ORDER BY TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'Lines Sorted',
    kind: 'chart',
    chartType: 'line',
    xField: 'TrackOutboundDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate,
             CONVERT(DECIMAL(10,3), CAST(COUNT(DD.LineNumber) AS float) / 8) AS Ratio
      FROM Dispatch D
      INNER JOIN DispatchDetail DD ON DD.IdDispatch = D.IdDispatch
      WHERE D.IdDispatchType = 11
      GROUP BY CONVERT(DATE, D.TrackOutboundDate)
      ORDER BY TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'Fill Rate Dispatch',
    kind: 'chart',
    chartType: 'line',
    xField: 'TrackOutboundDate',
    yField: 'Ratio',
    query: `
      SELECT TOP 100 PERCENT V1.TrackOutboundDate,
             SUM(V1.ItemQtyDispatch) AS ItemQtyDispatch,
             SUM(V1.ItemQtyOrder) AS ItemQtyOrder,
             CONVERT(DECIMAL(10,3), SUM(V1.ItemQtyDispatch) * 100.0 / NULLIF(SUM(V1.ItemQtyOrder), 0)) AS Ratio
      FROM (
        SELECT D.IdOutboundOrder, DD.IdItem,
               SUM(DD.ItemQty) AS ItemQtyDispatch,
               (SELECT TOP 1 OD.ItemQty FROM OutboundDetail OD
                 WHERE OD.IdOutboundOrder = D.IdOutboundOrder AND OD.IdItem = DD.IdItem) AS ItemQtyOrder,
               CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate
        FROM DispatchDetail DD
        INNER JOIN Dispatch D ON D.IdDispatch = DD.IdDispatch
        WHERE D.IdDispatchType IN (6, 23)
        GROUP BY D.IdOutboundOrder, DD.IdItem, CONVERT(DATE, D.TrackOutboundDate)
      ) V1
      GROUP BY V1.TrackOutboundDate
      ORDER BY V1.TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'Fill Rate Orders Dispatch',
    kind: 'table',
    columns: ['TrackOutboundDate', 'CountOrdersFullDispatched', 'CountOrdersPartialDispatched'],
    query: `
      SELECT TOP 100 PERCENT T.TrackOutboundDate,
             SUM(CASE WHEN T.ItemQtyDispatch = T.ItemQtyOrder THEN 1 ELSE 0 END) AS CountOrdersFullDispatched,
             SUM(CASE WHEN T.ItemQtyDispatch <> T.ItemQtyOrder THEN 1 ELSE 0 END) AS CountOrdersPartialDispatched
      FROM (
        SELECT D.IdOutboundOrder, CONVERT(DATE, D.TrackOutboundDate) AS TrackOutboundDate,
               SUM(DD.ItemQty) AS ItemQtyDispatch,
               (SELECT SUM(OD.ItemQty) FROM OutboundDetail OD WHERE OD.IdOutboundOrder = D.IdOutboundOrder) AS ItemQtyOrder
        FROM Dispatch D
        INNER JOIN DispatchDetail DD ON DD.IdDispatch = D.IdDispatch
        WHERE D.IdDispatchType IN (6, 23)
        GROUP BY D.IdOutboundOrder, CONVERT(DATE, D.TrackOutboundDate)
      ) T
      GROUP BY T.TrackOutboundDate
      ORDER BY T.TrackOutboundDate`,
  },
  {
    category: 'Outbound',
    name: 'Order Status',
    kind: 'chart',
    chartType: 'pie',
    xField: 'NameTrackOutboundType',
    yField: 'CountReg',
    query: `
      SELECT TOP 100 PERCENT TOT.NameTrackOutboundType, COUNT(DISTINCT OT.IdOutboundOrder) AS CountReg
      FROM OutboundTrack OT
      INNER JOIN TrackOutboundType TOT ON TOT.IdTrackOutboundType = OT.IdTrackOutboundType
      GROUP BY TOT.NameTrackOutboundType
      ORDER BY TOT.NameTrackOutboundType`,
  },
  {
    category: 'Outbound',
    name: 'Order On Time',
    kind: 'table',
    columns: ['TrackOutboundDate', 'CountOrdersOnTime', 'CountOrdersDelayed'],
    query: `
      SELECT TOP 100 PERCENT T.TrackOutboundDate,
             SUM(T.CountOrdersOnTime) AS CountOrdersOnTime,
             SUM(T.CountOrdersDelayed) AS CountOrdersDelayed
      FROM (
        SELECT CONVERT(DATE, U.TrackOutboundDate) AS TrackOutboundDate,
               CASE WHEN DATEDIFF(day, U.TrackOutboundDate, OO.ExpectedDate) >= 0 AND U.ItemQtyDispatch = U.ItemQtyOrder THEN 1 ELSE 0 END AS CountOrdersOnTime,
               CASE WHEN DATEDIFF(day, U.TrackOutboundDate, OO.ExpectedDate) < 0 OR U.ItemQtyDispatch <> U.ItemQtyOrder THEN 1 ELSE 0 END AS CountOrdersDelayed
        FROM (
          SELECT D.IdOutboundOrder, D.TrackOutboundDate,
                 (SELECT COALESCE(SUM(DD2.ItemQty), 0) FROM DispatchDetail DD2
                   INNER JOIN Dispatch D2 ON D2.IdDispatch = DD2.IdDispatch
                   WHERE D2.IdOutboundOrder = D.IdOutboundOrder AND D2.IdDispatchType = 6) AS ItemQtyDispatch,
                 (SELECT COALESCE(SUM(OD.ItemQty), 0) FROM OutboundDetail OD WHERE OD.IdOutboundOrder = D.IdOutboundOrder) AS ItemQtyOrder
          FROM Dispatch D
          WHERE D.IdDispatchType = 27
        ) U
        INNER JOIN OutboundOrder OO ON OO.IdOutboundOrder = U.IdOutboundOrder
        WHERE OO.ExpectedDate IS NOT NULL
      ) T
      GROUP BY T.TrackOutboundDate
      ORDER BY T.TrackOutboundDate`,
  },
];

function widgetConfigFor(kpi) {
  if (kpi.kind === 'kpi') {
    return { widgetType: 'kpi', config: { title: kpi.name, valueField: kpi.valueField, aggregation: kpi.aggregation, suffix: kpi.suffix } };
  }
  if (kpi.kind === 'chart') {
    return { widgetType: 'chart', config: { title: kpi.name, chartType: kpi.chartType, xField: kpi.xField, yField: kpi.yField } };
  }
  if (kpi.kind === 'pivot') {
    return { widgetType: 'pivot', config: { title: kpi.name, rowField: kpi.rowField, valueField: kpi.valueField, aggregation: kpi.aggregation } };
  }
  return { widgetType: 'table', config: { title: kpi.name, columns: kpi.columns } };
}

// Packs widgets into a 12-column grid: kpi tiles (w:3,h:2) pack left-to-right
// in their own row(s); table widgets take the full row (w:12); chart/pivot
// widgets pack two per row (w:6). Matches the {i,x,y,w,h} shape react-grid-layout
// expects from ReportPage.layout (see reportStore.js addWidget/updateLayout).
function computeLayout(items) {
  const layout = [];
  let x = 0, y = 0, inKpiRow = false;
  for (const item of items) {
    if (item.kind === 'kpi') {
      inKpiRow = true;
      const w = 3, h = 2;
      if (x + w > 12) { x = 0; y += h; }
      layout.push({ i: item.id, x, y, w, h });
      x += w;
      continue;
    }
    if (inKpiRow) { y += 2; x = 0; inKpiRow = false; }
    const w = item.kind === 'table' ? 12 : 6;
    const h = 4;
    if (x + w > 12) { x = 0; y += h; }
    layout.push({ i: item.id, x, y, w, h });
    x += w;
    if (x >= 12) { x = 0; y += h; }
  }
  return layout;
}

async function main() {
  const source = await prisma.dataset.findFirst({ where: { name: SOURCE_DATASET_NAME, sourceType: 'db' } });
  if (!source) {
    console.error(`Dataset "${SOURCE_DATASET_NAME}" no encontrado. Abortando.`);
    process.exit(1);
  }
  const resolved = resolveConfig(source.config);
  if (!resolved.connectionString || !resolved.dbType) {
    console.error('El dataset origen no tiene connectionString/dbType resolvible. Abortando.');
    process.exit(1);
  }

  console.log(`Dataset origen: ${source.name} (${source.id}), dbType=${resolved.dbType}, areaId=${source.areaId ?? 'null'}`);

  const datasetIds = {}; // name -> id
  let createdDatasets = 0, skippedDatasets = 0, updatedDatasets = 0;

  for (const kpi of KPIS) {
    if (kpi.sourceName) continue; // kpi-tile: reuses another entry's dataset, created below
    const dsName = `KPI ${kpi.category} - ${kpi.name}`;
    let ds = await prisma.dataset.findFirst({ where: { name: dsName, sourceType: 'db' } });
    const config = {
      dbType: resolved.dbType,
      query: kpi.query.trim(),
      _enc: encrypt({ connectionString: resolved.connectionString }),
    };
    if (ds) {
      if (ds.config.query !== config.query) {
        ds = await prisma.dataset.update({ where: { id: ds.id }, data: { config } });
        updatedDatasets++;
      } else {
        skippedDatasets++;
      }
    } else {
      ds = await prisma.dataset.create({
        data: { areaId: source.areaId, uploadedById: source.uploadedById, name: dsName, sourceType: 'db', config },
      });
      createdDatasets++;
    }
    datasetIds[dsName] = ds.id;
  }
  console.log(`Datasets: ${createdDatasets} creados, ${updatedDatasets} actualizados, ${skippedDatasets} sin cambios.`);

  let report = await prisma.report.findFirst({ where: { title: REPORT_NAME }, include: { pages: true } });
  if (!report) {
    report = await prisma.report.create({
      data: { ownerId: source.uploadedById, areaId: source.areaId, title: REPORT_NAME, pages: { create: [] } },
      include: { pages: true },
    });
  }

  const categories = ['Inbound', 'Inventory', 'Picking', 'Outbound'];
  const pageIds = {};
  for (const [i, cat] of categories.entries()) {
    let page = report.pages.find((p) => p.title === cat);
    if (!page) {
      page = await prisma.reportPage.create({ data: { reportId: report.id, title: cat, order: i } });
    }
    pageIds[cat] = page.id;
  }

  let createdWidgets = 0, skippedWidgets = 0;
  const itemsByPage = {}; // category -> [{id, kind}] in KPIS order, for layout

  for (const kpi of KPIS) {
    const refName = kpi.sourceName ?? kpi.name;
    const dsName = `KPI ${kpi.category} - ${refName}`;
    const pageId = pageIds[kpi.category];

    const candidates = await prisma.reportWidget.findMany({ where: { reportId: report.id, pageId, datasetId: datasetIds[dsName] } });
    let widget = candidates.find((w) => w.config?.title === kpi.name);
    if (widget) {
      skippedWidgets++;
    } else {
      const { widgetType, config } = widgetConfigFor(kpi);
      widget = await prisma.reportWidget.create({
        data: { reportId: report.id, pageId, datasetId: datasetIds[dsName], widgetType, config },
      });
      createdWidgets++;
    }
    (itemsByPage[kpi.category] ||= []).push({ id: widget.id, kind: kpi.kind });
  }
  console.log(`Widgets: ${createdWidgets} creados, ${skippedWidgets} ya existentes.`);

  for (const cat of categories) {
    const layout = computeLayout(itemsByPage[cat] || []);
    await prisma.reportPage.update({ where: { id: pageIds[cat] }, data: { layout } });
  }

  console.log(`Report: "${REPORT_NAME}" (${report.id})`);
  for (const cat of categories) console.log(`  Pagina "${cat}": ${pageIds[cat]}`);

  process.exit(0);
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
