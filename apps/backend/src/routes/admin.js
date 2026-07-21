const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { CronExpressionParser } = require('cron-parser');
const { hashToken } = require('../middleware/workerAuth');

const prisma = new PrismaClient();

router.use(require('../middleware/auth'));
router.use(require('../middleware/superAdmin'));

const USER_SELECT = {
  id: true, email: true, name: true, role: true, isActive: true,
  mfaEnabled: true, mfaEnforced: true, createdAt: true,
  memberships: { select: { role: true, org: { select: { id: true, name: true } } } },
  _count: { select: { reports: true } },
};

// Shape compatible con lo que espera Admin.jsx: { orgId, orgName, role (org-level) }
function formatUser(u) {
  const primary = u.memberships?.[0] ?? null;
  return {
    ...u,
    orgId: primary?.org.id ?? null,
    orgName: primary?.org.name ?? null,
    // Para el panel admin: org_admin/member viene de la membership; superadmin del User
    role: u.role === 'superadmin' ? 'superadmin' : (primary?.role ?? 'member'),
    memberships: u.memberships,
  };
}

const ROLES = ['member', 'org_admin', 'superadmin'];

// ── Organizaciones ────────────────────────────────────────────────

router.get('/orgs', async (req, res) => {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { memberships: true, areas: true } },
    },
  });
  res.json(orgs);
});

router.post('/orgs', async (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name y slug son obligatorios' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug solo puede contener letras minúsculas, números y guiones' });

  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) return res.status(409).json({ error: 'Ese slug ya está en uso' });

  const org = await prisma.organization.create({ data: { name, slug } });
  res.status(201).json(org);
});

router.patch('/orgs/:id', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { name, isActive } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (isActive !== undefined) data.isActive = Boolean(isActive);

  res.json(await prisma.organization.update({ where: { id: org.id }, data }));
});

router.delete('/orgs/:id', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  await prisma.organization.delete({ where: { id: org.id } });
  res.json({ ok: true });
});

// ── Áreas ─────────────────────────────────────────────────────────

router.get('/orgs/:orgId/areas', async (req, res) => {
  const areas = await prisma.area.findMany({
    where: { orgId: req.params.orgId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  });
  res.json(areas);
});

router.post('/orgs/:orgId/areas', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name es obligatorio' });

  const area = await prisma.area.create({
    data: { orgId: org.id, name },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  });
  res.status(201).json(area);
});

router.patch('/orgs/:orgId/areas/:areaId', async (req, res) => {
  const area = await prisma.area.findFirst({ where: { id: req.params.areaId, orgId: req.params.orgId } });
  if (!area) return res.status(404).json({ error: 'Área no encontrada' });

  const { name } = req.body;
  res.json(await prisma.area.update({
    where: { id: area.id },
    data: { name },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  }));
});

router.delete('/orgs/:orgId/areas/:areaId', async (req, res) => {
  const area = await prisma.area.findFirst({ where: { id: req.params.areaId, orgId: req.params.orgId } });
  if (!area) return res.status(404).json({ error: 'Área no encontrada' });
  await prisma.area.delete({ where: { id: area.id } });
  res.json({ ok: true });
});

// ── Plantillas base (superadmin) ─────────────────────────────────

