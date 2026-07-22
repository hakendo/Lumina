const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const orgAdmin = require('../middleware/orgAdmin');

const prisma = new PrismaClient();

// Todos los endpoints requieren sesión + rol org_admin (o superadmin)
router.use(auth, orgAdmin);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Devuelve el plan de la org activa del request (null si no tiene plan asignado).
async function getOrgPlan(orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { plan: true },
  });
  return { org, plan: org?.plan ?? null };
}

// Verifica que el usuario objetivo pertenece a la org activa del admin.
async function assertUserInOrg(userId, orgId) {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  return m ?? null;
}

// Calcula bytes JSON de un objeto rowData.
function rowBytes(rowData) {
  return Buffer.byteLength(JSON.stringify(rowData), 'utf8');
}

// ── Usuarios de la org ────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const { orgId } = req.orgUser;
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId },
    include: {
      user: {
        select: {
          id: true, email: true, name: true,
          isActive: true, mfaEnabled: true, mfaEnforced: true, createdAt: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
  res.json(memberships.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt })));
});

// Invitar usuario existente a la org (por email) o crear uno nuevo
router.post('/users/invite', async (req, res) => {
  const { orgId } = req.orgUser;
  const { email, name, password, role = 'member' } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'email requerido' });
  if (!['member', 'org_admin'].includes(role))
    return res.status(400).json({ error: 'role inválido' });

  // Verificar límite de usuarios del plan
  const { org, plan } = await getOrgPlan(orgId);
  if (plan?.maxUsers != null) {
    const count = await prisma.orgMembership.count({ where: { orgId } });
    if (count >= plan.maxUsers)
      return res.status(409).json({ error: `Límite de usuarios del plan alcanzado (${plan.maxUsers})` });
  }

  let user = await prisma.user.findUnique({ where: { email: email.trim() } });

  if (!user) {
    // Crear usuario nuevo
    if (!password) return res.status(400).json({ error: 'password requerido para usuario nuevo' });
    const passwordHash = await bcrypt.hash(password, 12);
    user = await prisma.user.create({
      data: { email: email.trim(), name: name?.trim() || email.trim(), passwordHash, role: 'member' },
    });
  }

  // Verificar que no tenga ya membresía en esta org
  const existing = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
  });
  if (existing) return res.status(409).json({ error: 'Usuario ya pertenece a esta organización' });

  const membership = await prisma.orgMembership.create({
    data: { userId: user.id, orgId, role },
  });
  res.status(201).json({ userId: user.id, email: user.email, name: user.name, orgRole: membership.role });
});

// Actualizar rol, estado activo o MFA enforcement de un usuario en la org
router.patch('/users/:userId', async (req, res) => {
  const { orgId } = req.orgUser;
  const { role, isActive, mfaEnforced } = req.body;

  const membership = await assertUserInOrg(req.params.userId, orgId);
  if (!membership) return res.status(404).json({ error: 'Usuario no pertenece a esta organización' });

  // No puede modificarse a sí mismo (desactivarse o quitarse el rol admin)
  if (req.params.userId === req.orgUser.id && (isActive === false || role === 'member'))
    return res.status(400).json({ error: 'No puedes modificar tu propio acceso' });

  const updates = {};
  if (role !== undefined && ['member', 'org_admin'].includes(role)) {
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: req.params.userId, orgId } },
      data: { role },
    });
    updates.orgRole = role;
  }

  const userUpdates = {};
  if (isActive !== undefined) userUpdates.isActive = Boolean(isActive);
  if (mfaEnforced !== undefined) userUpdates.mfaEnforced = Boolean(mfaEnforced);

  let updatedUser = null;
  if (Object.keys(userUpdates).length > 0) {
    updatedUser = await prisma.user.update({
      where: { id: req.params.userId },
      data: userUpdates,
      select: { id: true, email: true, name: true, isActive: true, mfaEnabled: true, mfaEnforced: true },
    });
  }

  res.json({ ...updatedUser, ...updates });
});

