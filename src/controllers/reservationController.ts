import { Request, Response } from "express";
import prisma from "../config/prisma";
import { ERROR_CODES, ClassType } from "../types/enums";
import { DateTime } from "luxon";
import { minutesUntilClassMx, formatDateVisibleMx } from "../utils/time";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  sendReservationCancelledEmail,
  sendReservationConfirmationEmail,
  sendWaitlistAcceptedEmail,
} from "../utils/emailService";
import {
  normalizeClassType,
  selectPackageForClass,
  UserPackage,
} from "../utils/packageSelection";
import { reservationService } from "../services/reservation.service";

/* ---------- Tipos locales ---------- */
interface UserClassesAgg {
  available: number;
  taken: number;
  total: number;
}

/* ---------- Helpers ---------- */
const diffMinutesFromNow = (day: string, hour: string): number =>
  minutesUntilClassMx(day, hour);

const canCancelByConfig = (
  session: { dateStart: Date; timeStart: Date; type: string },
  cfg: { individual: number; groups: number }
): boolean => {
  const t = normalizeClassType(session.type) ?? ClassType.INDIVIDUAL;
  const windowMin = t === ClassType.GROUPS ? cfg.groups : cfg.individual;
  const day = session.dateStart.toISOString().slice(0, 10);
  const hour = session.timeStart.toISOString().slice(11, 16);
  const minutesUntilClass = diffMinutesFromNow(day, hour);
  return minutesUntilClass > windowMin;
};

const statusFromMessage = (m: string): number => {
  if (
    m === ERROR_CODES.USER_NOT_FOUND ||
    m === ERROR_CODES.CLASS_NOT_FOUND ||
    m === "Reserva no encontrada" ||
    m === "RESERVATION_NOT_FOUND"
  )
    return 404;

  if (m === ERROR_CODES.UNLIMITED_DAILY_LIMIT) return 400;

  if (
    m === ERROR_CODES.DUPLICATE_RESERVATION ||
    m === ERROR_CODES.NO_SLOTS_AVAILABLE ||
    m === ERROR_CODES.NO_CLASSES_AVAILABLE ||
    m === ERROR_CODES.NO_PACKAGES ||
    m === ERROR_CODES.NO_COMPATIBLE_PACKAGE ||
    m === ERROR_CODES.SEAT_ALREADY_TAKEN
  )
    return 409;

  if (
    m === "No se puede reservar una clase que ya pasó" ||
    m === "La clase no tiene fecha u hora definida" ||
    m === "La fecha u hora de la clase no es válida"
  )
    return 400;

  // Errores de ventana de cancelación configurable
  if (m.startsWith("No se puede cancelar. Las clases")) return 400;

  return 500;
};

const codeFromMessage = (m: string): string => {
  if (m === ERROR_CODES.USER_NOT_FOUND) return "USER_NOT_FOUND";
  if (m === ERROR_CODES.CLASS_NOT_FOUND) return "CLASS_NOT_FOUND";
  if (m === ERROR_CODES.DUPLICATE_RESERVATION) return "DUPLICATE_RESERVATION";
  if (m === ERROR_CODES.NO_SLOTS_AVAILABLE) return "NO_SLOTS_AVAILABLE";
  if (m === ERROR_CODES.NO_CLASSES_AVAILABLE) return "NO_CLASSES_AVAILABLE";
  if (m === ERROR_CODES.NO_PACKAGES) return "NO_PACKAGES";
  if (m === ERROR_CODES.NO_COMPATIBLE_PACKAGE) return "NO_COMPATIBLE_PACKAGE";
  if (m === ERROR_CODES.UNLIMITED_DAILY_LIMIT) return "UNLIMITED_DAILY_LIMIT";
  if (m === ERROR_CODES.SEAT_ALREADY_TAKEN) return "SEAT_ALREADY_TAKEN";
  if (m === "No se puede reservar una clase que ya pasó")
    return "CLASS_ALREADY_PAST";
  return "INTERNAL_ERROR";
};

// Helper para convertir Transaction a UserPackage
const getUserPackages = async (userId: number): Promise<UserPackage[]> => {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      isCompleted: true,
      status: 1, // Asumiendo 1 es activo
      OR: [{ expirationAt: { gt: new Date() } }, { expirationAt: null }],
      haveSessionsAvailable: true,
    },
  });

  if (transactions.length === 0) return [];

  const transactionIds = transactions.map((t) => t.id);
  const reservationsCount = await prisma.reservation.groupBy({
    by: ["transactionId"],
    _count: { id: true },
    where: {
      transactionId: { in: transactionIds },
      cancellationAt: null,
    },
  });

  const countMap = new Map<number, number>();
  reservationsCount.forEach((r) => {
    if (r.transactionId) countMap.set(r.transactionId, r._count.id);
  });

  return transactions.map((t) => ({
    id: String(t.id),
    active: true,
    totalClasses: t.packageTotalClasses,
    classesUsed: countMap.get(t.id) ?? 0,
    isUnlimited: t.packageIsUnlimited,
    type: t.packageType,
    assignedAt: t.createdAt ? t.createdAt.toISOString() : undefined,
    expiresAt: t.expirationAt ? t.expirationAt.toISOString() : null,
  }));
};

