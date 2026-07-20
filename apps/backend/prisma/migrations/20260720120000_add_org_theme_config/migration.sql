-- Tema visual por organización: overrides de color/tipografía sobre los
-- tokens base de la app, aplicados en runtime como CSS custom properties.
-- Claves soportadas: lumen, lumenDeep, lumenGlow, sea, rust, fontDisplay, fontSans.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "themeConfig" JSONB NOT NULL DEFAULT '{}';