// Remover usuario de la org (sin eliminar su cuenta)
router.delete('/users/:userId', async (req, res) => {
  const { orgId } = req.orgUser;
  if (req.params.userId === req.orgUser.id)
    return res.status(400).json({ error: 'No puedes removerte de la organización' });

  const membership = await assertUserInOrg(req.params.userId, orgId);
  if (!membership) return res.status(404).json({ error: 'Usuario no pertenece a esta organización' });

  await prisma.orgMembership.delete({
    where: { userId_orgId: { userId: req.params.userId, orgId } },
  });
  res.json({ ok: true });
});

// ── Membresía de área ─────────────────────────────────────────────────────────

// Agregar usuario a un área de la org
router.post('/areas/:areaId/members', async (req, res) => {
  const { orgId } = req.orgUser;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  const area = await prisma.area.findUnique({ where: { id: req.params.areaId } });
  if (!area || area.orgId !== orgId)
    return res.status(404).json({ error: 'Área no encontrada en esta organización' });

  const membership = await assertUserInOrg(userId, orgId);
  if (!membership) return res.status(400).json({ error: 'El usuario no pertenece a esta organización' });

  await prisma.areaMember.upsert({
    where: { areaId_userId: { areaId: area.id, userId } },
    create: { areaId: area.id, userId },
    update: {},
  });
  res.status(201).json({ ok: true });
});

router.delete('/areas/:areaId/members/:userId', async (req, res) => {
  const { orgId } = req.orgUser;
  const area = await prisma.area.findUnique({ where: { id: req.params.areaId } });
  if (!area || area.orgId !== orgId)
    return res.status(404).json({ error: 'Área no encontrada en esta organización' });

  await prisma.areaMember.deleteMany({
    where: { areaId: area.id, userId: req.params.userId },
  });
  res.json({ ok: true });
});

// ── Privacidad de reportes ────────────────────────────────────────────────────

// Publicar/despublicar cualquier reporte de la org
router.patch('/reports/:reportId/visibility', async (req, res) => {
  const { orgId } = req.orgUser;
  const { areaId, isPublic } = req.body;

  const report = await prisma.report.findFirst({
    where: { id: req.params.reportId, owner: { memberships: { some: { orgId } } }, deletedAt: null },
  });
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado en esta organización' });

  if (areaId !== undefined && areaId) {
    const area = await prisma.area.findUnique({ where: { id: areaId } });
    if (!area || area.orgId !== orgId)
      return res.status(400).json({ error: 'El área no pertenece a esta organización' });
  }

  if (areaId !== undefined) {
    if (areaId) {
      await prisma.reportAreaPublication.upsert({
        where: { reportId_areaId: { reportId: report.id, areaId } },
        update: {},
        create: { reportId: report.id, areaId },
      });
    } else {
      // areaId === null: despublicar de todas las áreas (equivalente al contrato viejo)
      await prisma.reportAreaPublication.deleteMany({ where: { reportId: report.id } });
    }
  }

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: { ...(isPublic !== undefined && { isPublic: Boolean(isPublic) }) },
    include: { areaPublications: { include: { area: { select: { id: true, name: true } } } } },
  });
  const { areaPublications, ...rest } = updated;
  res.json({ id: rest.id, title: rest.title, isPublic: rest.isPublic, areas: areaPublications.map((p) => p.area) });
});

// ── Clonar reporte ────────────────────────────────────────────────────────────

router.post('/reports/:reportId/clone', async (req, res) => {
  const { orgId } = req.orgUser;
  const original = await prisma.report.findFirst({
    where: { id: req.params.reportId, owner: { memberships: { some: { orgId } } }, deletedAt: null },
    include: { pages: { include: { widgets: true } }, widgets: true },
  });
  if (!original) return res.status(404).json({ error: 'Reporte no encontrado en esta organización' });

  const cloned = await prisma.report.create({
    data: {
      ownerId: req.orgUser.id,
      title: `${original.title} (copia)`,
      description: original.description,
      isPublic: false,
      pages: {
        create: original.pages.map((p) => ({
          title: p.title,
          order: p.order,
          layout: p.layout,
          filters: p.filters,
          widgets: {
            create: p.widgets.map((w) => ({
              reportId: undefined, // se vincula via page
              datasetId: w.datasetId,
              widgetType: w.widgetType,
              config: w.config,
              position: w.position,
            })),
          },
        })),
      },
    },
    select: { id: true, title: true },
  });
  res.status(201).json(cloned);
});