/* ===============================================================
   CREATE
   =============================================================== */
export const createReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId: userIdRaw, classId: classIdRaw, seat } = req.body;

    if (!userIdRaw || !classIdRaw) {
      res.status(400).json({ error: "userId y classId son requeridos" });
      return;
    }

    // Resolver usuario solo por ID SQL (aceptando "sql_123" o "123")
    let userId: number;
    if (typeof userIdRaw === "number") {
      userId = userIdRaw;
    } else {
      const match = /^sql_(\d+)$/.exec(String(userIdRaw));
      const numericId = match ? Number(match[1]) : Number(userIdRaw);

      if (!numericId || Number.isNaN(numericId)) {
        const msg = ERROR_CODES.USER_NOT_FOUND;
        res
          .status(statusFromMessage(msg))
          .json({ error: msg, code: codeFromMessage(msg) });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: numericId },
      });

      if (!user) {
        const msg = ERROR_CODES.USER_NOT_FOUND;
        res
          .status(statusFromMessage(msg))
          .json({ error: msg, code: codeFromMessage(msg) });
        return;
      }

      userId = user.id;
    }

    // Resolver clase (session)
    const sessionId = Number(classIdRaw);
    if (Number.isNaN(sessionId)) {
      const msg = ERROR_CODES.CLASS_NOT_FOUND;
      res
        .status(statusFromMessage(msg))
        .json({ error: msg, code: codeFromMessage(msg) });
      return;
    }

    const result = await reservationService.createReservation({
      userId,
      sessionId,
      seat: typeof seat === "number" ? seat : undefined,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });

    if (!result.success) {
      const msg = result.error || "Error al crear reserva";
      const status = statusFromMessage(msg);
      const code = codeFromMessage(msg);
      res
        .status(status)
        .json({ error: msg, code, errorCode: result.errorCode });
      return;
    }

    res.status(201).json({
      message: result.message || "Reserva creada correctamente",
      id: result.reservationId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = statusFromMessage(msg);
    const code = codeFromMessage(msg);
    res.status(status).json({ error: msg, code });
  }
};

export const createBulkReservationsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId: userIdRaw, classId: classIdRaw, seats } = req.body;

    if (!Array.isArray(seats) || seats.length === 0) {
      res.status(400).json({ error: "seats es requerido" });
      return;
    }

    // Resolver usuario solo por ID SQL (aceptando "sql_123" o "123")
    let userId: number;
    if (typeof userIdRaw === "number") {
      userId = userIdRaw;
    } else {
      const match = /^sql_(\d+)$/.exec(String(userIdRaw));
      const numericId = match ? Number(match[1]) : Number(userIdRaw);

      if (!numericId || Number.isNaN(numericId)) {
        const msg = ERROR_CODES.USER_NOT_FOUND;
        res
          .status(statusFromMessage(msg))
          .json({ error: msg, code: codeFromMessage(msg) });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: numericId },
      });

      if (!user) {
        const msg = ERROR_CODES.USER_NOT_FOUND;
        res
          .status(statusFromMessage(msg))
          .json({ error: msg, code: codeFromMessage(msg) });
        return;
      }

      userId = user.id;
    }

    const sessionId = Number(classIdRaw);
    if (Number.isNaN(sessionId)) {
      const msg = ERROR_CODES.CLASS_NOT_FOUND;
      res
        .status(statusFromMessage(msg))
        .json({ error: msg, code: codeFromMessage(msg) });
      return;
    }

    const created: number[] = [];

    for (const rawSeat of seats) {
      const seatNumber =
        typeof rawSeat === "number" ? rawSeat : Number(rawSeat) || undefined;

      const result = await reservationService.createReservation({
        userId,
        sessionId,
        seat: seatNumber,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });

      if (!result.success) {
        const msg = result.error || "Error al crear reservas";
        const status = statusFromMessage(msg);
        const code = codeFromMessage(msg);
        res
          .status(status)
          .json({ error: msg, code, errorCode: result.errorCode, created });
        return;
      }

      if (result.reservationId) {
        created.push(result.reservationId);
      }
    }

    res.status(201).json({ message: "Reservas creadas", created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
};

/* ===============================================================
   LIST / GET ONE
   =============================================================== */
export const getAllReservationsController = async (
  req: Request | AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user; // populated by middleware
    const qp = req.query;

    let where: any = { cancellationAt: null }; // Default active
    if (qp.status === "cancelled") where = { cancellationAt: { not: null } };
    // if (qp.status === "changed") ...

    if (req.path === "/my" || req.originalUrl.includes("/my")) {
      if (!user) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }
      where.userId = user.id;
    }

    const reservations = await prisma.reservation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        session: {
          include: {
            branchOffice: true,
            discipline: true,
            instructor: { include: { profile: true } },
            exerciseRoom: true,
          },
        },
      },
    });

    // Map to response format if needed (legacy compatibility)
    const mapped = reservations.map((r) => ({
      id: r.id,
      userId: r.userId,
      classId: r.sessionId,
      seat: r.placeNumber,
      status: r.cancellationAt ? "cancelled" : "active",
      createdAt: r.createdAt,
      class: r.session
        ? {
            id: r.session.id,
            day: r.session.dateStart.toISOString().slice(0, 10),
            hour: r.session.timeStart.toISOString().slice(11, 16),
            branchName: r.session.branchOffice?.name,
            disciplineName: r.session.discipline?.name,
            instructorFirstName: r.session.instructor?.profile?.firstname,
            instructorLastName: r.session.instructor?.profile?.paternalSurname,
            type:
              r.session.type === "g"
                ? "grupal"
                : r.session.type === "i"
                  ? "individual"
                  : r.session.type,
          }
        : null,
    }));

    res.status(200).json({ reservations: mapped });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
};

