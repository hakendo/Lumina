const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { nanoid } = require('nanoid');
const auth = require('../middleware/auth');
const { exportReportToPDF } = require('../services/pdfExport');

const prisma = new PrismaClient();

const includeWidgets = {
  widgets: { include: { dataset: { select: { id: true, name: true, sourceType: true } } } },
};

router.get('/', auth, async (req, res) => {
  const reports = await prisma.report.findMany({
    where: { ownerId: req.user.id },
    include: { _count: { select: { widgets: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(reports);
});

router.post('/', auth, async (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const report = await prisma.report.create({
    data: { ownerId: req.user.id, title, description: description || '', layout: [], isPublic: false },
    include: includeWidgets,
  });
  res.json(report);
});

router.get('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id }, include: includeWidgets });
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (report.ownerId !== req.user.id && !report.isPublic) return res.status(403).json({ error: 'Forbidden' });
  res.json(report);
});

router.put('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const { title, description, layout, widgets } = req.body;

  if (widgets) {
    await prisma.reportWidget.deleteMany({ where: { reportId: report.id } });
    await prisma.reportWidget.createMany({
      data: widgets.map((w) => ({
        id: w.id || undefined,
        reportId: report.id,
        datasetId: w.datasetId || null,
        widgetType: w.widgetType,
        config: w.config || {},
        position: w.position || {},
      })),
    });
  }

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(layout && { layout }),
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

router.post('/:id/share', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || report.ownerId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const isPublic = !report.isPublic;
  const slug = isPublic ? (report.slug || nanoid(10)) : report.slug;

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: { isPublic, slug },
  });
  res.json({ isPublic: updated.isPublic, slug: updated.slug });
});

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

// Public route — no auth
router.get('/public/:slug', async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { slug: req.params.slug },
    include: includeWidgets,
  });
  if (!report || !report.isPublic) return res.status(404).json({ error: 'Not found' });
  res.json(report);
});

module.exports = router;