router.get('/reports/templates', async (req, res) => {
  const templates = await prisma.report.findMany({
    where: { isTemplate: true },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { widgets: true, pages: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(templates);
});

router.post('/reports/templates', async (req, res) => {
  const { title, description = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
  const report = await prisma.report.create({
    data: {
      title: title.trim(), description, isTemplate: true, ownerId: req.user.id,
      pages: { create: [{ title: 'Página 1', order: 0, layout: [], filters: [] }] },
    },
    include: { pages: true, _count: { select: { widgets: true, pages: true } } },
  });
  res.status(201).json(report);
});

// Clonar plantilla a un usuario de la org cliente
router.post('/reports/:reportId/assign', async (req, res) => {
  const { userId, areaId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId es obligatorio' });
  if (!areaId) return res.status(400).json({ error: 'areaId es obligatorio' });

  const src = await prisma.report.findUnique({
    where: { id: req.params.reportId, isTemplate: true },
    include: {
      pages: { orderBy: { order: 'asc' }, include: { widgets: true } },
      widgets: true,
    },
  });
  if (!src) return res.status(404).json({ error: 'Plantilla no encontrada' });

  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

  const area = await prisma.area.findUnique({ where: { id: areaId }, select: { id: true, orgId: true } });
  if (!area) return res.status(400).json({ error: 'Área no encontrada' });

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: area.orgId } },
  });
  if (!membership) return res.status(400).json({ error: 'El usuario no pertenece a la organización del área' });

  // ── Clonar / vincular datasets referenciados por la plantilla ─────────────
  // Collect unique datasetIds across all widgets
  const allWidgets = [
    ...src.pages.flatMap((p) => p.widgets),
    ...src.widgets.filter((w) => !w.pageId),
  ];
  const uniqueDatasetIds = [...new Set(allWidgets.map((w) => w.datasetId).filter(Boolean))];

  const srcDatasets = uniqueDatasetIds.length
    ? await prisma.dataset.findMany({ where: { id: { in: uniqueDatasetIds } } })
    : [];

  // Strategy C: datasets with slotName → create DatasetSlotBinding (no clone, widget.datasetId = null)
  // Legacy datasets (no slotName) → clone with credentials stripped, as before
  const datasetMap = {};   // old id → new dataset id (or null for slots)
  const slotNames = {};    // old dataset id → slotName  (for slot-aware datasets)
  const pendingSlots = []; // { slotName } to create DatasetSlotBinding records after report creation

  for (const ds of srcDatasets) {
    if (ds.slotName) {
      // Slot-based: no clone — client will configure their own data source
      datasetMap[ds.id] = null;
      slotNames[ds.id] = ds.slotName;
      pendingSlots.push({ slotName: ds.slotName });
      continue;
    }

    // Legacy clone: strip credentials, keep structure
    let strippedConfig = {};
    if (ds.sourceType === 'api') {
      const { _enc, hasHeaders, hasBody, ...pub } = ds.config ?? {};
      strippedConfig = { ...pub, hasHeaders: false, hasBody: false };
    } else if (ds.sourceType === 'db') {
      const { _enc, ...pub } = ds.config ?? {};
      strippedConfig = pub;
    } else {
      // csv / excel / derived — no file to transfer; skip
      datasetMap[ds.id] = null;
      continue;
    }
    const cloned = await prisma.dataset.create({
      data: { name: ds.name, sourceType: ds.sourceType, config: strippedConfig, uploadedById: userId, areaId },
    });
    datasetMap[ds.id] = cloned.id;
  }

  // For slot widgets: inject config.datasetSlot so the frontend knows which slot to configure
  const resolveDs = (id) => (id ? (datasetMap[id] ?? null) : null);
  const resolveWidgetConfig = (w) => {
    if (w.datasetId && slotNames[w.datasetId]) {
      return { ...w.config, datasetSlot: slotNames[w.datasetId] };
    }
    return w.config;
  };

  // ── Deep-clone report + pages + widgets ────────────────────────────
  // Step 1: create report + pages without widgets.
  // Prisma cannot auto-resolve `reportId` three levels deep (report→pages→widgets),
  // so widgets must be created separately in step 2.
  const newReport = await prisma.report.create({
    data: {
      title: src.title,
      description: src.description,
      isTemplate: false,
      templateId: src.id,
      ownerId: userId,
      pages: {
        create: src.pages.map((p) => ({
          title: p.title,
          order: p.order,
          layout: p.layout,
          filters: p.filters,
        })),
      },
    },
    include: {
      pages: { orderBy: { order: 'asc' } },
      _count: { select: { widgets: true, pages: true } },
    },
  });

  // Step 2: create widgets with explicit reportId + pageId.
  // Both src.pages and newReport.pages are sorted by `order` asc → positional match is safe.
  for (let i = 0; i < src.pages.length; i++) {
    const srcPage = src.pages[i];
    const newPageId = newReport.pages[i]?.id;
    if (!newPageId || !srcPage.widgets?.length) continue;
    await prisma.reportWidget.createMany({
      data: srcPage.widgets.map((w) => ({
        reportId: newReport.id,
        pageId: newPageId,
        widgetType: w.widgetType,
        config: resolveWidgetConfig(w),
        position: w.position,
        datasetId: resolveDs(w.datasetId),
      })),
    });
  }

  // Legacy root-level widgets (no pageId)
  const rootWidgets = src.widgets.filter((w) => !w.pageId);
  if (rootWidgets.length > 0) {
    await prisma.reportWidget.createMany({
      data: rootWidgets.map((w) => ({
        reportId: newReport.id,
        widgetType: w.widgetType,
        config: resolveWidgetConfig(w),
        position: w.position,
        datasetId: resolveDs(w.datasetId),
      })),
    });
  }

  // Step 3: create pending slot bindings (one per unique slot, clientDatasetId starts null)
  if (pendingSlots.length > 0) {
    await prisma.datasetSlotBinding.createMany({
      data: pendingSlots.map((s) => ({
        reportId: newReport.id,
        slotName: s.slotName,
        clientDatasetId: null,
      })),
      skipDuplicates: true,
    });
  }

  // Ensure target user is a member of the target area
  await prisma.areaMember.upsert({
    where: { areaId_userId: { areaId, userId } },
    update: {},
    create: { areaId, userId },
  });

  // Send notification to assigned user
  await prisma.notification.create({
    data: {
      userId,
      type: 'template_assigned',
      payload: { reportId: newReport.id, reportTitle: newReport.title },
    },
  });

  res.status(201).json({ ...newReport, datasetsCloned: Object.values(datasetMap).filter(Boolean).length });
});

// ── Vista global de reportes (superadmin) ─────────────────────────

router.get('/orgs/:orgId/reports', async (req, res) => {
  const reports = await prisma.report.findMany({
    where: {
      deletedAt: null,
      OR: [
        { area: { orgId: req.params.orgId } },
        {
          areaId: null,
          owner: { memberships: { some: { orgId: req.params.orgId } } },
        },
      ],
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      area: { select: { id: true, name: true } },
      _count: { select: { widgets: true, pages: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(reports);
});

// Modificación directa por superadmin: transferir reporte a otro área
router.patch('/reports/:reportId', async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.reportId } });
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

  const { areaId, ownerId } = req.body;
  const data = {};
  if (areaId !== undefined) {
    if (areaId !== null) {
      const area = await prisma.area.findUnique({ where: { id: areaId } });
      if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    }
    data.areaId = areaId;
  }
  if (ownerId !== undefined) {
    const user = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    data.ownerId = ownerId;
  }
  res.json(await prisma.report.update({ where: { id: report.id }, data }));
});

// ── Usuarios ──────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const { orgId } = req.query;
  const where = orgId ? { memberships: { some: { orgId } } } : {};
  const users = await prisma.user.findMany({ where, select: USER_SELECT, orderBy: { createdAt: 'asc' } });
  res.json(users.map(formatUser));
});