// ── Clonar dataset ────────────────────────────────────────────────────────────

router.post('/datasets/:datasetId/clone', async (req, res) => {
  const { orgId } = req.orgUser;
  const original = await prisma.dataset.findFirst({
    where: { id: req.params.datasetId, area: { orgId }, deletedAt: null },
    include: { rows: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!original) return res.status(404).json({ error: 'Dataset no encontrado en esta organización' });

  // Verificar storage antes de clonar
  const { org, plan } = await getOrgPlan(orgId);
  if (plan?.storageLimitMB != null) {
    const cloneBytes = original.rows.reduce((acc, r) => acc + rowBytes(r.rowData), 0);
    const cloneMB = cloneBytes / (1024 * 1024);
    if (org.storageUsedMB + cloneMB > plan.storageLimitMB)
      return res.status(409).json({ error: 'Sin espacio disponible en el plan actual' });
  }

  const cloned = await prisma.$transaction(async (tx) => {
    const ds = await tx.dataset.create({
      data: {
        areaId: original.areaId,
        uploadedById: req.orgUser.id,
        name: `${original.name} (copia)`,
        sourceType: original.sourceType,
        config: original.config,
      },
    });
    if (original.rows.length > 0) {
      const BATCH = 5000;
      for (let i = 0; i < original.rows.length; i += BATCH) {
        await tx.datasetRow.createMany({
          data: original.rows.slice(i, i + BATCH).map((r) => ({
            datasetId: ds.id,
            rowData: r.rowData,
            rowIndex: r.rowIndex,
          })),
        });
      }
      // Actualizar storage usado
      const addedBytes = original.rows.reduce((acc, r) => acc + rowBytes(r.rowData), 0);
      const addedMB = addedBytes / (1024 * 1024);
      await tx.organization.update({
        where: { id: orgId },
        data: { storageUsedMB: { increment: addedMB } },
      });
    }
    return ds;
  });
  res.status(201).json({ id: cloned.id, name: cloned.name });
});

// ── Papelera ──────────────────────────────────────────────────────────────────

router.get('/trash', async (req, res) => {
  const { orgId } = req.orgUser;
  const [reports, datasets] = await Promise.all([
    prisma.report.findMany({
      where: { owner: { memberships: { some: { orgId } } }, deletedAt: { not: null } },
      select: { id: true, title: true, deletedAt: true, owner: { select: { id: true, name: true } } },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.dataset.findMany({
      where: { area: { orgId }, deletedAt: { not: null } },
      select: { id: true, name: true, deletedAt: true, uploadedBy: { select: { id: true, name: true } } },
      orderBy: { deletedAt: 'desc' },
    }),
  ]);
  res.json({ reports, datasets });
});

router.post('/trash/reports/:id/restore', async (req, res) => {
  const { orgId } = req.orgUser;
  const report = await prisma.report.findFirst({
    where: { id: req.params.id, owner: { memberships: { some: { orgId } } }, deletedAt: { not: null } },
  });
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado en la papelera' });

  await prisma.report.update({ where: { id: report.id }, data: { deletedAt: null } });
  res.json({ ok: true });
});

router.post('/trash/datasets/:id/restore', async (req, res) => {
  const { orgId } = req.orgUser;
  const dataset = await prisma.dataset.findFirst({
    where: { id: req.params.id, area: { orgId }, deletedAt: { not: null } },
  });
  if (!dataset) return res.status(404).json({ error: 'Dataset no encontrado en la papelera' });

  await prisma.dataset.update({ where: { id: dataset.id }, data: { deletedAt: null } });
  res.json({ ok: true });
});

// Purga definitiva (hard delete) de un item en papelera
router.delete('/trash/reports/:id', async (req, res) => {
  const { orgId } = req.orgUser;
  const report = await prisma.report.findFirst({
    where: { id: req.params.id, owner: { memberships: { some: { orgId } } }, deletedAt: { not: null } },
  });
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado en la papelera' });

  await prisma.report.delete({ where: { id: report.id } });
  res.json({ ok: true });
});

router.delete('/trash/datasets/:id', async (req, res) => {
  const { orgId } = req.orgUser;
  const dataset = await prisma.dataset.findFirst({
    where: { id: req.params.id, area: { orgId }, deletedAt: { not: null } },
    include: { rows: { select: { rowData: true } } },
  });
  if (!dataset) return res.status(404).json({ error: 'Dataset no encontrado en la papelera' });

  await prisma.$transaction(async (tx) => {
    const freedBytes = dataset.rows.reduce((acc, r) => acc + rowBytes(r.rowData), 0);
    const freedMB = freedBytes / (1024 * 1024);
    await tx.dataset.delete({ where: { id: dataset.id } });
    if (freedMB > 0) {
      await tx.organization.update({
        where: { id: orgId },
        data: { storageUsedMB: { decrement: freedMB } },
      });
    }
  });
  res.json({ ok: true });
});

// ── Políticas ─────────────────────────────────────────────────────────────────

// Política default de la org
router.get('/policy', async (req, res) => {
  const { orgId } = req.orgUser;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      policyAllowPublicLink: true,
      policyAllowExternalShare: true,
      policyAllowPublishToArea: true,
      policyAllowCreateReport: true,
    },
  });
  res.json(org);
});

router.put('/policy', async (req, res) => {
  const { orgId } = req.orgUser;
  const { allowPublicLink, allowExternalShare, allowPublishToArea, allowCreateReport } = req.body;
  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(allowPublicLink !== undefined && { policyAllowPublicLink: Boolean(allowPublicLink) }),
      ...(allowExternalShare !== undefined && { policyAllowExternalShare: Boolean(allowExternalShare) }),
      ...(allowPublishToArea !== undefined && { policyAllowPublishToArea: Boolean(allowPublishToArea) }),
      ...(allowCreateReport !== undefined && { policyAllowCreateReport: Boolean(allowCreateReport) }),
    },
    select: {
      policyAllowPublicLink: true,
      policyAllowExternalShare: true,
      policyAllowPublishToArea: true,
      policyAllowCreateReport: true,
    },
  });
  res.json(updated);
});

