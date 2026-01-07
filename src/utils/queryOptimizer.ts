/* ────────────────────────────────────────────────────────────────
   src/utils/queryOptimizer.ts
   Queries optimizados para operaciones comunes
   ──────────────────────────────────────────────────────────────── */
import prisma from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

/**
 * Obtiene paquetes de un usuario con el conteo de clases usadas en una sola query
 */
export async function getUserPackagesOptimized(userId: number) {
  const result = await prisma.$queryRaw<any[]>`
    SELECT 
      t.*,
      COALESCE(COUNT(r.id), 0) as classes_used_count,
      COALESCE(
        CASE 
          WHEN t.package_is_unlimited = 1 THEN 999999
          ELSE t.package_total_classes - COUNT(r.id)
        END,
        t.package_total_classes
      ) as classes_available_count
    FROM transaction t
    LEFT JOIN reservation r ON r.transaction_id = t.id 
      AND r.cancellation_at IS NULL
    WHERE t.user_id = ${userId}
      AND t.is_completed = 1
      AND t.status = 1
      AND t.have_sessions_available = 1
      AND (t.expiration_at > NOW() OR t.expiration_at IS NULL)
    GROUP BY t.id
    ORDER BY 
      CASE WHEN t.expiration_at IS NULL THEN 1 ELSE 0 END,
      t.expiration_at ASC
  `;

  return result.map((t) => ({
    id: t.id,
    userId: t.user_id,
    packageId: t.package_id,
    totalClasses: t.package_total_classes,
    classesUsed: Number(t.classes_used_count),
    classesAvailable: Number(t.classes_available_count),
    isUnlimited: Boolean(t.package_is_unlimited),
    packageType: t.package_type,
    amount: Number(t.package_amount),
    expirationAt: t.expiration_at,
    createdAt: t.created_at,
  }));
}

/**
 * Obtiene reservas de un usuario con info de sesión en una query
 */
export async function getUserReservationsOptimized(
  userId: number,
  options?: {
    includeExpired?: boolean;
    includeCancelled?: boolean;
    fromDate?: Date;
    limit?: number;
  }
) {
  const {
    includeExpired = false,
    includeCancelled = false,
    fromDate,
    limit = 50,
  } = options || {};

  return prisma.reservation.findMany({
    where: {
      userId,
      ...(includeCancelled ? {} : { cancellationAt: null }),
      ...(fromDate
        ? {
            session: {
              dateStart: {
                gte: fromDate,
              },
            },
          }
        : {}),
    },
    include: {
      session: {
        include: {
          discipline: true,
          exerciseRoom: true,
          branchOffice: true,
          instructor: {
            include: {
              profile: true,
            },
          },
        },
      },
      transaction: {
        select: {
          id: true,
          packageType: true,
          packageTotalClasses: true,
          expirationAt: true,
        },
      },
    },
    orderBy: [
      { session: { dateStart: "asc" } },
      { session: { timeStart: "asc" } },
    ],
    take: limit,
  });
}

/**
 * Obtiene sesiones con conteo de reservas en una query
 */
export async function getSessionsWithAvailability(filters: {
  branchOfficeId?: number;
  disciplineId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  includeInactive?: boolean;
}) {
  const {
    branchOfficeId,
    disciplineId,
    dateFrom,
    dateTo,
    includeInactive = false,
  } = filters;

  return prisma.session.findMany({
    where: {
      ...(branchOfficeId ? { branchOfficeId } : {}),
      ...(disciplineId ? { disciplineId } : {}),
      ...(dateFrom ? { dateStart: { gte: dateFrom } } : {}),
      ...(dateTo ? { dateStart: { lte: dateTo } } : {}),
      ...(includeInactive ? {} : { status: 1 }),
    },
    include: {
      discipline: true,
      exerciseRoom: true,
      branchOffice: true,
      instructor: {
        include: {
          profile: true,
        },
      },
      reservations: {
        where: {
          cancellationAt: null,
        },
        select: {
          id: true,
        },
      },
    },
    orderBy: [{ dateStart: "asc" }, { timeStart: "asc" }],
  }).then(sessions => 
    sessions.map(s => ({
      ...s,
      spotsReserved: s.reservations.length,
      spotsAvailable: s.exerciseRoomCapacity - s.reservations.length,
    }))
  );
}

/**
 * Estadísticas de usuario optimizadas
 */
export async function getUserStatsOptimized(userId: number) {
  const [reservationsStats, packagesStats] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(*) as total_reservations,
        SUM(CASE WHEN r.cancellation_at IS NULL THEN 1 ELSE 0 END) as active_reservations,
        SUM(CASE WHEN r.cancellation_at IS NOT NULL THEN 1 ELSE 0 END) as cancelled_reservations,
        SUM(CASE WHEN r.attended = 1 THEN 1 ELSE 0 END) as attended_classes
      FROM reservation r
      WHERE r.user_id = ${userId}
    `,
    prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(*) as total_packages,
        SUM(t.package_amount) as total_spent,
        SUM(CASE WHEN t.status = 1 AND (t.expiration_at > NOW() OR t.expiration_at IS NULL) 
            THEN 1 ELSE 0 END) as active_packages
      FROM transaction t
      WHERE t.user_id = ${userId}
        AND t.is_completed = 1
    `,
  ]);

  return {
    reservations: {
      total: Number(reservationsStats[0]?.total_reservations || 0),
      active: Number(reservationsStats[0]?.active_reservations || 0),
      cancelled: Number(reservationsStats[0]?.cancelled_reservations || 0),
      attended: Number(reservationsStats[0]?.attended_classes || 0),
    },
    packages: {
      total: Number(packagesStats[0]?.total_packages || 0),
      active: Number(packagesStats[0]?.active_packages || 0),
      totalSpent: Number(packagesStats[0]?.total_spent || 0),
    },
  };
}

/**
 * Búsqueda de clases con filtros avanzados (optimizado)
 */
export async function searchSessionsOptimized(params: {
  branchOfficeId?: number;
  disciplineId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  availableOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const {
    branchOfficeId,
    disciplineId,
    dateFrom,
    dateTo,
    availableOnly = false,
    limit = 50,
    offset = 0,
  } = params;

  const sessions = await prisma.session.findMany({
    where: {
      status: 1,
      ...(branchOfficeId ? { branchOfficeId } : {}),
      ...(disciplineId ? { disciplineId } : {}),
      ...(dateFrom ? { dateStart: { gte: dateFrom } } : {}),
      ...(dateTo ? { dateStart: { lte: dateTo } } : {}),
      ...(availableOnly ? { availableCapacity: { gt: 0 } } : {}),
    },
    include: {
      discipline: {
        select: {
          id: true,
          name: true,
        },
      },
      exerciseRoom: {
        select: {
          id: true,
          name: true,
          type: true,
          capacity: true,
        },
      },
      branchOffice: {
        select: {
          id: true,
          name: true,
          location: true,
        },
      },
      instructor: {
        select: {
          id: true,
          email: true,
          profile: {
            select: {
              firstname: true,
              paternalSurname: true,
              photo: true,
            },
          },
        },
      },
      reservations: {
        where: {
          cancellationAt: null,
        },
        select: {
          id: true,
        },
      },
    },
    orderBy: [{ dateStart: "asc" }, { timeStart: "asc" }],
    skip: offset,
    take: limit,
  });

  // Calcular spots disponibles
  return sessions.map((session) => ({
    ...session,
    spotsReserved: session.reservations.length,
    spotsAvailable: session.exerciseRoomCapacity - session.reservations.length,
  }));
}