router.post('/users', async (req, res) => {
  const { email, password, name, role = 'member', orgId, mfaEnforced = false } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, contraseña y nombre son obligatorios' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (role !== 'superadmin' && !orgId) return res.status(400).json({ error: 'orgId es obligatorio para usuarios no-superadmin' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Ese email ya está registrado' });

  if (orgId) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // User.role is only 'member' | 'superadmin'; org_admin lives in OrgMembership
  const userRole = role === 'superadmin' ? 'superadmin' : 'member';
  const membershipRole = role === 'org_admin' ? 'org_admin' : 'member';

  const user = await prisma.user.create({
    data: {
      email, name, passwordHash, role: userRole, mfaEnforced: Boolean(mfaEnforced),
      ...(orgId && {
        memberships: { create: { orgId, role: membershipRole } },
      }),
    },
    select: USER_SELECT,
  });
  res.status(201).json(formatUser(user));
});

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, role, isActive, password, mfaEnforced, orgId } = req.body;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (id === req.adminUser.id && (role === 'member' || role === 'org_admin' || isActive === false)) {
    return res.status(400).json({ error: 'No puedes degradar ni desactivar tu propia cuenta' });
  }
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });

  if (target.role === 'superadmin' && (role === 'member' || role === 'org_admin' || isActive === false)) {
    const admins = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super admin activo' });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  if (mfaEnforced !== undefined) data.mfaEnforced = Boolean(mfaEnforced);
  if (role === 'superadmin') data.role = 'superadmin';
  else if (role === 'member' || role === 'org_admin') data.role = 'member';

  if (email !== undefined && email !== target.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) return res.status(409).json({ error: 'Ese email ya está registrado' });
    data.email = email;
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });

  // Sync org membership role if orgId + role provided
  if (orgId && role && role !== 'superadmin') {
    const membershipRole = role === 'org_admin' ? 'org_admin' : 'member';
    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: id, orgId } },
      update: { role: membershipRole },
      create: { userId: id, orgId, role: membershipRole },
    });
  }

  const fresh = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  res.json(formatUser(fresh));
});

