/**
 * Script de migración: Sincroniza contadores de clases en transacciones existentes
 * Ejecutar UNA VEZ para migrar datos históricos
 *
 * Uso: npx ts-node src/scripts/migrate_transaction_counters.ts
 */

import prisma from "../config/prisma";
import { migrateAllTransactions } from "../services/userStats.service";

async function main() {
  console.log("🚀 Iniciando migración de contadores de transacciones...\n");

  try {
    const result = await migrateAllTransactions();

    console.log("\n📊 RESULTADO DE LA MIGRACIÓN:");
    console.log(`   Total de transacciones: ${result.total}`);
    console.log(`   Actualizadas: ${result.updated}`);
    console.log(`   Errores: ${result.errors}`);
    console.log(
      `   Tasa de éxito: ${((result.updated / result.total) * 100).toFixed(2)}%`
    );

    if (result.errors === 0) {
      console.log("\n✅ ¡Migración completada exitosamente!");
    } else {
      console.log(
        "\n⚠️  Migración completada con algunos errores. Revisa los logs."
      );
    }
  } catch (error) {
    console.error("\n❌ Error crítico durante la migración:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
