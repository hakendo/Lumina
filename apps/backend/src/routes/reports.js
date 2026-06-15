const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { nanoid } = require('nanoid');
const auth = require('../middleware/auth');
const { exportReportToPDF } = require('../services/pdfExport');

const prisma = new PrismaClient();

const includePages = {
  pages: {
    orderBy: { order: 'asc' },
    include: {
      widgets: {
        include: { dataset: { select: { id: true, name: true, sourceType: true } } },
      },
    },
  },
};

// Mantener compatibilidad: widgets directos en Report (sin página asignada)
const includeLegacyWidgets = {
  widgets: { include: { dataset: { select: { id: true, name: true, sourceType: true } } } },
};

// ── Permisos ──────────────────────────────────────────────────────

async function getRole(report, userId) {
  if (!report) return null;
  if (report.ownerId === userId) return 'owner';
  const share = await prisma.reportShare.findUnique({
    where: { reportId_userId: { reportId: report.id, userId } },
  });
  if (share) return share.role;
  return report.isPublic ? 'viewer' : null;
}

const CAN_EDIT = new Set(['owner', 'editor']);

// Verifica que el usuario tenga acceso al área (miembro o superadmin)
async function userCanAccessArea(userId, areaId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return true;
  const membership = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId, userId } },
  });
  return !!membership;
}

// ── Mis reportes ──────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: { ownerId: req.user.id },
      include: {
        area: { select: { id: true, name: true } },
        _count: { select: { widgets: true, pages: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userFavorite.findMany({
      where: { userId: req.user.id },
      select: { reportId: true },
    }),
  ]);
  const favSet = new Set(favIds.map((f) => f.reportId));
  res.json(reports.map((r) => ({ ...r, isFavorited: favSet.has(r.id) })));
});

router.post('/', auth, async (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const report = await prisma.report.create({
    data: {
      ownerId: req.user.id,
      title,
      description: description || '',
      isPublic: false,
      // Crear página inicial por defecto
      pages: { create: [{ title: 'Página 1', order: 0, layout: [], filters: [] }] },
    },
    include: { ...includePages, area: { select: { id: true, name: true } } },
  });
  res.json(report);
});

// ── Reportes del área (publicados) ───────────────────────────────