router.post('/users/:id/mfa/reset', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { mfaEnabled: false, mfaSecret: null },
    select: USER_SELECT,
  });
  res.json(formatUser(user));
});

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.adminUser.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (target.role === 'superadmin') {
    const admins = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super admin activo' });
  }

  await prisma.$transaction([
    prisma.orgMembership.deleteMany({ where: { userId: id } }),
    prisma.userFavorite.deleteMany({ where: { userId: id } }),
    prisma.reportWidget.updateMany({ where: { dataset: { uploadedById: id } }, data: { datasetId: null } }),
    prisma.report.deleteMany({ where: { ownerId: id } }),
    prisma.dataset.deleteMany({ where: { uploadedById: id } }),
    prisma.user.delete({ where: { id } }),
  ]);
  res.json({ ok: true });
});

// ── Planes ────────────────────────────────────────────────────────────────────

router.get('/plans', async (req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(plans);
});

router.post('/plans', async (req, res) => {
  const { name, retentionDays = 30, maxUsers, storageLimitMB, allowPublicLinks = true, allowExternalShare = true, syncRateLimit = {} } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name es obligatorio' });
  const existing = await prisma.plan.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(409).json({ error: 'Ya existe un plan con ese nombre' });
  const plan = await prisma.plan.create({
    data: {
      name: name.trim(),
      retentionDays: Number(retentionDays),
      maxUsers: maxUsers != null ? Number(maxUsers) : null,
      storageLimitMB: storageLimitMB != null ? Number(storageLimitMB) : null,
      allowPublicLinks: Boolean(allowPublicLinks),
      allowExternalShare: Boolean(allowExternalShare),
      syncRateLimit,
    },
  });
  res.status(201).json(plan);
});

router.patch('/plans/:id', async (req, res) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

  const { name, retentionDays, maxUsers, storageLimitMB, allowPublicLinks, allowExternalShare, syncRateLimit } = req.body;
  const data = {};
  if (name !== undefined) {
    const conflict = await prisma.plan.findFirst({ where: { name: name.trim(), id: { not: plan.id } } });
    if (conflict) return res.status(409).json({ error: 'Ya existe un plan con ese nombre' });
    data.name = name.trim();
  }
  if (retentionDays !== undefined) data.retentionDays = Number(retentionDays);
  if (maxUsers !== undefined) data.maxUsers = maxUsers != null ? Number(maxUsers) : null;
  if (storageLimitMB !== undefined) data.storageLimitMB = storageLimitMB != null ? Number(storageLimitMB) : null;
  if (allowPublicLinks !== undefined) data.allowPublicLinks = Boolean(allowPublicLinks);
  if (allowExternalShare !== undefined) data.allowExternalShare = Boolean(allowExternalShare);
  if (syncRateLimit !== undefined) data.syncRateLimit = syncRateLimit;

  res.json(await prisma.plan.update({ where: { id: plan.id }, data }));
});

router.delete('/plans/:id', async (req, res) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orgs: true } } } });
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  if (plan._count.orgs > 0) return res.status(409).json({ error: `Este plan está asignado a ${plan._count.orgs} organización(es)` });
  await prisma.plan.delete({ where: { id: plan.id } });
  res.json({ ok: true });
});

// Asignar plan a una organización
router.patch('/orgs/:orgId/plan', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.orgId }, include: { plan: true } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { planId, reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });

  let newPlanName = null;
  if (planId) {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    newPlanName = plan.name;
  }

  const [updated] = await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { planId: planId ?? null },
      include: { plan: true },
    }),
    prisma.orgAuditLog.create({
      data: {
        orgId: org.id,
        adminId: req.user.id,
        action: 'plan_changed',
        oldValue: org.plan?.name ?? null,
        newValue: newPlanName,
        reason: reason.trim(),
      },
    }),
  ]);

  res.json({ id: updated.id, planId: updated.planId, plan: updated.plan });
});

// Activar o desactivar organización
router.patch('/orgs/:id/status', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });

  const newStatus = !org.isActive;
  const [updated] = await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { isActive: newStatus },
    }),
    prisma.orgAuditLog.create({
      data: {
        orgId: org.id,
        adminId: req.user.id,
        action: 'status_changed',
        oldValue: org.isActive ? 'activa' : 'inactiva',
        newValue: newStatus ? 'activa' : 'inactiva',
        reason: reason.trim(),
      },
    }),
  ]);
  res.json({ id: updated.id, isActive: updated.isActive });
});

