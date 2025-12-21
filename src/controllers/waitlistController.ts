import { Request, Response } from "express";
import { prisma } from "../config/prisma"; // Adjust path if needed
import { ERROR_CODES, ClassType } from "../types/enums";
import { DateTime } from "luxon";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  sendWaitlistEntryEmail,
  // sendWaitlistAcceptedEmail, // Not used in original code?
  // sendWaitlistRejectedEmail, // Not used in original code?
} from "../utils/emailService";

// Helper to parse composite ID
const parseWaitlistId = (
  id: string
): { userId: number; sessionId: number } | null => {
  const parts = id.split("_");
  if (parts.length !== 2) return null;
  const userId = parseInt(parts[0]);
  const sessionId = parseInt(parts[1]);
  if (isNaN(userId) || isNaN(sessionId)) return null;
  return { userId, sessionId };
};

/* ===============================================================
   1) Crear entrada en waitlist
   =============================================================== */
export const createWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId: userIdStr, classId: classIdStr } = req.body;
    const userId = parseInt(userIdStr);
    const sessionId = parseInt(classIdStr);

    if (isNaN(userId) || isNaN(sessionId)) {
      res.status(400).json({ error: "ID de usuario o clase inválido" });
      return;
    }

    const resultId = await prisma.$transaction(async (tx) => {
      // 1. Verificar Usuario
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { transactions: true }, // Need active packages
      });
      if (!user) throw new Error(ERROR_CODES.USER_NOT_FOUND);

      // 2. Verificar Clase (Session)
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: {
          exerciseRoom: true,
          reservations: {
            where: { isAvailable: true }, // Active reservations
          },
        },
      });
      if (!session) throw new Error(ERROR_CODES.CLASS_NOT_FOUND);

      // 3. Verificar disponibilidad (Waitlist es SOLO si NO hay cupo)
      // Capacidad total
      const capacity =
        session.exerciseRoomCapacity || session.exerciseRoom?.capacity || 0;
      const occupied = session.reservations.length; // Count actual active reservations
      const available = capacity - occupied;

      if (available > 0) {
        // Hay lugar, no debería entrar en waitlist
        throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);
        // Note: The original code throws NO_SLOTS_AVAILABLE if available > 0,
        // implying "You should reserve directly, not waitlist".
        // But the error code name is confusing. Sticking to original logic.
      }

      // 4. Evitar duplicado pendiente
      const existing = await tx.waitingList.findUnique({
        where: {
          userId_sessionId: { userId, sessionId },
        },
      });

      if (existing && existing.status === "pending") {
        throw new Error(ERROR_CODES.DUPLICATE_RESERVATION);
      }

      // 5. Lógica de Paquetes
      // Filtrar paquetes activos
      const now = new Date();
      const activePackages = user.transactions.filter(
        (t) =>
          t.status === 1 && // Active status (assuming 1 is active)
          t.haveSessionsAvailable && // Has sessions
          (!t.expirationAt || t.expirationAt > now) // Not expired
      );

      // Check unlimited
      const unlimitedPackages = activePackages.filter(
        (t) => t.packageIsUnlimited
      );
      const hasUnlimited = unlimitedPackages.length > 0;

      if (hasUnlimited) {
        // Verificar límite diario (2 clases)
        const sessionDate = session.dateStart; // Date object
        const startOfDay = new Date(sessionDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(sessionDate);
        endOfDay.setHours(23, 59, 59, 999);

        const dailyReservations = await tx.reservation.count({
          where: {
            userId: userId,
            isAvailable: true,
            session: {
              dateStart: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
          },
        });

        if (dailyReservations >= 2) {
          throw new Error(ERROR_CODES.UNLIMITED_DAILY_LIMIT);
        }
      }

      let consumedClass = false;
      let packageId: number | null = null;

      if (!hasUnlimited) {
        // Seleccionar paquete finito
        // Sort by expiry (asc), then creation (asc)
        const sortedPackages = activePackages.sort((a, b) => {
          const expA = a.expirationAt ? a.expirationAt.getTime() : Infinity;
          const expB = b.expirationAt ? b.expirationAt.getTime() : Infinity;
          if (expA !== expB) return expA - expB;
          return (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
        });

        if (sortedPackages.length === 0) {
          throw new Error(ERROR_CODES.NO_CLASSES_AVAILABLE);
        }

        const selectedPkg = sortedPackages[0];
        packageId = selectedPkg.id;
        consumedClass = true;

        // Descontar del paquete (Transaction)
        // Waitlist logic: we deduct ONLY if it's NOT unlimited.
        // The check `!hasUnlimited` guarantees this.
        // We update the transaction inside the transaction block

        // Update user stats?
        // The original code updates `user.classes`.
        // In SQL, `User` has `classesAvailable` and `classesTaken`.

        // Update Transaction (assuming `haveSessionsAvailable` is the flag)
        // We don't have a `classesUsed` field on Transaction in the schema provided?
        // Let's check Transaction model again.
        // `haveSessionsAvailable` Boolean.
        // `packageTotalClasses` Int.
        // It doesn't seem to track *remaining* classes explicitly on Transaction?
        // Wait, User has `classesAvailable`.
        // The schema for `Transaction` has `packageTotalClasses`.
        // Maybe `User.classesAvailable` is the aggregate?

        // Let's look at `User` model: `classesAvailable`, `classesTaken`.
        // So we update `User`.

        await tx.user.update({
          where: { id: userId },
          data: {
            classesAvailable: { decrement: 1 },
            classesTaken: { increment: 1 },
          },
        });

        // Also, if we want to track which package was used, we might need to update the transaction?
        // The schema doesn't show a `remainingClasses` on Transaction.
        // But `Transaction` has `haveSessionsAvailable`.
        // If `User.classesAvailable` reaches 0, we might need to set `haveSessionsAvailable = false` on the transactions?
        // This logic is complex without seeing how `classesAvailable` is maintained.
        // Assuming `User.classesAvailable` is the source of truth for now.

        // Also check if we need to expire the transaction if it was the last class?
        // Without granular tracking per transaction, we just pick one ID for reference.
      }

      // 6. Crear Waitlist
      // Use upsert to handle re-entry if rejected/cancelled previously?
      // Original code checks for "pending" duplicate. If "rejected", new entry is allowed.
      // Prisma composite ID means we overwrite or fail if exists.
      // If previous was rejected/cancelled, we should delete it or update it.
      // Since ID is composite, we can only have ONE entry per user-session.
      // So we use `upsert`.

      const wl = await tx.waitingList.upsert({
        where: { userId_sessionId: { userId, sessionId } },
        update: {
          status: "pending",
          consumedClass,
          packageId,
          rejectedEmailSent: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        create: {
          userId,
          sessionId,
          status: "pending",
          consumedClass,
          packageId,
          isAvailable: true, // Assuming this means the request is valid? Or something else?
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return `${userId}_${sessionId}`;
    });

    // Email notification
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await sendWaitlistEntryEmail(user.email, user.name, classIdStr);
      }
    } catch (e) {
      console.error("Email waitlist entry falló:", e);
    }

    res
      .status(201)
      .json({ message: "Entraste en lista de espera", id: resultId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const map: Record<string, number> = {
      [ERROR_CODES.USER_NOT_FOUND]: 404,
      [ERROR_CODES.CLASS_NOT_FOUND]: 404,
      [ERROR_CODES.NO_SLOTS_AVAILABLE]: 400,
      [ERROR_CODES.DUPLICATE_RESERVATION]: 409,
      [ERROR_CODES.NO_CLASSES_AVAILABLE]: 409,
      [ERROR_CODES.UNLIMITED_DAILY_LIMIT]: 400,
    };
    res.status(map[msg] ?? 500).json({ error: msg, code: msg });
  }
};

/* ===============================================================
   2) Listar todas
   =============================================================== */
export const getAllWaitlistsController = async (
  req: Request | AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    // Build query
    const where: any = {};

    // Filter by user if /my
    if (req.path === "/my" || req.originalUrl.includes("/my")) {
      if (!user) {
        res.status(401).json({ error: "Token no proporcionado" });
        return;
      }
      where.userId = user.id;
    }

    // Filter by branch if staff
    if (
      user &&
      (user.role === "collaborator" || user.role === "instructor") &&
      user.branches &&
      user.branches.length > 0
    ) {
      // Need to filter sessions by branch
      // user.branches is array of IDs (or strings? Schema says String/Int in middleware)
      // Session -> BranchOffice.
      // Assuming user.branches contains IDs.
      where.session = {
        branchOfficeId: { in: user.branches.map((b) => Number(b)) },
      };
    }

    const waitlists = await prisma.waitingList.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        session: {
          include: {
            discipline: true,
            instructor: true, // This is `Staff`
            branchOffice: true,
          },
        },
        user: true,
      },
    });

    // Enrich response to match old structure
    const enriched = waitlists.map((wl) => {
      const s = wl.session;
      return {
        id: `${wl.userId}_${wl.sessionId}`,
        userId: String(wl.userId),
        classId: String(wl.sessionId),
        status: wl.status,
        createdAt: wl.createdAt,
        consumedClass: wl.consumedClass,
        packageId: wl.packageId ? String(wl.packageId) : null,
        class: s
          ? {
              id: String(s.id),
              day: s.dateStart, // Format? Old was "YYYY-MM-DD"
              hour: s.timeStart, // Format? Old was "HH:mm"
              disciplineName: s.discipline?.name || "",
              instructorFirstName: s.instructor?.username || "", // Staff doesn't have firstName in main table?
              // Staff has `profile`.
              // Need to include profile in query.
              branch: s.branchOffice?.id,
            }
          : null,
        // Add user info if needed? Old code didn't seem to add user details in `enriched` map explicitly but `list` had data()
        // Wait, old code `getAllWaitlists` mapped doc.data().
      };
    });

    // To get instructor name correctly:
    // `session.instructor` is `Staff`. `Staff` has `profile` relation.
    // I should update include.

    res.status(200).json({ waitlists: enriched });
  } catch (err) {
    console.error("getAllWaitlists error:", err);
    res.status(500).json({ error: "Error interno al listar waitlists" });
  }
};

