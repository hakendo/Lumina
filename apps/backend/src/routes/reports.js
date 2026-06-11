const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { nanoid } = require('nanoid');
const auth = require('../middleware/auth');
const { exportReportToPDF } = require('../services/pdfExport');

const prisma = new PrismaClient();

const includeWidgets = {
  widgets: { include: { dataset: { select: { id: true, name: true, sourceType: true } } } },
};

// ── Permisos ──────────────────────────────────────────────────────────────────
// Rol efectivo de un usuario sobre un reporte: owner > editor > viewer > null.
// `report` debe incluir `shares` o se consulta el share puntual.
async function getRole(report, userId) {
  if (!report) return null;
  if (report.ownerId === userId) return 'owner';
  const share = await prisma.reportShare.findUnique({
    where: { reportId_userId: { reportId: report.id, userId } },
  });
  if (share) return share.role; // viewer | editor
  return report.isPublic ? 'viewer' : null;
}

const CAN_EDIT = new Set(['owner', 'editor']);

// ── List / create ─────────────────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: { ownerId: req.user.id },
      include: { _count: { select: { widgets: true } } },
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
    data: { ownerId: req.user.id, title, description: description || '', layout: [], filters: [], isPublic: false },
    include: includeWidgets,
  });
  res.json(report);
});

// ── Explore: public reports from all users ────────────────────────────────────

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

// ── Compartidos conmigo ───────────────────────────────────────────────────────

router.get('/shared', auth, async (req, res) => {
  const shares = await prisma.reportShare.findMany({
    where: { userId: req.user.id },
    include: {
      report: {
        include: {
          owner: { select: { name: true } },
          _count: { select: { widgets: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(shares.map((s) => ({ ...s.report, myRole: s.role })));
});

// ── Favorites ─────────────────────────────────────────────────────────────────

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

// ── CRUD ──────────────────────────────────────────────────────────────────────

router.get('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id }, include: includeWidgets });
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

  const { title, description, layout, filters, widgets } = req.body;

  if (widgets) {
    await prisma.reportWidget.deleteMany({ where: { reportId: report.id } });
    if (widgets.length) {
      await prisma.reportWidget.createMany({
        // Keep the client-provided widget id: the report layout references it,
        // so regenerating ids here would orphan every layout entry on reload.
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
      ...(layout !== undefined && { layout }),
      ...(filters !== undefined && { filters }),
    },
    include: includeWidgets,
  });
  res.json(updated);
});

router.delete('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  await prisma.report.delete({ where: { id: report.id } });
  res.json({ ok: true });
});

// ── Duplicate ─────────────────────────────────────────────────────────────────

router.post('/:id/duplicate', auth, async (req, res) => {
  const src = await prisma.report.findUnique({ where: { id: req.params.id }, include: includeWidgets });
  if (!src || !(await getRole(src, req.user.id))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const copy = await prisma.report.create({
    data: {
      ownerId: req.user.id,
      title: `${src.title} (copia)`,
      description: src.description,
      layout: src.layout,
      filters: src.filters,
      isPublic: false,
      widgets: {
        create: src.widgets.map((w) => ({
          datasetId: w.datasetId,
          widgetType: w.widgetType,
          config: w.config,
          position: w.position,
        })),
      },
    },
    include: includeWidgets,
  });
  res.json(copy);
});

// ── Compartir con personas (email + rol) ──────────────────────────────────────

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

// ── Share ─────────────────────────────────────────────────────────────────────

router.post('/:id/share', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const isPublic = !report.isPublic;
  const slug = isPublic ? (report.slug || nanoid(10)) : report.slug;

  const updated = await prisma.report.update({ where: { id: report.id }, data: { isPublic, slug } });
  res.json({ isPublic: updated.isPublic, slug: updated.slug });
});

// ── PDF export ────────────────────────────────────────────────────────────────

router.get('/:id/export/pdf', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const token = req.headers.authorization?.slice(7) || '';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const url = `${frontendUrl}/report/${report.id}/view?token=${token}&print=1`;

  try {
    const pdf = await exportReportToPDF(url);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.title}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
});

// ── Public (no auth) ──────────────────────────────────────────────────────────

router.get('/public/:slug', async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { slug: req.params.slug },
    include: {
      ...includeWidgets,
      owner: { select: { name: true } },
      _count: { select: { favoritedBy: true } },
    },
  });
  if (!report || !report.isPublic) return res.status(404).json({ error: 'Not found' });
  res.json(report);
});

module.exports = router;
