import { prisma } from "./src/config/prisma";
import bcrypt from "bcrypt";

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
      
      if (!isValid) {
        console.log('\n💡 La contraseña en la BD no coincide. Regenerando...');
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash('Temporal2025*', salt);
        
        await prisma.user.update({
          where: { email: 'admintemporal@pbstudioapp.com' },
          data: { password: newHash }
        });
        
        console.log('✅ Contraseña actualizada correctamente');
      }
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
