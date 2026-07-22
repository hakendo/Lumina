const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { nanoid } = require('nanoid');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const { exportReportToPDF } = require('../services/pdfExport');
const { resolveConfig, queryDB } = require('../services/dataParser');

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

// SEC-005: returns area IDs the user can read from, or null for superadmin (no filter)
async function getUserAreaIds(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return null;
  const memberships = await prisma.areaMember.findMany({ where: { userId }, select: { areaId: true } });
  return memberships.map((m) => m.areaId);
}

// ── Permisos ──────────────────────────────────────────────────────

async function getRole(report, userId) {
  if (!report) return null;
  if (report.ownerId === userId) return 'owner';
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return 'owner';
  const share = await prisma.reportShare.findUnique({
    where: { reportId_userId: { reportId: report.id, userId } },
  });
  if (share) return share.role;
  return report.isPublic ? 'viewer' : null;
}

const CAN_EDIT = new Set(['owner', 'editor']);

async function isSuperadmin(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return u?.role === 'superadmin';
}

async function isOwnerOrSuperadmin(report, userId) {
  return report.ownerId === userId || await isSuperadmin(userId);
}

const AREA_PUBLICATIONS_INCLUDE = { areaPublications: { include: { area: { select: { id: true, name: true } } } } };

// Reemplaza el include crudo de areaPublications por un array plano `areas`
// (varias áreas por reporte — ver ReportAreaPublication en schema.prisma).
function withAreas(r) {
  const { areaPublications, ...rest } = r;
  return { ...rest, areas: (areaPublications || []).map((p) => p.area) };
}

// Verifica que el usuario tenga acceso al área (miembro o superadmin)
async function userCanAccessArea(userId, areaId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return true;
  const membership = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId, userId } },
  });
  return !!membership;
}

// Retorna la política efectiva para un área objetivo (con fallback a org).
async function getEffectivePolicy(areaId, orgId) {
  const defaults = { allowPublicLink: true, allowExternalShare: true, allowPublishToArea: true };
  let resolvedOrgId = orgId;

  if (areaId) {
    const area = await prisma.area.findUnique({
      where: { id: areaId },
      include: { policy: true },
    });
    if (area?.policy) {
      return {
        allowPublicLink: area.policy.allowPublicLink,
        allowExternalShare: area.policy.allowExternalShare,
        allowPublishToArea: area.policy.allowPublishToArea,
      };
    }
    resolvedOrgId = area?.orgId ?? orgId;
  }

  if (!resolvedOrgId) return defaults;
  const org = await prisma.organization.findUnique({
    where: { id: resolvedOrgId },
    select: { policyAllowPublicLink: true, policyAllowExternalShare: true, policyAllowPublishToArea: true },
  });
  return {
    allowPublicLink: org?.policyAllowPublicLink ?? true,
    allowExternalShare: org?.policyAllowExternalShare ?? true,
    allowPublishToArea: org?.policyAllowPublishToArea ?? true,
  };
}

// ── Mis reportes ──────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: await isSuperadmin(req.user.id)
        ? { isTemplate: false, deletedAt: null }
        : { ownerId: req.user.id, isTemplate: false, deletedAt: null },
      include: {
        ...AREA_PUBLICATIONS_INCLUDE,
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
  res.json(reports.map((r) => ({ ...withAreas(r), isFavorited: favSet.has(r.id) })));
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
    include: { ...includePages, ...AREA_PUBLICATIONS_INCLUDE },
  });
  res.json(withAreas(report));
});

// ── Reportes del área (publicados) ───────────────────────────────

