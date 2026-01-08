/**
 * Servicio para calcular estadísticas de clases de usuarios
 * Compatible con datos históricos y nuevas transacciones
 */

import prisma from "../config/prisma";
import { DateTime } from "luxon";
import { ClassType } from "../types/enums";
import { normalizePackageType } from "../utils/packageSelection";

interface UserClassStats {
  classesAvailable: number;
  classesTaken: number;
  upcomingClasses: number;
  waitlistCount: number;
  packages: UserPackageStats[];
}

interface UserPackageStats {
  id: number; // ID de la transacción/paquete
  totalClasses: number;
  classesUsed: number;
  classesAvailable: number;
  expirationAt: Date | null;
  isExpired: boolean;
  isUnlimited: boolean;
  type: string; // Valor crudo desde MySQL (ej. "groups", "individual", "g", "i")
  classType: ClassType | null; // Tipo normalizado para filtrar en el front
  isActive: number; // 0=inactivo,1=activo,2=borrado lógico (tabla package.is_active)
}

/**
 * Obtiene las estadísticas de clases de un usuario
 * Calcula basándose en transacciones activas y reservaciones
 */
export async function getUserClassStats(
  userId: number
): Promise<UserClassStats> {
  try {
    const now = DateTime.now().setZone("America/Mexico_City").toJSDate();

    // 1. Clases disponibles: suma de todas las transacciones pagadas aún vigentes
    //    IMPORTANTE: No confiamos en flags de migración como isCompleted / isExpired,
    //    contamos únicamente en base a reservas reales y fecha de expiración.
    const activeTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        status: 1, // Pagado
        OR: [
          { expirationAt: null }, // Sin expiración (paquetes viejos o ilimitados)
          { expirationAt: { gte: now } }, // No expirado por fecha
        ],
      },
      select: {
        id: true,
        packageTotalClasses: true,
        packageIsUnlimited: true,
        reservations: {
          where: {
            cancellationAt: null,
          },
          select: {
            id: true,
          },
        },
      },
    });

    // Calcular clases disponibles
    let classesAvailable = 0;
    let hasUnlimited = false;

    for (const tx of activeTransactions) {
      if (tx.packageIsUnlimited) {
        hasUnlimited = true;
        break; // Si tiene ilimitado, no necesitamos contar más
      }
      const used = tx.reservations.length;
      const available = Math.max(0, tx.packageTotalClasses - used);
      classesAvailable += available;
    }

    // Si tiene paquete ilimitado, mostrar un número alto
    if (hasUnlimited) {
      classesAvailable = 999;
    }

    // 2. Clases tomadas: contar reservaciones no canceladas de sesiones pasadas O con attended=true
    const classesTaken = await prisma.reservation.count({
      where: {
        userId,
        cancellationAt: null, // No canceladas
        OR: [
          { attended: true }, // Marcadas como asistidas
          {
            session: {
              dateStart: { lt: now }, // Sesiones pasadas
            },
          },
        ],
      },
    });

    // 3. Próximas clases: reservaciones futuras activas
    const upcomingClasses = await prisma.reservation.count({
      where: {
        userId,
        cancellationAt: null, // No canceladas
        session: {
          dateStart: { gte: now }, // Fecha futura
          status: 1, // Clase activa
        },
      },
    });

    // 4. Lista de espera
    const waitlistCount = await prisma.waitingList.count({
      where: {
        userId,
        isAvailable: true, // Solo contar los que están esperando disponibilidad
      },
    });

    // 5. Detalle por paquete (todas las transacciones pagadas del usuario, incluyendo expiradas)
    let userTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        status: 1, // Pagado (sin importar si está completado o expirado)
      },
      orderBy: {
        createdAt: "desc", // Últimos paquetes primero
      },
      select: {
        id: true,
        packageTotalClasses: true,
        expirationAt: true,
        isExpired: true,
        packageIsUnlimited: true,
        packageType: true,
        packageId: true,
        reservations: {
          where: {
            cancellationAt: null,
          },
          select: {
            id: true,
          },
        },
      },
    });

    // Get package info separately
    const packageIds = userTransactions
      .map((t) => t.packageId)
      .filter((id): id is number => id !== null);

    let packagesInfo: Array<{ id: number; isActive: number }> = [];
    if (packageIds.length > 0) {
      packagesInfo = await prisma.package.findMany({
        where: {
          id: { in: packageIds },
        },
        select: {
          id: true,
          isActive: true,
        },
      });
    }

    const packageMap = new Map(packagesInfo.map((p) => [p.id, p]));

    // Seleccionar solo los últimos 3 paquetes grupales y 3 individuales
    const packages: UserPackageStats[] = [];
    let groupsCount = 0;
    let individualCount = 0;

    for (const tx of userTransactions) {
      const classType = normalizePackageType(tx.packageType);

      if (classType === ClassType.GROUPS) {
        if (groupsCount >= 3) continue;
        groupsCount++;
      } else if (classType === ClassType.INDIVIDUAL) {
        if (individualCount >= 3) continue;
        individualCount++;
      } else {
        // Paquetes que no son de clases (otro tipo) no se muestran en esta vista
        continue;
      }

      const classesUsed = tx.reservations.length;
      const classesAvailable = Math.max(
        0,
        tx.packageTotalClasses - classesUsed
      );
      const packageInfo = tx.packageId
        ? packageMap.get(tx.packageId)
        : undefined;

      packages.push({
        id: tx.id,
        totalClasses: tx.packageTotalClasses,
        classesUsed,
        classesAvailable,
        expirationAt: tx.expirationAt,
        isExpired:
          tx.isExpired ||
          (tx.expirationAt ? tx.expirationAt.getTime() < now.getTime() : false),
        isUnlimited: tx.packageIsUnlimited,
        type: tx.packageType,
        classType,
        // Si por alguna razón no hay relación de package, asumimos activo (1)
        isActive: packageInfo?.isActive ?? 1,
      });

      // Si ya tenemos 3 y 3, podemos cortar
      if (groupsCount >= 3 && individualCount >= 3) {
        break;
      }
    }

    return {
      classesAvailable,
      classesTaken,
      upcomingClasses,
      waitlistCount,
      packages,
    };
  } catch (error) {
    console.error("Error in getUserClassStats for userId:", userId);
    console.error("Error details:", error);
    throw error; // Re-throw para que el controller lo capture
  }
}

