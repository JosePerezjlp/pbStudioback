const { PrismaClient } = require('./src/generated/prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function checkAdmin() {
  try {
    const admin = await prisma.user.findUnique({
      where: { email: 'admintemporal@pbstudioapp.com' }
    });

    if (!admin) {
      console.log('❌ El admin NO existe en la base de datos');
      console.log('Ejecuta el servidor para que se cree automáticamente');
      return;
    }

    console.log('✅ Admin encontrado:');
    console.log('Email:', admin.email);
    console.log('Name:', admin.name);
    console.log('Enabled:', admin.enabled);
    console.log('Roles:', admin.roles);
    console.log('Password hash:', admin.password?.substring(0, 20) + '...');

    // Verificar contraseña
    if (admin.password) {
      const isValid = await bcrypt.compare('Temporal2025*', admin.password);
      console.log('\n🔐 Verificación de contraseña:', isValid ? '✅ CORRECTA' : '❌ INCORRECTA');
    } else {
      console.log('\n❌ No tiene contraseña configurada');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdmin();