router.get('/area/:areaId', auth, async (req, res) => {
  const canAccess = await userCanAccessArea(req.user.id, req.params.areaId);
  if (!canAccess) return res.status(403).json({ error: 'Sin acceso a esta área' });

  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: { areaPublications: { some: { areaId: req.params.areaId } }, deletedAt: null },
      include: {
        owner: { select: { name: true } },
        ...AREA_PUBLICATIONS_INCLUDE,
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
  res.json(reports.map((r) => ({ ...withAreas(r), isFavorited: favSet.has(r.id) })));
});

// ── Explorar reportes públicos ────────────────────────────────────

router.get('/explore', auth, async (req, res) => {
  const { q } = req.query;

  // Collect area IDs where user is a member
  const memberships = await prisma.areaMember.findMany({
    where: { userId: req.user.id },
    select: { areaId: true },
  });
  const myAreaIds = memberships.map((m) => m.areaId);

  const titleFilter = q ? { title: { contains: q, mode: 'insensitive' } } : {};

  const [reports, favIds] = await Promise.all([
    prisma.report.findMany({
      where: {
        deletedAt: null,
        OR: [
          { isPublic: true, ...titleFilter },
          ...(myAreaIds.length ? [{ areaPublications: { some: { areaId: { in: myAreaIds } } }, ...titleFilter }] : []),
        ],
      },
      include: {
        owner: { select: { name: true } },
        ...AREA_PUBLICATIONS_INCLUDE,
        _count: { select: { widgets: true, favoritedBy: true, pages: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    }),
    prisma.userFavorite.findMany({
      where: { userId: req.user.id },
      select: { reportId: true },
    }),
  ]);

  // Deduplicate (report can be both public and in user's area)
  const favSet = new Set(favIds.map((f) => f.reportId));
  const seen = new Set();
  const unique = reports.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  res.json(unique.map((r) => ({ ...withAreas(r), isFavorited: favSet.has(r.id) })));
});

// ── Compartidos conmigo ───────────────────────────────────────────

router.get('/shared', auth, async (req, res) => {
  const shares = await prisma.reportShare.findMany({
    where: { userId: req.user.id },
    include: {
      report: {
        include: {
          owner: { select: { name: true } },
          ...AREA_PUBLICATIONS_INCLUDE,
          _count: { select: { widgets: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(shares.map((s) => ({ ...withAreas(s.report), myRole: s.role })));
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
  if (!report || (!report.isPublic && !(await isOwnerOrSuperadmin(report, req.user.id)))) {
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
    include: { ...includePages, ...includeLegacyWidgets, ...AREA_PUBLICATIONS_INCLUDE },
  });
  if (!report) return res.status(404).json({ error: 'Not found' });
  const myRole = await getRole(report, req.user.id);
  if (!myRole) return res.status(403).json({ error: 'Forbidden' });
  const isFavorited = !!(await prisma.userFavorite.findUnique({
    where: { userId_reportId: { userId: req.user.id, reportId: report.id } },
  }));
  res.json({ ...withAreas(report), isFavorited, myRole });
});

// Lightweight metadata update (title, description, isTemplate for superadmin)
router.patch('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !CAN_EDIT.has(myRole)) return res.status(404).json({ error: 'Not found' });
  const { title, description, isTemplate } = req.body;
  const data = {
    ...(title !== undefined && { title: title.trim() || report.title }),
    ...(description !== undefined && { description }),
  };
  if (isTemplate !== undefined && req.user.role === 'superadmin') {
    data.isTemplate = Boolean(isTemplate);
  }
  const updated = await prisma.report.update({ where: { id: report.id }, data });
  res.json({ title: updated.title, description: updated.description, isTemplate: updated.isTemplate });
});

router.put('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !CAN_EDIT.has(myRole)) return res.status(404).json({ error: 'Not found' });

  const { title, description, pages, widgets } = req.body;

  // SEC-005: verify all datasetIds in submitted widgets are accessible to this user
  const allDatasetIds = new Set();
  for (const page of pages ?? []) {
    for (const w of page.widgets ?? []) { if (w.datasetId) allDatasetIds.add(w.datasetId); }
  }
  for (const w of (widgets ?? [])) { if (w.datasetId) allDatasetIds.add(w.datasetId); }
  if (allDatasetIds.size > 0) {
    const userAreaIds = await getUserAreaIds(req.user.id);
    if (userAreaIds !== null) {
      const ds = await prisma.dataset.findMany({
        where: { id: { in: [...allDatasetIds] } },
        select: { id: true, areaId: true },
      });
      for (const d of ds) {
        if (d.areaId && !userAreaIds.includes(d.areaId)) {
          return res.status(403).json({ error: 'Sin acceso a uno o más datasets' });
        }
      }
    }
  }

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
    include: { ...includePages, ...includeLegacyWidgets, ...AREA_PUBLICATIONS_INCLUDE },
  });
  res.json(withAreas(updated));
});

router.delete('/:id', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });
  // Soft-delete: va a papelera, el Org Admin puede recuperarlo
  await prisma.report.update({ where: { id: report.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
});

// ── Publicar / despublicar al área ───────────────────────────────

router.post('/:id/publish', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });

  const { areaId } = req.body;
  if (!areaId) return res.status(400).json({ error: 'areaId requerido' });

  const policy = await getEffectivePolicy(areaId, req.user.orgId);
  if (!policy.allowPublishToArea) return res.status(403).json({ error: 'Publicar al área deshabilitado por la política de la organización' });

  const canAccess = await userCanAccessArea(req.user.id, areaId);
  if (!canAccess) return res.status(403).json({ error: 'Sin acceso a esa área' });

  const publication = await prisma.reportAreaPublication.upsert({
    where: { reportId_areaId: { reportId: report.id, areaId } },
    update: {},
    create: { reportId: report.id, areaId },
    include: { area: { select: { id: true, name: true } } },
  });

  // Notify all area members (except the publisher) when a report is published
  const members = await prisma.areaMember.findMany({
    where: { areaId, userId: { not: req.user.id } },
    select: { userId: true },
  });
  if (members.length > 0) {
    const publisher = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await prisma.notification.createMany({
      data: members.map((m) => ({
        userId: m.userId,
        type: 'area_published',
        payload: {
          reportId: report.id,
          reportTitle: report.title,
          areaName: publication.area.name,
          publishedBy: publisher?.name ?? 'Alguien',
        },
      })),
    });
  }

  const areas = await prisma.reportAreaPublication.findMany({
    where: { reportId: report.id },
    include: { area: { select: { id: true, name: true } } },
  });
  res.json({ areas: areas.map((p) => p.area) });
});

router.post('/:id/unpublish', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });

  const { areaId } = req.body;
  if (!areaId) return res.status(400).json({ error: 'areaId requerido' });

  await prisma.reportAreaPublication.deleteMany({ where: { reportId: report.id, areaId } });

  const areas = await prisma.reportAreaPublication.findMany({
    where: { reportId: report.id },
    include: { area: { select: { id: true, name: true } } },
  });
  res.json({ areas: areas.map((p) => p.area) });
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

router.patch('/:id/pages/:pageId', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !CAN_EDIT.has(myRole)) return res.status(404).json({ error: 'Not found' });

  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });

  const page = await prisma.reportPage.findFirst({
    where: { id: req.params.pageId, reportId: report.id },
  });
  if (!page) return res.status(404).json({ error: 'Página no encontrada' });

  const updated = await prisma.reportPage.update({
    where: { id: page.id },
    data: { title: title.trim() },
  });
  res.json(updated);
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
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });
  const shares = await prisma.reportShare.findMany({
    where: { reportId: report.id },
    include: { user: { select: { id: true, name: true, email: true } }, sourceDataset: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(shares);
});

router.post('/:id/shares', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });

  // Un reporte puede estar publicado a varias áreas (o ninguna) — ya no hay
  // "el" área del reporte, así que esta policy se evalúa a nivel org.
  const policy = await getEffectivePolicy(null, req.user.orgId);
  if (!policy.allowExternalShare) return res.status(403).json({ error: 'Compartir externo deshabilitado por la política de la organización' });

  const { email, role = 'viewer', sourceDatasetId } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'email requerido' });
  if (!['viewer', 'editor'].includes(role)) return res.status(400).json({ error: 'rol inválido' });

  const target = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!target) return res.status(404).json({ error: 'No existe un usuario con ese email' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'No puedes compartirte un reporte a ti mismo' });

  if (sourceDatasetId) {
    const src = await prisma.dataset.findUnique({ where: { id: sourceDatasetId } });
    if (!src || src.sourceType !== 'db' || !src.config._enc) {
      return res.status(400).json({ error: 'sourceDatasetId inválido: debe ser un DB connector con conexión propia' });
    }
  }

  const isNew = !(await prisma.reportShare.findUnique({
    where: { reportId_userId: { reportId: report.id, userId: target.id } },
  }));

  const share = await prisma.reportShare.upsert({
    where: { reportId_userId: { reportId: report.id, userId: target.id } },
    create: { reportId: report.id, userId: target.id, role, sourceDatasetId: sourceDatasetId || null },
    update: { role, ...(sourceDatasetId !== undefined && { sourceDatasetId: sourceDatasetId || null }) },
    include: { user: { select: { id: true, name: true, email: true } }, sourceDataset: { select: { id: true, name: true } } },
  });

  // Notify the invited user (only on new share, not role updates)
  if (isNew) {
    const sharer = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await prisma.notification.create({
      data: {
        userId: target.id,
        type: 'share_added',
        payload: { reportId: report.id, reportTitle: report.title, sharedBy: sharer?.name ?? 'Alguien' },
      },
    });
  }

  res.json(share);
});