// Política de un área específica (upsert)
router.get('/areas/:areaId/policy', async (req, res) => {
  const { orgId } = req.orgUser;
  const area = await prisma.area.findUnique({
    where: { id: req.params.areaId },
    include: { policy: true },
  });
  if (!area || area.orgId !== orgId)
    return res.status(404).json({ error: 'Área no encontrada' });

  // Si no tiene política propia, devuelve la de la org como base
  if (!area.policy) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        policyAllowPublicLink: true,
        policyAllowExternalShare: true,
        policyAllowPublishToArea: true,
        policyAllowCreateReport: true,
      },
    });
    return res.json({ ...org, inherited: true });
  }
  res.json({ ...area.policy, inherited: false });
});

router.put('/areas/:areaId/policy', async (req, res) => {
  const { orgId } = req.orgUser;
  const area = await prisma.area.findUnique({ where: { id: req.params.areaId } });
  if (!area || area.orgId !== orgId)
    return res.status(404).json({ error: 'Área no encontrada' });

  const { allowPublicLink, allowExternalShare, allowPublishToArea, allowCreateReport } = req.body;
  const policy = await prisma.areaPolicy.upsert({
    where: { areaId: area.id },
    create: {
      areaId: area.id,
      allowPublicLink: allowPublicLink ?? true,
      allowExternalShare: allowExternalShare ?? true,
      allowPublishToArea: allowPublishToArea ?? true,
      allowCreateReport: allowCreateReport ?? true,
    },
    update: {
      ...(allowPublicLink !== undefined && { allowPublicLink: Boolean(allowPublicLink) }),
      ...(allowExternalShare !== undefined && { allowExternalShare: Boolean(allowExternalShare) }),
      ...(allowPublishToArea !== undefined && { allowPublishToArea: Boolean(allowPublishToArea) }),
      ...(allowCreateReport !== undefined && { allowCreateReport: Boolean(allowCreateReport) }),
    },
  });
  res.json({ ...policy, inherited: false });
});