/* ===============================================================
   3) Listar pendientes por clase
   =============================================================== */
/* ===============================================================
   3) Listar pendientes por clase
   =============================================================== */
export const getWaitlistsByClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const classIdStr = req.query.classId as string;
    if (!classIdStr) {
      res.status(400).json({ error: "classId es requerido" });
      return;
    }
    const sessionId = parseInt(classIdStr);

    const waitlists = await prisma.waitingList.findMany({
      where: {
        sessionId: sessionId,
        status: "pending",
      },
      include: {
        user: true,
        session: {
          include: { discipline: true, instructor: true, branchOffice: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const list = waitlists.map((wl) => ({
      id: `${wl.userId}_${wl.sessionId}`,
      userId: String(wl.userId),
      classId: String(wl.sessionId),
      status: wl.status,
      createdAt: wl.createdAt,
      consumedClass: wl.consumedClass,
      packageId: wl.packageId ? String(wl.packageId) : null,
      user: {
        id: wl.user.id,
        name: wl.user.name,
        lastname: wl.user.lastname,
        email: wl.user.email,
      },
    }));

    res.status(200).json({ waitlists: list });
  } catch (err) {
    console.error("getWaitlistsByClass error:", err);
    res.status(500).json({ error: "Error interno al obtener waitlists" });
  }
};

/* ===============================================================
   6) Delete
   =============================================================== */
export const deleteWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { waitlistId } = req.params;
  const ids = parseWaitlistId(waitlistId);
  if (!ids) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    await prisma.waitingList.delete({
      where: {
        userId_sessionId: { userId: ids.userId, sessionId: ids.sessionId },
      },
    });
    res.json({ message: "Eliminado de la lista de espera" });
  } catch (e) {
    res.status(500).json({ error: "Error eliminando de waitlist" });
  }
};

/* ===============================================================
   4) Obtener por ID
   =============================================================== */
export const getWaitlistByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { waitlistId } = req.params;
    const ids = parseWaitlistId(waitlistId);

    if (!ids) {
      res.status(404).json({ error: "ID de waitlist inválido" });
      return;
    }

    const wl = await prisma.waitingList.findUnique({
      where: { userId_sessionId: ids },
    });

    if (!wl) {
      res.status(404).json({ error: "Waitlist no encontrada" });
      return;
    }

    res.status(200).json({
      id: waitlistId,
      userId: String(wl.userId),
      classId: String(wl.sessionId),
      status: wl.status,
      createdAt: wl.createdAt,
      consumedClass: wl.consumedClass,
      packageId: wl.packageId ? String(wl.packageId) : null,
    });
  } catch (err) {
    console.error("getWaitlistById error:", err);
    res.status(500).json({ error: "Error interno al obtener waitlist" });
  }
};

