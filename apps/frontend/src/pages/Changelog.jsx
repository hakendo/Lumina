import { AppHeader } from '../components/ui';

const VERSIONS = [
  {
    version: '0.5.0',
    date: '2026-06-18',
    title: 'Agregación server-side, bulk upsert, connection pooling',
    sections: [
      {
        type: 'added',
        items: [
          'Motor de analítica server-side — cache en memoria con TTL, funciones aggregate/stats/distinct.',
          'Endpoints: GET /datasets/:id/aggregate, /stats, /distinct — KPI computa en servidor sin enviar todos los rows.',
          'Connection pooling para BD externas — PostgreSQL, MySQL, SQL Server reutilizan conexiones (pool de 3, TTL 10 min).',
        ],
      },
      {
        type: 'improved',
        items: [
          'Bulk upsert en performSync — UPDATEs en lotes de 500 dentro de $transaction en vez de 1 query por fila.',
          'KPIWidget con doble fuente — /aggregate server-side cuando disponible, fallback client-side para reportes públicos.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-06-18',
    title: 'Rendimiento — Grandes volúmenes de datos',
    sections: [
      {
        type: 'added',
        items: [
          'Virtualización de TableWidget — renderiza solo filas visibles, soporta cientos de miles de filas sin impactar el DOM.',
          'Paginación server-side en GET /datasets/:id/rows — query params ?page=N&pageSize=N opcionales.',
          'Contador de filas visible en widgets de tabla.',
          'Soporte pnpm como package manager.',
        ],
      },
      {
        type: 'improved',
        items: [
          'Inserción de rows en lotes de 5,000 (batch createMany) — upload, sync y clonación de datasets.',
          'Hash de detección de cambios con streaming — memoria O(1) en vez de O(n).',
        ],
      },
      {
        type: 'docs',
        items: [
          'Stack tecnológico completo con diagramas Mermaid (docs/tech-stack.md).',
          'Documentación del flujo de datos para conectores de BD externa (docs/db-connector-data-flow.md).',
          'Página /changelog para consultar historial de versiones.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-17',
    title: 'Auditoría y perfil de usuario',
    sections: [
      {
        type: 'added',
        items: [
          'Audit log de organizaciones — registro obligatorio con razón para cambios de plan y estado.',
          'Página de perfil con cambio de contraseña.',
          'Enforcement de organización inactiva — bloquea acceso a miembros.',
        ],
      },
      {
        type: 'fixed',
        items: [
          'Query de reportes en admin corregido (User no tiene orgId directo).',
          'Layout de OrgPlanSelector — select wrapeado en shrink-0.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-15',
    title: 'Multi-tenancy y templates',
    sections: [
      {
        type: 'added',
        items: [
          'Multi-tenancy completo: Organizations, Areas, Memberships, Area Policies.',
          'Planes con límites (usuarios, storage, rate limits) y políticas heredables Org → Area.',
          'Reportes multi-página con layout y filtros independientes.',
          'Templates de reportes con slot bindings para clonación.',
          'Notificaciones con tipos y payload JSON.',
          'Papelera (soft-delete) para datasets y reportes.',
          'Roles org-scoped (member / org_admin).',
          'MFA (TOTP) con QR code y verificación obligatoria.',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06-09',
    title: 'Lanzamiento inicial',
    sections: [
      {
        type: 'added',
        items: [
          'Core BI: upload CSV/Excel, conectores API y DB (PostgreSQL, MySQL, SQL Server, Oracle, Redis).',
          'Report Builder con canvas drag-and-drop y 5 tipos de widget.',
          'Autenticación JWT con login y registro.',
          'Compartir reportes: links públicos con slug, shares por usuario.',
          'Export PDF con Puppeteer + pdf-lib.',
          'Sistema de favoritos.',
          'Design system "mesa de luz" con tokens Tailwind v4.',
          'Encriptación at-rest AES-256-GCM para credenciales de conectores.',
          'Protección SSRF y validación de queries (solo SELECT / read-only Redis).',
        ],
      },
    ],
  },
];

const TYPE_CONFIG = {
  added:    { label: 'Agregado',  color: 'bg-sea/15 text-sea',       icon: '+' },
  improved: { label: 'Mejorado',  color: 'bg-lumen-soft text-lumen-deep', icon: '↑' },
  fixed:    { label: 'Corregido', color: 'bg-rust/10 text-rust',     icon: '✓' },
  docs:     { label: 'Docs',      color: 'bg-paper-deep text-ink-soft',   icon: '◆' },
};

export default function Changelog() {
  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-10">
          <h1 className="font-display text-3xl text-ink font-semibold">Changelog</h1>
          <p className="text-ink-soft text-sm mt-1">Historial de versiones y mejoras de Lúmina</p>
        </div>

        <div className="relative">
          <div className="absolute left-[7px] top-4 bottom-4 w-px bg-line" />

          {VERSIONS.map((v, vi) => (
            <div key={v.version} className="relative pl-8 pb-10 last:pb-0">
              <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-line bg-paper flex items-center justify-center">
                {vi === 0 && <div className="w-[7px] h-[7px] rounded-full bg-lumen" />}
              </div>

              <div className="flex items-baseline gap-3 mb-4">
                <span className="font-mono text-lg font-semibold text-ink">v{v.version}</span>
                <span className="font-mono text-xs text-ink-faint">{v.date}</span>
              </div>
              <p className="text-sm font-semibold text-ink-soft mb-4">{v.title}</p>

              {v.sections.map((section) => {
                const cfg = TYPE_CONFIG[section.type] || TYPE_CONFIG.added;
                return (
                  <div key={section.type} className="mb-4 last:mb-0">
                    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-2 ${cfg.color}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <ul className="space-y-1.5">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-sm text-ink-soft leading-relaxed pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-ink-faint">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