// Eliminar política de un área (vuelve a heredar de la org)
router.delete('/areas/:areaId/policy', async (req, res) => {
  const { orgId } = req.orgUser;
  const area = await prisma.area.findUnique({ where: { id: req.params.areaId } });
  if (!area || area.orgId !== orgId)
    return res.status(404).json({ error: 'Área no encontrada' });

  await prisma.areaPolicy.deleteMany({ where: { areaId: area.id } });
  res.json({ ok: true, inherited: true });
});

// ── Storage de la org ─────────────────────────────────────────────────────────

router.get('/storage', async (req, res) => {
  const { orgId } = req.orgUser;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { storageUsedMB: true, plan: { select: { storageLimitMB: true } } },
  });
  res.json({
    usedMB: org.storageUsedMB,
    limitMB: org.plan?.storageLimitMB ?? null,
    pct: org.plan?.storageLimitMB ? (org.storageUsedMB / org.plan.storageLimitMB) * 100 : null,
  });
});

// ── Tema visual de la org ───────────────────────────────────────────────────
// themeConfig sobreescribe, en runtime, los tokens base de src/index.css
// (ver ThemeProvider en el frontend). Todas las claves son opcionales —
// las ausentes usan el default de la app. Los colores se validan como hex
// de 6 dígitos y las fuentes contra una lista cerrada (ya cargadas en
// index.html) para evitar inyectar CSS arbitrario vía font-family.

const THEME_COLOR_KEYS = ['lumen', 'lumenDeep', 'lumenGlow', 'sea', 'rust'];
const THEME_FONT_DISPLAY_OPTIONS = ['Barlow', 'Fraunces', 'Nunito Sans'];
const THEME_FONT_SANS_OPTIONS = ['Nunito Sans', 'Hanken Grotesk', 'Barlow'];
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

router.get('/theme', async (req, res) => {
  const { orgId } = req.orgUser;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { themeConfig: true } });
  res.json(org?.themeConfig ?? {});
});

router.put('/theme', async (req, res) => {
  const { orgId } = req.orgUser;
  const body = req.body ?? {};
  const patch = {};

  for (const key of THEME_COLOR_KEYS) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === '') { patch[key] = null; continue; }
    if (!HEX_COLOR_RE.test(body[key])) return res.status(400).json({ error: `Color inválido: ${key}` });
    patch[key] = body[key].toLowerCase();
  }
  if (body.fontDisplay !== undefined) {
    if (body.fontDisplay && !THEME_FONT_DISPLAY_OPTIONS.includes(body.fontDisplay))
      return res.status(400).json({ error: 'Fuente de títulos inválida' });
    patch.fontDisplay = body.fontDisplay || null;
  }
  if (body.fontSans !== undefined) {
    if (body.fontSans && !THEME_FONT_SANS_OPTIONS.includes(body.fontSans))
      return res.status(400).json({ error: 'Fuente de texto inválida' });
    patch.fontSans = body.fontSans || null;
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { themeConfig: true } });
  const merged = { ...(org?.themeConfig ?? {}), ...patch };
  Object.keys(merged).forEach((k) => { if (merged[k] == null) delete merged[k]; });

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: { themeConfig: merged },
    select: { themeConfig: true },
  });
  res.json(updated.themeConfig);
});

module.exports = router;
