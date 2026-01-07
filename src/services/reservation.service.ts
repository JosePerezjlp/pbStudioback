/* ────────────────────────────────────────────────────────────────
   src/services/reservation.service.ts
   Servicio centralizado para toda la lógica de reservas
   ──────────────────────────────────────────────────────────────── */
import { DateTime } from "luxon";
import prisma from "../config/prisma";
import { ERROR_CODES, ClassType } from "../types/enums";
import {
  normalizeClassType,
  selectPackageForClass,
  UserPackage,
} from "../utils/packageSelection";
import { formatDateVisibleMx } from "../utils/time";
import {
  sendReservationCancelledEmail,
  sendReservationConfirmationEmail,
  sendWaitlistAcceptedEmail,
} from "../utils/emailService";

/* ==================== TIPOS ==================== */
export interface CreateReservationParams {
  userId: number;
  sessionId: number;
  seat?: number | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface CancelReservationParams {
  reservationId: number;
  userId: number;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ReservationResult {
  success: boolean;
  reservationId?: number;
  message?: string;
  error?: string;
  errorCode?: string;
}

export interface AvailabilityCheck {
  available: boolean;
  capacity: number;
  reserved: number;
  availableSeats: number[];
  message?: string;
}

/* ==================== CONFIGURACIÓN ==================== */
const CANCELLATION_WINDOW = {
  INDIVIDUAL: 24 * 60, // 24 horas en minutos
  GROUPS: 12 * 60, // 12 horas en minutos
};

const TIMEZONE = "America/Mexico_City";

/* ==================== HELPERS PRIVADOS ==================== */
function diffMinutesFromNow(dateStr: string, timeStr: string): number {
  const now = DateTime.now().setZone(TIMEZONE);
  const classDateTime = DateTime.fromISO(`${dateStr}T${timeStr}`, {
    zone: TIMEZONE,
  });
  return classDateTime.diff(now, "minutes").minutes;
}

function canCancelReservation(
  sessionDateStart: Date,
  sessionTimeStart: Date,
  sessionType: string
): boolean {
  const classType = normalizeClassType(sessionType) ?? ClassType.INDIVIDUAL;
  const windowMinutes =
    classType === ClassType.GROUPS
      ? CANCELLATION_WINDOW.GROUPS
      : CANCELLATION_WINDOW.INDIVIDUAL;

  const dateStr = sessionDateStart.toISOString().slice(0, 10);
  const timeStr = sessionTimeStart.toISOString().slice(11, 19);
  const minutesUntilClass = diffMinutesFromNow(dateStr, timeStr);

  return minutesUntilClass > windowMinutes;
}

async function getUserActivePackages(
  userId: number,
  tx: any
): Promise<UserPackage[]> {
  // Query optimizado: una sola consulta con join
  const packagesWithUsage = await tx.$queryRaw<any[]>`
    SELECT 
      t.*,
      COALESCE(COUNT(r.id), 0) as classes_used_count
    FROM transaction t
    LEFT JOIN reservation r ON r.transaction_id = t.id 
      AND r.cancellation_at IS NULL
    WHERE t.user_id = ${userId}
      AND t.is_completed = 1
      AND t.status = 1
      AND t.have_sessions_available = 1
      AND (t.expiration_at > NOW() OR t.expiration_at IS NULL)
    GROUP BY t.id
    -- MySQL no soporta "NULLS LAST"; emulamos ordenando primero los no nulos
    ORDER BY (t.expiration_at IS NULL), t.expiration_at ASC
  `;

  return packagesWithUsage.map((t: any) => ({
    id: String(t.id),
    active: true,
    totalClasses: t.package_total_classes,
    classesUsed: Number(t.classes_used_count),
    isUnlimited: Boolean(t.package_is_unlimited),
    type: t.package_type,
    assignedAt: t.created_at ? new Date(t.created_at).toISOString() : undefined,
    expiresAt: t.expiration_at ? new Date(t.expiration_at).toISOString() : null,
  }));
}

async function updateTransactionCounters(
  transactionId: number,
  tx: any
): Promise<void> {
  const count = await tx.reservation.count({
    where: {
      transactionId,
      cancellationAt: null,
    },
  });

  // Los campos classesUsed y classesAvailable se calculan dinámicamente
  // contando las reservaciones activas, no se almacenan en la BD
  // Por lo tanto, no necesitamos actualizar nada aquí
}

/* ==================== SERVICIO PÚBLICO ==================== */
export class ReservationService {
  /**
   * Verifica disponibilidad de una clase sin hacer reserva
   */
  async checkAvailability(sessionId: number): Promise<AvailabilityCheck> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { exerciseRoom: true },
    });