router.delete('/:id/shares/:shareId', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });
  const share = await prisma.reportShare.findUnique({ where: { id: req.params.shareId } });
  if (!share || share.reportId !== report.id) return res.status(404).json({ error: 'Share not found' });
  await prisma.reportShare.delete({ where: { id: share.id } });
  res.json({ ok: true });
});

// ── Overrides de conexión por dataset, por cliente ─────────────────
// Más fino que ReportShare.sourceDatasetId (que pisa TODO el reporte):
// permite elegir, dataset por dataset, con qué conexión resolver ese
// dataset para este cliente puntual. Ver GET /:reportId/widgets/:widgetId/rows.

router.get('/:id/shares/:shareId/dataset-sources', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });
  const share = await prisma.reportShare.findUnique({ where: { id: req.params.shareId } });
  if (!share || share.reportId !== report.id) return res.status(404).json({ error: 'Share not found' });

  const widgets = await prisma.reportWidget.findMany({
    where: { reportId: report.id },
    include: { dataset: true },
  });
  const distinct = [...new Map(
    widgets.filter((w) => w.dataset?.sourceType === 'db').map((w) => [w.dataset.id, w.dataset])
  ).values()];

  const overrides = await prisma.reportShareDatasetSource.findMany({ where: { shareId: share.id } });
  const overrideMap = new Map(overrides.map((o) => [o.datasetId, o.sourceDatasetId]));

  res.json(distinct.map((d) => ({ id: d.id, name: d.name, sourceDatasetId: overrideMap.get(d.id) || null })));
});