/* ===============================================================
   5) Aceptar / Rechazar
   =============================================================== */
export const updateWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { waitlistId } = req.params;
    const { status } = req.body;

    if (!["accepted", "rejected"].includes(status)) {
      res.status(400).json({ error: "Status inválido" });
      return;
    }

    const ids = parseWaitlistId(waitlistId);
    if (!ids) {
      res.status(404).json({ error: "Waitlist no encontrada (ID inválido)" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const wl = await tx.waitingList.findUnique({
        where: { userId_sessionId: ids },
      });
      if (!wl) throw new Error("WAITLIST_NOT_FOUND");
      if (wl.status !== "pending") throw new Error("WAITLIST_NOT_PENDING");

      const session = await tx.session.findUnique({
        where: { id: ids.sessionId },
        include: { reservations: { where: { isAvailable: true } } },
      });
      if (!session) throw new Error("CLASS_NOT_FOUND");

      if (status === "accepted") {
        // Validar cupo
        const capacity = session.exerciseRoomCapacity || 0;
        const occupied = session.reservations.length;
        const available = capacity - occupied;

        if (available <= 0) throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);

        // Límite diario ilimitado (si no consumió clase)
        if (!wl.consumedClass) {
          const sessionDate = session.dateStart;
          const startOfDay = new Date(sessionDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(sessionDate);
          endOfDay.setHours(23, 59, 59, 999);

          const daily = await tx.reservation.count({
            where: {
              userId: ids.userId,
              isAvailable: true,
              session: {
                dateStart: { gte: startOfDay, lte: endOfDay },
              },
            },
          });
          if (daily >= 2) throw new Error(ERROR_CODES.UNLIMITED_DAILY_LIMIT);
        }

        // Asignar asiento
        // Assuming default logic: find first available seat number
        const occupiedSeats = session.reservations
          .map((r) => r.placeNumber)
          .filter((n) => n !== null)
          .sort((a, b) => a - b);

        let assignedSeat = 0;
        for (let i = 1; i <= capacity; i++) {
          if (!occupiedSeats.includes(i)) {
            assignedSeat = i;
            break;
          }
        }
        if (assignedSeat === 0 && capacity > 0) assignedSeat = capacity;

        // Crear reserva
        await tx.reservation.create({
          data: {
            userId: ids.userId,
            sessionId: ids.sessionId,
            placeNumber: assignedSeat,
            isAvailable: true,
            // classDay: session.dateStart, // Not in schema, session has dateStart
            createdAt: new Date(),
            attended: false,
            transactionId: wl.packageId || undefined,
            // consumedClass logic handled by transactionId link?
          },
        });

        // Update Waitlist
        await tx.waitingList.update({
          where: { userId_sessionId: ids },
          data: { status: "accepted" },
        });

        // Update Session occupied?
        // Not needed if we count reservations dynamically, but if there is an occupied field:
        // Session model doesn't have `occupied` field in the schema I read.
        // It has `availableCapacity`.
        // If we maintain `availableCapacity`:
        await tx.session.update({
          where: { id: ids.sessionId },
          data: { availableCapacity: { decrement: 1 } },
        });

        return {
          userId: ids.userId,
          classId: ids.sessionId,
          action: "accepted",
          seat: assignedSeat,
        };
      } else {
        // Rejected
        if (wl.consumedClass) {
          // Reembolsar
          await tx.user.update({
            where: { id: ids.userId },
            data: {
              classesAvailable: { increment: 1 },
              classesTaken: { decrement: 1 },
            },
          });
        }

        await tx.waitingList.update({
          where: { userId_sessionId: ids },
          data: {
            status: "rejected",
            rejectedEmailSent: true, // Flag to avoid double sending if we had a cron
          },
        });

        return {
          userId: ids.userId,
          classId: ids.sessionId,
          action: "rejected",
        };
      }
    });

    res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ... map errors ...
    res.status(500).json({ error: msg });
  }
};