    if (!session) {
      return {
        available: false,
        capacity: 0,
        reserved: 0,
        availableSeats: [],
        message: "Clase no encontrada",
      };
    }

    const reservations = await prisma.reservation.findMany({
      where: {
        sessionId,
        cancellationAt: null,
      },
      select: { placeNumber: true },
    });

    const reserved = reservations.length;
    const capacity = session.exerciseRoomCapacity;
    const takenSeats = new Set(reservations.map((r) => r.placeNumber));
    const availableSeats: number[] = [];

    for (let i = 1; i <= capacity; i++) {
      if (!takenSeats.has(i)) {
        availableSeats.push(i);
      }
    }

    return {
      available: reserved < capacity,
      capacity,
      reserved,
      availableSeats,
      message: reserved >= capacity ? "Clase llena" : undefined,
    };
  }

  /**
   * Crea una nueva reserva con validaciones completas y manejo de concurrencia
   */
  async createReservation(
    params: CreateReservationParams
  ): Promise<ReservationResult> {
    const { userId, sessionId, seat, ipAddress, userAgent } = params;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Obtener usuario y sesión con lock FOR UPDATE (simulado con re-fetch)
        const user = await tx.user.findUnique({ where: { id: userId } });
        const session = await tx.session.findUnique({
          where: { id: sessionId },
          include: { discipline: true, exerciseRoom: true, branchOffice: true },
        });

        if (!user) throw new Error(ERROR_CODES.USER_NOT_FOUND);
        if (!session) throw new Error(ERROR_CODES.CLASS_NOT_FOUND);

        // 2. Validar fecha/hora
        const now = DateTime.now().setZone(TIMEZONE);
        const dateStr = session.dateStart.toISOString().slice(0, 10);
        const timeStr = session.timeStart.toISOString().slice(11, 19);
        const classDateTime = DateTime.fromISO(`${dateStr}T${timeStr}`, {
          zone: TIMEZONE,
        });

        if (classDateTime <= now) {
          throw new Error("No se puede reservar una clase que ya pasó");
        }

        // 3. Verificar cupos DENTRO de la transacción (para evitar race conditions)
        const currentReserved = await tx.reservation.count({
          where: { sessionId, cancellationAt: null },
        });

        if (currentReserved >= session.exerciseRoomCapacity) {
          throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);
        }

        // 4. Tipo de clase y asiento
        const classType =
          normalizeClassType(session.type) ?? ClassType.INDIVIDUAL;
        let assignedSeat: number;

        if (classType === ClassType.GROUPS) {
          if (seat !== undefined && seat !== null) {
            // Verificar que el asiento exista
            if (seat < 1 || seat > session.exerciseRoomCapacity) {
              throw new Error(
                "El asiento seleccionado no existe en esta clase"
              );
            }

            // Verificar que el asiento esté disponible
            const seatTaken = await tx.reservation.findFirst({
              where: {
                sessionId,
                placeNumber: seat,
                cancellationAt: null,
              },
            });

            if (seatTaken) {
              throw new Error(ERROR_CODES.SEAT_ALREADY_TAKEN);
            }

            assignedSeat = seat;
          } else {
            // Asignar asiento automáticamente
            const occupiedSeats = await tx.reservation.findMany({
              where: { sessionId, cancellationAt: null },
              select: { placeNumber: true },
            });

            const takenSet = new Set(occupiedSeats.map((r) => r.placeNumber));
            let found: number | null = null;

            for (let i = 1; i <= session.exerciseRoomCapacity; i++) {
              if (!takenSet.has(i)) {
                found = i;
                break;
              }
            }

            if (found === null) {
              throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);
            }

            assignedSeat = found;
          }
        } else {
          // Individual: asiento fijo = 1
          assignedSeat = 1;
        }

        // 5. Obtener paquetes activos del usuario (optimizado)
        const packages = await getUserActivePackages(userId, tx);

        if (packages.length === 0) {
          throw new Error(ERROR_CODES.NO_PACKAGES);
        }

        // 6. Seleccionar paquete apropiado
        const selectedPackage = selectPackageForClass(packages, classType);

        if (!selectedPackage) {
          throw new Error(ERROR_CODES.NO_COMPATIBLE_PACKAGE);
        }

        const packageToUse = selectedPackage.pkg;
        const transactionId = Number(packageToUse.id);

        // 7. Reglas especiales para paquetes ilimitados
        if (packageToUse.isUnlimited) {
          // 7.a Límite de 2 reservas activas por día
          const sessionDate = session.dateStart;
          const startOfDay = new Date(sessionDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(sessionDate);
          endOfDay.setHours(23, 59, 59, 999);

          const dailyReservations = await tx.reservation.count({
            where: {
              userId,
              cancellationAt: null,
              isAvailable: true,
              session: {
                dateStart: { gte: startOfDay, lte: endOfDay },
              },
            },
          });

          if (dailyReservations >= 2) {
            throw new Error(ERROR_CODES.UNLIMITED_DAILY_LIMIT);
          }

          // 7.b No permitir dos reservas del mismo usuario en la misma clase
          const existingReservation = await tx.reservation.findFirst({
            where: {
              userId,
              sessionId,
              cancellationAt: null,
            },
          });

          if (existingReservation) {
            throw new Error(ERROR_CODES.DUPLICATE_RESERVATION);
          }
        }

        // 8. Crear la reserva
        const now_date = new Date();
        const reservation = await tx.reservation.create({
          data: {
            userId,
            sessionId,
            transactionId,
            placeNumber: assignedSeat,
            isAvailable: true,
            createdAt: now_date,
            updatedAt: now_date,
          },
        });

        // 9. Actualizar counters denormalizados
        await updateTransactionCounters(transactionId, tx);

        // 10. Actualizar capacidad disponible de la sesión
        await tx.session.update({
          where: { id: sessionId },
          data: {
            availableCapacity: {
              decrement: 1,
            },
          },
        });

        // 11. Log del evento
        await tx.reservationEvent.create({
          data: {
            reservationId: reservation.id,
            userId,
            sessionId,
            eventType: "created",
            metadata: {
              seat: assignedSeat,
              packageId: transactionId,
              classType,
            },
            ipAddress,
            userAgent,
          },
        });

        return reservation;
      });

      // 12. Enviar email de confirmación (fuera de la transacción, no bloqueante)
      try {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          include: {
            discipline: true,
            exerciseRoom: true,
            branchOffice: true,
            instructor: true,
          },
        });
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (session && user && user.email) {
          const dateStr = session.dateStart.toISOString().slice(0, 10);
          const classInfo = `${session.discipline?.name || "Clase"} - ${formatDateVisibleMx(dateStr)} ${session.timeStart}`;
          const typeClass = session.type;
          const seatNumber = result.placeNumber;

          // Fire-and-forget: no bloquea la respuesta
          sendReservationConfirmationEmail(
            user.email,
            user.name || "Usuario",
            classInfo,
            typeClass,
            seatNumber
          ).catch((emailError) => {
            console.error("Error enviando email de confirmación:", emailError);
          });
        }
      } catch (emailError) {
        console.error("Error preparando email de confirmación:", emailError);
      }

      return {
        success: true,
        reservationId: result.id,
        message: "Reserva creada exitosamente",
      };
    } catch (error: any) {
      const message = error.message || "Error desconocido";
      return {
        success: false,
        error: message,
        errorCode: this.getErrorCode(message),
      };
    }
  }

  /**
   * Cancela una reserva existente
   */
  async cancelReservation(
    params: CancelReservationParams
  ): Promise<ReservationResult> {
    const { reservationId, userId, reason, ipAddress, userAgent } = params;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Obtener la reserva
        const reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
          include: {
            session: {
              include: { discipline: true, branchOffice: true },
            },
            user: true,
            transaction: true,
          },
        });

        if (!reservation) {
          throw new Error("Reserva no encontrada");
        }

        if (reservation.userId !== userId) {
          throw new Error("No tienes permiso para cancelar esta reserva");
        }

        if (reservation.cancellationAt !== null) {
          throw new Error("Esta reserva ya fue cancelada");
        }

        // 2. Verificar ventana de cancelación
        if (
          !canCancelReservation(
            reservation.session!.dateStart,
            reservation.session!.timeStart,
            reservation.session!.type
          )
        ) {
          const classType =
            normalizeClassType(reservation.session!.type) ??
            ClassType.INDIVIDUAL;
          const hours = classType === ClassType.GROUPS ? 12 : 24;
          throw new Error(
            `No se puede cancelar. Las clases ${classType === ClassType.GROUPS ? "grupales" : "individuales"} deben cancelarse con al menos ${hours} horas de anticipación`
          );
        }

        // 3. Marcar como cancelada
        const now = new Date();
        const updated = await tx.reservation.update({
          where: { id: reservationId },
          data: {
            cancellationAt: now,
            updatedAt: now,
          },
        });

        // 4. Actualizar counters del paquete
        if (reservation.transactionId) {
          await updateTransactionCounters(reservation.transactionId, tx);
        }

        // 5. Actualizar capacidad de la sesión
        await tx.session.update({
          where: { id: reservation.sessionId! },
          data: {
            availableCapacity: {
              increment: 1,
            },
          },
        });

        return updated;
      });

      // 6. Procesar waitlist (si hay gente esperando) en una transacción separada
      try {
        await prisma.$transaction((tx) =>
          this.processWaitlistForSession(result.sessionId!, tx)
        );
      } catch (e) {
        console.error("Error procesando waitlist tras cancelación:", e);
      }

      // 7. Log del evento (fuera de la transacción principal para evitar timeouts)
      try {
        await prisma.reservationEvent.create({
          data: {
            reservationId,
            userId,
            sessionId: result.sessionId!,
            eventType: "cancelled",
            metadata: {
              reason,
              previousSeat: (result as any).placeNumber,
            },
            ipAddress,
            userAgent,
          },
        });
      } catch (e) {
        console.error("Error registrando evento de cancelación:", e);
      }

      // 8. Enviar email de cancelación (fuera de transacción, no bloqueante)
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const session = await prisma.session.findUnique({
          where: { id: result.sessionId! },
          include: { discipline: true },
        });

        if (user?.email && session) {
          const dateStr = session.dateStart.toISOString().slice(0, 10);
          const classInfo = `${session.discipline?.name || "Clase"} - ${formatDateVisibleMx(dateStr)} ${session.timeStart}`;
          const classType = session.type;

          // Fire-and-forget: no bloquea la respuesta
          sendReservationCancelledEmail(
            user.email,
            user.name || "Usuario",
            classInfo,
            classType
          ).catch((emailError) => {
            console.error("Error enviando email de cancelación:", emailError);
          });
        }
      } catch (emailError) {
        console.error("Error preparando email de cancelación:", emailError);
      }

      return {
        success: true,
        message: "Reserva cancelada exitosamente",
      };
    } catch (error: any) {
      const message = error.message || "Error desconocido";
      return {
        success: false,
        error: message,
        errorCode: this.getErrorCode(message),
      };
    }
  }

  /**
   * Procesa la lista de espera cuando se libera un cupo
   */
  private async processWaitlistForSession(
    sessionId: number,
    tx: any
  ): Promise<void> {
    try {
      // Buscar el primer usuario en lista de espera pendiente (FIFO)
      // En el schema actual, "pendiente" se representa con isAvailable = true
      const waitlistEntry = await tx.waitingList.findFirst({
        where: {
          sessionId,
          isAvailable: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        include: {
          user: true,
        },
      });

      if (!waitlistEntry) return;

      // Verificar que todavía hay cupo
      const availability = await this.checkAvailabilityInTransaction(
        sessionId,
        tx
      );
      if (!availability.available) return;

      // Intentar crear reserva automáticamente
      try {
        const packages = await getUserActivePackages(waitlistEntry.userId, tx);
        if (packages.length === 0) {
          // Marcar como rechazado por falta de paquetes
          await tx.waitingList.update({
            where: {
              userId_sessionId: {
                userId: waitlistEntry.userId,
                sessionId,
              },
            },
            data: {
              isAvailable: false,
              error: "No tiene paquetes disponibles",
              updatedAt: new Date(),
            },
          });
          return;
        }

        // Crear la reserva
        const session = await tx.session.findUnique({
          where: { id: sessionId },
        });

        const classType =
          normalizeClassType(session.type) ?? ClassType.INDIVIDUAL;
        const selectedPackage = selectPackageForClass(packages, classType);

        if (!selectedPackage) {
          throw new Error("No hay paquete compatible");
        }

        const packageToUse = selectedPackage.pkg;

        // Asignar primer asiento disponible
        const firstSeat = availability.availableSeats[0] || 1;

        const now = new Date();
        const reservation = await tx.reservation.create({
          data: {
            userId: waitlistEntry.userId,
            sessionId,
            transactionId: Number(packageToUse.id),
            placeNumber: firstSeat,
            isAvailable: true,
            createdAt: now,
            updatedAt: now,
          },
        });

        // Marcar waitlist como aceptado
        await tx.waitingList.update({
          where: {
            userId_sessionId: {
              userId: waitlistEntry.userId,
              sessionId,
            },
          },
          data: {
            // isAvailable = false => ya no está pendiente en lista de espera
            isAvailable: false,
            error: null,
            updatedAt: new Date(),
          },
        });

        // Actualizar counters y capacidad
        await updateTransactionCounters(Number(packageToUse.id), tx);
        await tx.session.update({
          where: { id: sessionId },
          data: { availableCapacity: { decrement: 1 } },
        });

        // Log
        await tx.reservationEvent.create({
          data: {
            reservationId: reservation.id,
            userId: waitlistEntry.userId,
            sessionId,
            eventType: "created",
            metadata: { fromWaitlist: true, seat: firstSeat },
          },
        });

        // Email (asíncrono, fuera de transacción)
        if (waitlistEntry.user?.email && session) {
          const classInfo = `${session.discipline?.name || "Clase"}`;
          const classType = session.discipline?.classType;
          sendWaitlistAcceptedEmail(
            waitlistEntry.user.email,
            waitlistEntry.user.name || "Usuario",
            sessionId.toString(),
            firstSeat,
            classType
          ).catch((err) => console.error("Error sending waitlist email:", err));
        }
      } catch (error) {
        console.error("Error processing waitlist entry:", error);
        // Marcar como rechazado
        await tx.waitingList.update({
          where: {
            userId_sessionId: {
              userId: waitlistEntry.userId,
              sessionId,
            },
          },
          data: {
            isAvailable: false,
            error: String(error),
            updatedAt: new Date(),
          },
        });
      }
    } catch (error) {
      console.error("Error in processWaitlistForSession:", error);
    }
  }

  /**
   * Helper para verificar disponibilidad dentro de una transacción
   */
  private async checkAvailabilityInTransaction(
    sessionId: number,
    tx: any
  ): Promise<AvailabilityCheck> {
    const session = await tx.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return {
        available: false,
        capacity: 0,
        reserved: 0,
        availableSeats: [],
      };
    }

    const reservations = await tx.reservation.findMany({
      where: { sessionId, cancellationAt: null },
      select: { placeNumber: true },
    });

    const reserved = reservations.length;
    const capacity = session.exerciseRoomCapacity;
    const takenSeats = new Set(reservations.map((r: any) => r.placeNumber));
    const availableSeats: number[] = [];

    for (let i = 1; i <= capacity; i++) {
      if (!takenSeats.has(i)) {
        availableSeats.push(i);
      }
    }

    return {
      available: reserved < capacity,
      capacity,
      reserved,
      availableSeats,
    };
  }

  /**
   * Obtiene el código de error apropiado
   */
  private getErrorCode(message: string): string {
    if (message === ERROR_CODES.USER_NOT_FOUND) return "USER_NOT_FOUND";
    if (message === ERROR_CODES.CLASS_NOT_FOUND) return "CLASS_NOT_FOUND";
    if (message === ERROR_CODES.DUPLICATE_RESERVATION)
      return "DUPLICATE_RESERVATION";
    if (message === ERROR_CODES.NO_SLOTS_AVAILABLE) return "NO_SLOTS_AVAILABLE";
    if (message === ERROR_CODES.NO_PACKAGES) return "NO_PACKAGES";
    if (message === ERROR_CODES.NO_COMPATIBLE_PACKAGE)
      return "NO_COMPATIBLE_PACKAGE";
    if (message === ERROR_CODES.SEAT_ALREADY_TAKEN) return "SEAT_ALREADY_TAKEN";
    if (message.includes("ya pasó")) return "CLASS_ALREADY_PAST";
    if (message.includes("ya fue cancelada")) return "ALREADY_CANCELLED";
    if (message.includes("ventana")) return "CANCELLATION_WINDOW_EXPIRED";
    return "INTERNAL_ERROR";
  }
}

// Exportar instancia singleton
export const reservationService = new ReservationService();
