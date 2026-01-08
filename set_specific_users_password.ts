import prisma from "./src/config/prisma";
import bcrypt from "bcrypt";

// --- CONFIGURACIÓN ---
// Usuarios a los que se les cambiará la contraseña
const TARGET_EMAILS = ["marthatoron@gmail.com", "veronicazam2009@hotmail.com"];

// Nueva contraseña para esos usuarios
const NEW_PASSWORD = "Hola12345";

async function main() {
  console.log("🚀 Iniciando cambio de contraseña para usuarios específicos...");
  console.log("👉 Emails:", TARGET_EMAILS.join(", "));

  // 1. Generar el hash de la contraseña una sola vez
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(NEW_PASSWORD, salt);

  // 2. Actualizar solo los usuarios cuyo email esté en TARGET_EMAILS
  console.log("⏳ Actualizando base de datos (tabla User)...");

  const result = await prisma.user.updateMany({
    where: {
      email: {
        in: TARGET_EMAILS,
      },
    },
    data: {
      password: hashedPassword,
    },
  });

  console.log("✅ ¡Listo!");
  console.log(`👥 Se actualizó la contraseña de ${result.count} usuario(s).`);
  console.log(`🔑 Nueva contraseña: "${NEW_PASSWORD}"`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
