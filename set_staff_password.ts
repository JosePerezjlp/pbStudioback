import prisma from "./src/config/prisma";
import bcrypt from "bcrypt";

// --- CONFIGURACIÓN ---
// Escribe aquí la contraseña única que tendrán todos los del STAFF
const STAFF_PASSWORD = "PBStudio2025";

async function main() {
  console.log(
    `🚀 Iniciando cambio masivo de contraseñas de STAFF a: "${STAFF_PASSWORD}"`
  );

  // 1. Generar el hash de la contraseña una sola vez
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(STAFF_PASSWORD, salt);

  // 2. Actualizar TODOS los usuarios en la tabla 'Staff'
  console.log("⏳ Actualizando base de datos (tabla Staff)...");

  const result = await prisma.staff.updateMany({
    data: {
      password: hashedPassword,
    },
  });

  console.log(`✅ ¡Listo!`);
  console.log(
    `👥 Se actualizó la contraseña de ${result.count} miembros del staff.`
  );
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
