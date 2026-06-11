// Crea (o promueve) un super admin. Uso:
//   npm --workspace=apps/backend run admin:create -- correo@ejemplo.com contraseña "Nombre"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email) {
    console.error('Uso: node scripts/create-super-admin.js <email> [password] [nombre]');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Ya existe: solo promover (no tocar contraseña salvo que se pase una)
    const data = { role: 'superadmin', isActive: true };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { email }, data });
    console.log(`✔ ${email} promovido a superadmin${password ? ' (contraseña actualizada)' : ''}`);
    return;
  }

  if (!password || password.length < 8) {
    console.error('Para crear cuenta nueva la contraseña es obligatoria (mínimo 8 caracteres)');
    process.exit(1);
  }
  await prisma.user.create({
    data: {
      email,
      name: name || email.split('@')[0],
      passwordHash: await bcrypt.hash(password, 10),
      role: 'superadmin',
    },
  });
  console.log(`✔ Super admin ${email} creado`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