// Historial de auditoría de una organización
router.get('/orgs/:id/audit', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const logs = await prisma.orgAuditLog.findMany({
    where: { orgId: org.id },
    include: { admin: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(logs);
});

// ── Limpieza de DB interna ────────────────────────────────────────

// GET /admin/storage/stats — filas almacenadas por sourceType
router.get('/storage/stats', async (req, res) => {
  const datasetIds = (await prisma.dataset.findMany({ select: { id: true } })).map(d => d.id);
  const [dbRows, apiRows, fileRows, orphanRows, total] = await Promise.all([
    prisma.datasetRow.count({ where: { dataset: { sourceType: 'db' } } }),
    prisma.datasetRow.count({ where: { dataset: { sourceType: 'api' } } }),
    prisma.datasetRow.count({ where: { dataset: { sourceType: 'file' } } }),
    prisma.datasetRow.count({ where: { datasetId: { notIn: datasetIds } } }),
    prisma.datasetRow.count(),
  ]);
  res.json({ total, byType: { db: dbRows, api: apiRows, file: fileRows, orphan: orphanRows } });
});

// DELETE /admin/storage/cleanup — borra filas de datasets tipo 'db' y huérfanas
router.delete('/storage/cleanup', async (req, res) => {
  const { types = ['db', 'orphan'] } = req.body;

  const results = {};

  if (types.includes('db')) {
    const dbDatasetIds = (await prisma.dataset.findMany({ where: { sourceType: 'db' }, select: { id: true } })).map(d => d.id);
    if (dbDatasetIds.length) {
      const { count } = await prisma.datasetRow.deleteMany({ where: { datasetId: { in: dbDatasetIds } } });
      results.db = count;
    } else {
      results.db = 0;
    }
  }

  if (types.includes('orphan')) {
    const validIds = (await prisma.dataset.findMany({ select: { id: true } })).map(d => d.id);
    const { count } = await prisma.datasetRow.deleteMany({ where: { datasetId: { notIn: validIds } } });
    results.orphan = count;
  }

  res.json({ deleted: results });
});

// ── Reportes compartidos (vista global superadmin) ────────────────────
router.get('/reports/shares', async (req, res) => {
  const { orgId } = req.query;
  let userIdFilter;
  if (orgId) {
    const members = await prisma.orgMembership.findMany({ where: { orgId }, select: { userId: true } });
    userIdFilter = { in: members.map((m) => m.userId) };
  }
  const shares = await prisma.reportShare.findMany({
    where: userIdFilter ? { userId: userIdFilter } : undefined,
    include: {
      report: { select: { id: true, title: true, isTemplate: true } },
      user: { select: { id: true, name: true, email: true } },
      sourceDataset: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(shares);
});

// Lista los datasets DB-connector distintos referenciados por los widgets de
// un reporte, con su conexión actual (propia u heredada de qué dataset).
router.get('/reports/:reportId/datasets', async (req, res) => {
  const widgets = await prisma.reportWidget.findMany({
    where: { reportId: req.params.reportId },
    include: { dataset: true },
  });
  const distinct = [...new Map(
    widgets.filter((w) => w.dataset?.sourceType === 'db').map((w) => [w.dataset.id, w.dataset])
  ).values()];
  res.json(distinct.map((d) => ({ id: d.id, name: d.name, connectionRef: d.config.connectionRef || null })));
});

// Setea connectionRef en los datasets DB-connector indicados (o todos los del
// reporte si no se especifica), apuntando a un mismo dataset base — para no
// editar uno por uno cuando un reporte usa muchos datasets con la misma DB.
router.post('/reports/:reportId/datasets/bulk-connection', async (req, res) => {
  const { baseDatasetId, datasetIds } = req.body;
  if (!baseDatasetId) return res.status(400).json({ error: 'baseDatasetId requerido' });

  const base = await prisma.dataset.findUnique({ where: { id: baseDatasetId } });
  if (!base || base.sourceType !== 'db' || !base.config._enc) {
    return res.status(400).json({ error: 'baseDatasetId inválido: debe ser un DB connector con conexión propia' });
  }

  const widgets = await prisma.reportWidget.findMany({
    where: { reportId: req.params.reportId },
    include: { dataset: true },
  });
  const allowed = datasetIds ? new Set(datasetIds) : null;
  const targets = [...new Map(
    widgets
      .filter((w) => w.dataset?.sourceType === 'db' && w.dataset.id !== baseDatasetId)
      .filter((w) => !allowed || allowed.has(w.dataset.id))
      .map((w) => [w.dataset.id, w.dataset])
  ).values()];

  for (const ds of targets) {
    await prisma.dataset.update({
      where: { id: ds.id },
      data: { config: { dbType: base.config.dbType, query: ds.config.query, connectionRef: baseDatasetId } },
    });
  }
  res.json({ updated: targets.length });
});

router.put('/reports/shares/:shareId', async (req, res) => {
  const { role, sourceDatasetId } = req.body;
  const existing = await prisma.reportShare.findUnique({ where: { id: req.params.shareId } });
  if (!existing) return res.status(404).json({ error: 'Share no encontrado' });

  if (sourceDatasetId) {
    const src = await prisma.dataset.findUnique({ where: { id: sourceDatasetId } });
    if (!src || src.sourceType !== 'db' || !src.config._enc) {
      return res.status(400).json({ error: 'sourceDatasetId inválido: debe ser un DB connector con conexión propia' });
    }
  }

  const updated = await prisma.reportShare.update({
    where: { id: req.params.shareId },
    data: {
      ...(role && { role }),
      ...(sourceDatasetId !== undefined && { sourceDatasetId: sourceDatasetId || null }),
    },
    include: {
      report: { select: { id: true, title: true } },
      user: { select: { id: true, name: true, email: true } },
      sourceDataset: { select: { id: true, name: true } },
    },
  });
  res.json(updated);
});

router.delete('/reports/shares/:shareId', async (req, res) => {
  const existing = await prisma.reportShare.findUnique({ where: { id: req.params.shareId } });
  if (!existing) return res.status(404).json({ error: 'Share no encontrado' });
  await prisma.reportShare.delete({ where: { id: req.params.shareId } });
  res.json({ ok: true });
});

// ── Trabajos programados (cron + worker externo) ───────────────────────────

function validCron(expr) {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

router.get('/jobs', async (req, res) => {
  const jobs = await prisma.scheduledJob.findMany({
    include: { dataset: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(jobs);
});

router.post('/jobs', async (req, res) => {
  const { name, datasetId, cronExpression, config } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });
  if (!datasetId) return res.status(400).json({ error: 'datasetId requerido' });
  if (!validCron(cronExpression)) return res.status(400).json({ error: 'Expresión cron inválida' });

  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset) return res.status(404).json({ error: 'Dataset no encontrado' });

  const job = await prisma.scheduledJob.create({
    data: { name: name.trim(), datasetId, cronExpression, config: config || {}, createdById: req.user.id },
    include: { dataset: { select: { id: true, name: true } } },
  });
  res.status(201).json(job);
});

router.patch('/jobs/:id', async (req, res) => {
  const existing = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Job no encontrado' });

  const { name, datasetId, cronExpression, config, isActive } = req.body;
  if (cronExpression !== undefined && !validCron(cronExpression)) {
    return res.status(400).json({ error: 'Expresión cron inválida' });
  }
  if (datasetId !== undefined) {
    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    if (!dataset) return res.status(404).json({ error: 'Dataset no encontrado' });
  }

  const job = await prisma.scheduledJob.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(datasetId !== undefined && { datasetId }),
      ...(cronExpression !== undefined && { cronExpression }),
      ...(config !== undefined && { config }),
      ...(isActive !== undefined && { isActive }),
    },
    include: { dataset: { select: { id: true, name: true } } },
  });
  res.json(job);
});

router.delete('/jobs/:id', async (req, res) => {
  const existing = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Job no encontrado' });
  await prisma.scheduledJob.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.get('/jobs/:id/runs', async (req, res) => {
  const runs = await prisma.jobRun.findMany({
    where: { jobId: req.params.id },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json(runs);
});

router.get('/worker-tokens', async (req, res) => {
  const tokens = await prisma.workerToken.findMany({
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(tokens);
});

router.post('/worker-tokens', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });

  const token = crypto.randomBytes(32).toString('hex');
  const record = await prisma.workerToken.create({
    data: { name: name.trim(), tokenHash: hashToken(token), createdById: req.user.id },
  });
  // El valor en claro se devuelve una única vez aquí — no se puede recuperar después.
  res.status(201).json({ id: record.id, name: record.name, createdAt: record.createdAt, token });
});

router.delete('/worker-tokens/:id', async (req, res) => {
  const existing = await prisma.workerToken.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Token no encontrado' });
  await prisma.workerToken.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
});

module.exports = router;