/**
 * Sincroniza los contadores de una transacción basándose en sus reservaciones
 * Útil para migrar datos históricos o corregir inconsistencias
 */
export async function syncTransactionClassCounters(
  transactionId: number
): Promise<void> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      reservations: {
        where: {
          cancellationAt: null, // Solo reservas activas
        },
      },
    },
  });

  if (!transaction) {
    throw new Error("Transacción no encontrada");
  }

  const classesUsed = transaction.reservations.length;
  const classesAvailable = Math.max(
    0,
    transaction.packageTotalClasses - classesUsed
  );

  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      haveSessionsAvailable:
        classesAvailable > 0 || transaction.packageIsUnlimited,
      updatedAt: new Date(),
    },
  });
}

/**
 * Sincroniza TODAS las transacciones de un usuario
 * Útil para migración de datos históricos
 */
export async function syncAllUserTransactions(userId: number): Promise<void> {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      status: 1, // Solo pagadas
      isCompleted: true,
    },
  });

  for (const tx of transactions) {
    await syncTransactionClassCounters(tx.id);
  }
}

/**
 * Script de migración: sincronizar TODAS las transacciones de la BD
 * Ejecutar UNA VEZ para migrar datos históricos
 */
export async function migrateAllTransactions(): Promise<{
  total: number;
  updated: number;
  errors: number;
}> {
  const transactions = await prisma.transaction.findMany({
    where: {
      status: 1,
      isCompleted: true,
    },
  });

  let updated = 0;
  let errors = 0;

  console.log(`🔄 Migrando ${transactions.length} transacciones...`);

  for (const tx of transactions) {
    try {
      await syncTransactionClassCounters(tx.id);
      updated++;

      if (updated % 100 === 0) {
        console.log(`✅ Procesadas ${updated}/${transactions.length}`);
      }
    } catch (error) {
      console.error(`❌ Error en transacción ${tx.id}:`, error);
      errors++;
    }
  }

  console.log(
    `✅ Migración completada: ${updated} actualizadas, ${errors} errores`
  );

  return {
    total: transactions.length,
    updated,
    errors,
  };
}