export const getReservationsByClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  try {
    const reservations = await prisma.reservation.findMany({
      where: {
        sessionId: Number(classId),
        cancellationAt: null,
      },
      include: {
        user: true,
      },
    });

    const mapped = reservations.map((r) => ({
      id: r.id,
      seat: r.placeNumber,
      user: r.user
        ? {
            id: r.user.id,
            firstName: r.user.name, // Mapping name to firstName
            email: r.user.email,
            phone: r.user.phone,
          }
        : null,
    }));

    res.status(200).json({ reservations: mapped, total: mapped.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
};

export const getReservationByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;
  try {
    const r = await prisma.reservation.findUnique({
      where: { id: Number(reservationId) },
    });
    if (!r) {
      res.status(404).json({ error: "Reserva no encontrada" });
      return;
    }
    res.status(200).json(r);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
};

/* ===============================================================
   UPDATE
   =============================================================== */
export const updateReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;
  try {
    // Basic update (seat, etc)
    const data = req.body;
    await prisma.reservation.update({
      where: { id: Number(reservationId) },
      data,
    });
    res.status(200).json({ message: "Reserva actualizada" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
};

/* ===============================================================
   CANCEL
   =============================================================== */
export const deleteReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;

  const id = Number(reservationId);
  if (!reservationId || Number.isNaN(id)) {
    res.status(400).json({ error: "ID de reserva inválido" });
    return;
  }

  try {
    // Para mantener alineado el negocio con MySQL y reutilizar
    // la misma lógica que usa el usuario final, delegamos en
    // ReservationService.cancelReservation.

    // Primero obtenemos la reserva para conocer el userId dueño
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!reservation || !reservation.userId) {
      res.status(404).json({ error: "RESERVATION_NOT_FOUND" });
      return;
    }

    const result = await reservationService.cancelReservation({
      reservationId: id,
      userId: reservation.userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });

    if (!result.success) {
      const message = result.error || "Error al cancelar la reserva";
      res
        .status(statusFromMessage(message))
        .json({ error: message, errorCode: result.errorCode });
      return;
    }

    res.status(200).json({ message: "Reserva cancelada" });
  } catch (error: any) {
    console.error("Error en deleteReservationController:", error);
    res.status(500).json({ error: "Error al cancelar la reserva" });
  }
};

/* ===============================================================
   CHANGE
   =============================================================== */
export const changeReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;
  const { newClassId, newSeat } = req.body || {};

  const id = Number(reservationId);
  const newSessionId = Number(newClassId);

  if (!id || Number.isNaN(id) || !newSessionId || Number.isNaN(newSessionId)) {
    res
      .status(400)
      .json({ error: "reservationId y newClassId son requeridos" });
    return;
  }

  try {
    // Obtener dueo de la reserva para validar permisos
    const existing = await prisma.reservation.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing || !existing.userId) {
      const msg = "Reserva no encontrada";
      res
        .status(statusFromMessage(msg))
        .json({ error: msg, code: codeFromMessage(msg) });
      return;
    }

    const result = await reservationService.changeReservation({
      reservationId: id,
      userId: existing.userId,
      newSessionId,
      newSeat: typeof newSeat === "number" ? newSeat : undefined,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });

    if (!result.success) {
      const msg = result.error || "Error al cambiar la reserva";
      const status = statusFromMessage(msg);
      const code = codeFromMessage(msg);
      res
        .status(status)
        .json({ error: msg, code, errorCode: result.errorCode });
      return;
    }

    res.status(200).json({
      message: result.message || "Reserva cambiada correctamente",
      id: result.reservationId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = statusFromMessage(msg);
    const code = codeFromMessage(msg);
    res.status(status).json({ error: msg, code });
  }
};