router.put('/:id/shares/:shareId/dataset-sources/:datasetId', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });
  const share = await prisma.reportShare.findUnique({ where: { id: req.params.shareId } });
  if (!share || share.reportId !== report.id) return res.status(404).json({ error: 'Share not found' });

  const { sourceDatasetId } = req.body;
  if (!sourceDatasetId) {
    await prisma.reportShareDatasetSource.deleteMany({
      where: { shareId: share.id, datasetId: req.params.datasetId },
    });
    return res.json({ ok: true, sourceDatasetId: null });
  }

  const src = await prisma.dataset.findUnique({ where: { id: sourceDatasetId } });
  if (!src || src.sourceType !== 'db' || !src.config._enc) {
    return res.status(400).json({ error: 'sourceDatasetId inválido: debe ser un DB connector con conexión propia' });
  }

  await prisma.reportShareDatasetSource.upsert({
    where: { shareId_datasetId: { shareId: share.id, datasetId: req.params.datasetId } },
    create: { shareId: share.id, datasetId: req.params.datasetId, sourceDatasetId },
    update: { sourceDatasetId },
  });
  res.json({ ok: true, sourceDatasetId });
});

// ── Link público ──────────────────────────────────────────────────

router.post('/:id/share', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });

  const isPublic = !report.isPublic;
  if (isPublic) {
    // Igual que arriba: sin "el" área única del reporte, se evalúa a nivel org.
    const policy = await getEffectivePolicy(null, req.user.orgId);
    if (!policy.allowPublicLink) return res.status(403).json({ error: 'Links públicos deshabilitados por la política de la organización' });
  }
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
  if (!report || !(await isOwnerOrSuperadmin(report, req.user.id))) return res.status(404).json({ error: 'Not found' });

  // SEC-001: short-lived (2 min), purpose-scoped token — never expose the session JWT in a URL
  const printToken = jwt.sign(
    { id: req.user.id, purpose: 'pdf' },
    process.env.JWT_SECRET,
    { expiresIn: '2m' }
  );
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const baseUrl = `${frontendUrl}/report/${report.id}/view?token=${printToken}&print=1`;
  const pageIds = report.pages?.map((p) => p.id) ?? [];

  try {
    const pdf = await exportReportToPDF(baseUrl, pageIds);
    res.setHeader('Content-Type', 'application/pdf');
    // SEC-011: sanitize title to prevent header injection
    const safeTitle = report.title.replace(/[\x00-\x1f\x7f"\\]/g, '_');
    const encodedTitle = encodeURIComponent(report.title);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeTitle}.pdf"; filename*=UTF-8''${encodedTitle}.pdf`
    );
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
});