router.get('/area/:areaId', auth, async (req, res) => {
  const canAccess = await userCanAccessArea(req.user.id, req.params.areaId);
  if (!canAccess) return res.status(403).json({ error: 'Sin acceso a esta área' });

  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: { areaId: req.params.areaId },
      include: {
        owner: { select: { name: true } },
        area: { select: { id: true, name: true } },
        _count: { select: { widgets: true, pages: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userFavorite.findMany({
      where: { userId: req.user.id },
      select: { reportId: true },
    }),
  ]);
  const favSet = new Set(favIds.map((f) => f.reportId));
  res.json(reports.map((r) => ({ ...r, isFavorited: favSet.has(r.id) })));
});

// ── Explorar reportes públicos ────────────────────────────────────

router.get('/explore', auth, async (req, res) => {
  const { q } = req.query;
  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: {
        isPublic: true,
        ...(q && { title: { contains: q, mode: 'insensitive' } }),
      },
      include: {
        owner: { select: { name: true } },
        _count: { select: { widgets: true, favoritedBy: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    prisma.userFavorite.findMany({
      where: { userId: req.user.id },
      select: { reportId: true },
    }),
  ]);
  const favSet = new Set(favIds.map((f) => f.reportId));
  res.json(reports.map((r) => ({ ...r, isFavorited: favSet.has(r.id) })));
});

// ── Compartidos conmigo ───────────────────────────────────────────

router.get('/shared', auth, async (req, res) => {
  const shares = await prisma.reportShare.findMany({
    where: { userId: req.user.id },
    include: {
      report: {
        include: {
          owner: { select: { name: true } },
          area: { select: { id: true, name: true } },
          _count: { select: { widgets: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(shares.map((s) => ({ ...s.report, myRole: s.role })));
});

// ── Favoritos ─────────────────────────────────────────────────────

router.get('/favorites', auth, async (req, res) => {
  const favs = await prisma.userFavorite.findMany({
    where: { userId: req.user.id },
    include: {
      report: {
        include: {
          owner: { select: { name: true } },
          _count: { select: { widgets: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
  });
  res.json(favs.map((f) => ({ ...f.report, isFavorited: true })));
});

router.post('/:id/favorite', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || (!report.isPublic && report.ownerId !== req.user.id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const existing = await prisma.userFavorite.findUnique({
    where: { userId_reportId: { userId: req.user.id, reportId: report.id } },
  });
  if (existing) {
    await prisma.userFavorite.delete({ where: { id: existing.id } });
    res.json({ isFavorited: false });
  } else {
    await prisma.userFavorite.create({ data: { userId: req.user.id, reportId: report.id } });
    res.json({ isFavorited: true });
  }
});

// ── CRUD ──────────────────────────────────────────────────────────

router.get('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { id: req.params.id },
    include: { ...includePages, ...includeLegacyWidgets, area: { select: { id: true, name: true } } },
  });
  if (!report) return res.status(404).json({ error: 'Not found' });
  const myRole = await getRole(report, req.user.id);
  if (!myRole) return res.status(403).json({ error: 'Forbidden' });
  const isFavorited = !!(await prisma.userFavorite.findUnique({
    where: { userId_reportId: { userId: req.user.id, reportId: report.id } },
  }));
  res.json({ ...report, isFavorited, myRole });
});

router.put('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !CAN_EDIT.has(myRole)) return res.status(404).json({ error: 'Not found' });

  const { title, description, pages, widgets } = req.body;

  // Guardar páginas (nuevo modelo multi-página)
  if (pages !== undefined) {
    const existingPageIds = new Set(
      (await prisma.reportPage.findMany({ where: { reportId: report.id }, select: { id: true } }))
        .map((p) => p.id)
    );

    for (const page of pages) {
      if (page.id && existingPageIds.has(page.id)) {
        // Actualizar página existente + sus widgets
        if (page.widgets !== undefined) {
          await prisma.reportWidget.deleteMany({ where: { pageId: page.id } });
          if (page.widgets.length) {
            await prisma.reportWidget.createMany({
              data: page.widgets.map((w) => ({
                ...(w.id && { id: w.id }),
                reportId: report.id,
                pageId: page.id,
                datasetId: w.datasetId || null,
                widgetType: w.widgetType,
                config: w.config || {},
                position: w.position || {},
              })),
            });
          }
        }
        await prisma.reportPage.update({
          where: { id: page.id },
          data: {
            ...(page.title !== undefined && { title: page.title }),
            ...(page.order !== undefined && { order: page.order }),
            ...(page.layout !== undefined && { layout: page.layout }),
            ...(page.filters !== undefined && { filters: page.filters }),
          },
        });
      } else {
        // Crear nueva página
        const newPage = await prisma.reportPage.create({
          data: {
            reportId: report.id,
            title: page.title || 'Nueva página',
            order: page.order ?? 0,
            layout: page.layout || [],
            filters: page.filters || [],
          },
        });
        if (page.widgets?.length) {
          await prisma.reportWidget.createMany({
            data: page.widgets.map((w) => ({
              ...(w.id && { id: w.id }),
              reportId: report.id,
              pageId: newPage.id,
              datasetId: w.datasetId || null,
              widgetType: w.widgetType,
              config: w.config || {},
              position: w.position || {},
            })),
          });
        }
      }
    }

    // Eliminar páginas que ya no existen
    const incomingIds = new Set(pages.filter((p) => p.id).map((p) => p.id));
    const toDelete = [...existingPageIds].filter((id) => !incomingIds.has(id));
    if (toDelete.length) {
      await prisma.reportPage.deleteMany({ where: { id: { in: toDelete } } });
    }
  }

  // Compatibilidad: widgets directos en Report (sin página)
  if (widgets !== undefined && pages === undefined) {
    await prisma.reportWidget.deleteMany({ where: { reportId: report.id, pageId: null } });
    if (widgets.length) {
      await prisma.reportWidget.createMany({
        data: widgets.map((w) => ({
          ...(w.id && { id: w.id }),
          reportId: report.id,
          datasetId: w.datasetId || null,
          widgetType: w.widgetType,
          config: w.config || {},
          position: w.position || {},
        })),
      });
    }
  }

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: {
      ...(title && { title }),
      ...(description !== undefined && { description }),
    },
    include: { ...includePages, ...includeLegacyWidgets, area: { select: { id: true, name: true } } },
  });
  res.json(updated);
});

router.delete('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  await prisma.report.delete({ where: { id: report.id } });
  res.json({ ok: true });
});

// ── Publicar / despublicar al área ───────────────────────────────

router.post('/:id/publish', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const { areaId } = req.body; // null = despublicar, string = publicar al área

  if (areaId) {
    const canAccess = await userCanAccessArea(req.user.id, areaId);
    if (!canAccess) return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: { areaId: areaId || null },
    include: { area: { select: { id: true, name: true } } },
  });
  res.json({ areaId: updated.areaId, area: updated.area });
});

// ── Páginas ───────────────────────────────────────────────────────

router.post('/:id/pages', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !CAN_EDIT.has(myRole)) return res.status(404).json({ error: 'Not found' });

  const { title = 'Nueva página' } = req.body;
  const maxOrder = await prisma.reportPage.aggregate({
    where: { reportId: report.id },
    _max: { order: true },
  });
  const page = await prisma.reportPage.create({
    data: {
      reportId: report.id,
      title,
      order: (maxOrder._max.order ?? -1) + 1,
      layout: [],
      filters: [],
    },
  });
  res.status(201).json(page);
});

router.delete('/:id/pages/:pageId', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !CAN_EDIT.has(myRole)) return res.status(404).json({ error: 'Not found' });

  const pageCount = await prisma.reportPage.count({ where: { reportId: report.id } });
  if (pageCount <= 1) return res.status(400).json({ error: 'Un reporte debe tener al menos una página' });

  const page = await prisma.reportPage.findFirst({
    where: { id: req.params.pageId, reportId: report.id },
  });
  if (!page) return res.status(404).json({ error: 'Página no encontrada' });

  await prisma.reportPage.delete({ where: { id: page.id } });
  res.json({ ok: true });
});

// ── Duplicar ──────────────────────────────────────────────────────

router.post('/:id/duplicate', auth, async (req, res) => {
  const src = await prisma.report.findUnique({
    where: { id: req.params.id },
    include: includePages,
  });
  if (!src || !(await getRole(src, req.user.id))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const copy = await prisma.report.create({
    data: {
      ownerId: req.user.id,
      title: `${src.title} (copia)`,
      description: src.description,
      isPublic: false,
      pages: {
        create: src.pages.map((page) => ({
          title: page.title,
          order: page.order,
          layout: page.layout,
          filters: page.filters,
          widgets: {
            create: page.widgets.map((w) => ({
              reportId: undefined, // se asignará por la relación
              datasetId: w.datasetId,
              widgetType: w.widgetType,
              config: w.config,
              position: w.position,
            })),
          },
        })),
      },
    },
    include: includePages,
  });
  res.json(copy);
});

// ── Compartir con personas ────────────────────────────────────────

router.get('/:id/shares', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const shares = await prisma.reportShare.findMany({
    where: { reportId: report.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(shares);
});

router.post('/:id/shares', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const { email, role = 'viewer' } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'email requerido' });
  if (!['viewer', 'editor'].includes(role)) return res.status(400).json({ error: 'rol inválido' });

  const target = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!target) return res.status(404).json({ error: 'No existe un usuario con ese email' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'No puedes compartirte un reporte a ti mismo' });

  const share = await prisma.reportShare.upsert({
    where: { reportId_userId: { reportId: report.id, userId: target.id } },
    create: { reportId: report.id, userId: target.id, role },
    update: { role },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(share);
});

router.delete('/:id/shares/:shareId', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const share = await prisma.reportShare.findUnique({ where: { id: req.params.shareId } });
  if (!share || share.reportId !== report.id) return res.status(404).json({ error: 'Share not found' });
  await prisma.reportShare.delete({ where: { id: share.id } });
  res.json({ ok: true });
});

// ── Link público ──────────────────────────────────────────────────

router.post('/:id/share', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const isPublic = !report.isPublic;
  const slug = isPublic ? (report.slug || nanoid(10)) : report.slug;

  const updated = await prisma.report.update({ where: { id: report.id }, data: { isPublic, slug } });
  res.json({ isPublic: updated.isPublic, slug: updated.slug });
});

