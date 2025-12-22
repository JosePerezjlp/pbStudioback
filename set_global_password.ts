import prisma from "./src/config/prisma";
import bcrypt from "bcrypt";

// --- CONFIGURACIÓN ---
// Escribe aquí la contraseña única que tendrán todos
const GLOBAL_PASSWORD = "BStudio2025";

async function main() {
  console.log(
    `🚀 Iniciando cambio masivo de contraseñas a: "${GLOBAL_PASSWORD}"`
  );

  // 1. Generar el hash de la contraseña una sola vez
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(GLOBAL_PASSWORD, salt);

  // 2. Actualizar TODOS los usuarios en la tabla 'User'
  console.log("⏳ Actualizando base de datos...");

  const result = await prisma.user.updateMany({
    data: {
      password: hashedPassword,
    },
  });

  console.log(`✅ ¡Listo!`);
  console.log(`👥 Se actualizó la contraseña de ${result.count} usuarios.`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