// ── Público (sin auth) ────────────────────────────────────────────

router.get('/public/:slug/datasets/:datasetId/rows', async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, isPublic: true, ownerId: true },
  });
  if (!report || !report.isPublic) return res.status(404).json({ error: 'Not found' });

  const widget = await prisma.reportWidget.findFirst({
    where: { reportId: report.id, datasetId: req.params.datasetId },
    select: { id: true },
  });
  if (!widget) return res.status(404).json({ error: 'Not found' });

  // SEC-006: verify dataset belongs to same org as the report (prevents cross-tenant leak)
  const [dataset, reportFull] = await Promise.all([
    prisma.dataset.findUnique({
      where: { id: req.params.datasetId },
      select: { area: { select: { orgId: true } } },
    }),
    prisma.report.findUnique({
      where: { id: report.id },
      select: { area: { select: { orgId: true } } },
    }),
  ]);
  if (!dataset || dataset.area?.orgId !== reportFull?.area?.orgId) {
    return res.status(404).json({ error: 'Not found' });
  }

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

// ── Resolución de datos por-cliente (ReportShare.sourceDatasetId) ─────
// Un mismo widget/dataset puede resolver a distinta conexión según qué
// usuario lo mira: si su ReportShare tiene sourceDatasetId, se usa la
// connectionString de ESE dataset (debe ser un DB connector con conexión
// propia) en vez de la del dataset original, manteniendo la misma query.

function wrapQueryWithLimit(query, dbType, limit) {
  const sub = query.trim().replace(/;\s*$/, '');
  if (dbType === 'mssql') return `SELECT TOP ${limit} * FROM (${sub}) AS __preview_sub`;
  if (dbType === 'oracle') return `SELECT * FROM (${sub}) __preview_sub WHERE ROWNUM <= ${limit}`;
  return `SELECT * FROM (${sub}) AS __preview_sub LIMIT ${limit}`;
}

router.get('/:reportId/widgets/:widgetId/rows', auth, async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.reportId } });
  const myRole = await getRole(report, req.user.id);
  if (!report || !myRole) return res.status(404).json({ error: 'Not found' });

  const widget = await prisma.reportWidget.findUnique({
    where: { id: req.params.widgetId },
    include: { dataset: true },
  });
  if (!widget || widget.reportId !== report.id || !widget.dataset) {
    return res.status(404).json({ error: 'Widget o dataset no encontrado' });
  }
  const dataset = widget.dataset;
  if (dataset.sourceType !== 'db') {
    return res.status(400).json({ error: 'Este endpoint solo aplica a datasets db-connector' });
  }

  let effectiveConfig = dataset.config;
  const share = await prisma.reportShare.findUnique({
    where: { reportId_userId: { reportId: report.id, userId: req.user.id } },
    select: { id: true, sourceDatasetId: true },
  });
  let overrideDatasetId = share?.sourceDatasetId || null;
  if (share) {
    const dsOverride = await prisma.reportShareDatasetSource.findUnique({
      where: { shareId_datasetId: { shareId: share.id, datasetId: dataset.id } },
    });
    if (dsOverride) overrideDatasetId = dsOverride.sourceDatasetId; // gana sobre el override de todo el reporte
  }
  if (overrideDatasetId) {
    const override = await prisma.dataset.findUnique({ where: { id: overrideDatasetId } });
    if (override?.sourceType === 'db') {
      effectiveConfig = { ...override.config, query: dataset.config.query };
    }
  }

  try {
    const resolved = await resolveConfig(effectiveConfig);
    const wrapped = wrapQueryWithLimit(resolved.query, resolved.dbType, 50000);
    const rows = await queryDB({ ...resolved, query: wrapped });
    res.json(rows);
  } catch (err) {
    res.status(502).json({ error: err.message, errorType: err.errorType });
  }
});

module.exports = router;