// ── PDF export ────────────────────────────────────────────────────

router.get('/:id/export/pdf', auth, async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { id: req.params.id },
    include: { pages: { orderBy: { order: 'asc' }, select: { id: true } } },
  });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const token = req.headers.authorization?.slice(7) || '';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const baseUrl = `${frontendUrl}/report/${report.id}/view?token=${token}&print=1`;
  const pageIds = report.pages?.map((p) => p.id) ?? [];

  try {
    const pdf = await exportReportToPDF(baseUrl, pageIds);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.title}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
});

// ── Público (sin auth) ────────────────────────────────────────────

router.get('/public/:slug/datasets/:datasetId/rows', async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, isPublic: true },
  });
  if (!report || !report.isPublic) return res.status(404).json({ error: 'Not found' });

  const widget = await prisma.reportWidget.findFirst({
    where: { reportId: report.id, datasetId: req.params.datasetId },
    select: { id: true },
  });
  if (!widget) return res.status(404).json({ error: 'Not found' });

  const rows = await prisma.datasetRow.findMany({
    where: { datasetId: req.params.datasetId },
    orderBy: { rowIndex: 'asc' },
    select: { rowData: true },
  });
  res.json(rows.map((r) => r.rowData));
});

router.get('/public/:slug', async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { slug: req.params.slug },
    include: {
      ...includePages,
      ...includeLegacyWidgets,
      owner: { select: { name: true } },
      _count: { select: { favoritedBy: true } },
    },
  });
  if (!report || !report.isPublic) return res.status(404).json({ error: 'Not found' });
  res.json(report);
});

module.exports = router;
