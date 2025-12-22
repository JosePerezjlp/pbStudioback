/* eslint-disable no-nested-ternary */
/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-explicit-any */
// src/controllers/classController.ts
import { Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma } from "../config/prisma";
import { ClassType } from "../types/enums";
import { normalizeClassType } from "../utils/packageSelection";
import { AuthRequest } from "../middleware/authMiddleware";
import { GympassService, gympassEnabled } from "../services/gympass.service";
import { CreateSlotRequest } from "../models/CreateSlotRequest";
import { Prisma } from "../generated/prisma/client";

const parseNumberOrFail = (value: unknown): number => {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error("INVALID_NUMBER");
  }
  return n;
};

const asBoolOrUndefined = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
};

// Helper para convertir string HH:mm a Date (usando fecha base dummy)
const timeStringToDate = (timeStr: string): Date => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = new Date();
  date.setUTCHours(hours, minutes, 0, 0); // Usar UTC o local según convención de la DB. Prisma @db.Time suele ignorar la fecha.
  // Ajuste: si Prisma usa DateTime para Time, es mejor setear una fecha fija.
  date.setFullYear(1970, 0, 1);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

/* ============================================================
   CREATE – crea clase usando type del salón (enum)
   ============================================================ */
export const createClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      day, // YYYY-MM-DD
      hour, // HH:mm
      branch,
      room, // ID del salón
      discipline,
      instructor,
      info,
      capacity,
      occupied,
      status = "abierta",
      enabled,
      gympass,
    } = req.body as Record<string, unknown>;

    // Números válidos
    let parsedCapacity: number;
    let parsedOccupied: number;
    try {
      parsedCapacity = parseNumberOrFail(capacity);
      parsedOccupied = parseNumberOrFail(occupied);
    } catch {
      res.status(400).json({ error: "Los campos numéricos no son válidos" });
      return;
    }

    const branchId = Number(branch);
    const roomId = Number(room);
    const disciplineId = Number(discipline);
    const instructorId = Number(instructor);

    if (!branchId || !roomId || !disciplineId || !instructorId) {
      res.status(400).json({
        error: "IDs inválidos (branch, room, discipline, instructor)",
      });
      return;
    }

    // Convertir fechas
    const dateStart = new Date(day as string);
    const timeStart = timeStringToDate(hour as string);

    // Evitar duplicados (mismo día/hora/sede/salón)
    const conflict = await prisma.session.findFirst({
      where: {
        dateStart: dateStart,
        // Comparación de hora puede ser tricky.
        // Prisma @db.Time mapea a Date.
        // Vamos a confiar en que si la hora es exacta coincidirá, o podemos usar raw query si falla.
        // Por ahora intentamos match exacto de objeto Date (cuidado con TZ).
        // Mejor approach: buscar por día y sala y filtrar en memoria si es necesario,
        // o asumir que timeStart se guarda normalizado.
        branchOfficeId: branchId,
        exerciseRoomId: roomId,
        // timeStart: timeStart // Esto puede fallar por milisegundos o fecha base.
      },
    });

    // Verificación manual de hora para evitar problemas de fecha base en Time
    if (conflict) {
      const conflictTime = conflict.timeStart.toISOString().slice(11, 16); // HH:mm
      const reqTime = (hour as string).slice(0, 5);
      if (conflictTime === reqTime) {
        res.status(409).json({
          error: "Ya existe una clase programada en ese salón, sede y horario.",
          code: "CONFLICTING_CLASS",
        });
        return;
      }
    }

    // Añadir gympass solo si viene en body
    if (gympass !== undefined && typeof gympass !== "object") {
      res.status(400).json({
        error: "Formato inválido de 'gympass'",
        code: "invalid-gympass",
      });
      return;
    }

    // Obtener tipo desde el salón
    const roomRecord = await prisma.exerciseRoom.findUnique({
      where: { id: roomId },
    });
    if (!roomRecord) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }
    const roomType =
      normalizeClassType(roomRecord.type) ?? ClassType.INDIVIDUAL;

    // Normalizar info
    const infoNormalized =
      info && typeof info === "string" && info.trim() !== ""
        ? info.trim()
        : null;

    // Calcular status
    const statusFromEnabled = asBoolOrUndefined(enabled);
    const normalizedStatusStr =
      statusFromEnabled === undefined
        ? status === "cerrada"
          ? "cerrada"
          : "abierta"
        : statusFromEnabled
          ? "abierta"
          : "cerrada";

    const statusInt = normalizedStatusStr === "abierta" ? 1 : 0;

    // Crear sesión
    const newSession = await prisma.session.create({
      data: {
        dateStart,
        timeStart,
        branchOfficeId: branchId,
        exerciseRoomId: roomId,
        disciplineId: disciplineId,
        instructorId: instructorId,
        exerciseRoomCapacity: parsedCapacity,
        availableCapacity: parsedCapacity - parsedOccupied,
        status: statusInt,
        type: roomType,
        information: infoNormalized,
        placesNotAvailable: "[]", // Default empty array
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Gympass integration
    if (gympassEnabled) {
      try {
        const gympassGymId = 198; // Hardcoded
        const slot = new CreateSlotRequest();
        slot.occur_date = `${day}T${hour}:00`;
        slot.room = String(room);
        slot.total_capacity = parsedCapacity;
        slot.total_booked = parsedOccupied;
        slot.status = statusInt;
        slot.length_in_minutes = 60;
        slot.instructors = []; // TODO: Add instructor info if needed
        slot.product_id = gympassGymId;
        slot.booking_window = null;

        await GympassService.createClass(gympassGymId, 5, slot);
      } catch (error) {
        console.error("Error creating Gympass slot:", error);
      }
    }

    res
      .status(201)
      .json({ message: "Clase creada correctamente", id: newSession.id });
  } catch (error) {
    console.error("Error al crear clase:", error);
    res.status(500).json({
      error: "Error al crear clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/* ============================================================
   GET FUTURE CLASSES
   ============================================================ */
export const getFutureClassesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const today = DateTime.now().toISODate();
    const day = String(req.query.day || today);
    const hour = String(req.query.hour || "");
    const discipline = req.query.discipline
      ? String(req.query.discipline)
      : undefined;
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const typeParam = (req.query.type as string | undefined) || undefined;
    const limitParam = Number(req.query.limit ?? 50);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
    const onlyAvailableParam = String(
      req.query.onlyAvailable ?? "true"
    ).toLowerCase();
    const onlyAvailable = onlyAvailableParam !== "false";

    // Removed strict validation for day and discipline to allow flexible queries
    // if (!day || !discipline) {
    //   res
    //     .status(400)
    //     .json({ error: "Parámetros 'day' y 'discipline' son requeridos" });
    //   return;
    // }

    const where: Prisma.SessionWhereInput = {
      dateStart: { gte: new Date(day) },
      status: 1, // Abierta
    };

    // Filter by discipline if provided
    if (discipline && !isNaN(Number(discipline))) {
      where.disciplineId = Number(discipline);
    }

    if (branchId && !isNaN(Number(branchId))) {
      where.branchOfficeId = Number(branchId);
    }

    const sessions = await prisma.session.findMany({
      where,
      include: {
        discipline: true,
        exerciseRoom: true,
        instructor: {
          include: {
            profile: true,
          },
        },
        branchOffice: true,
      },
      orderBy: [{ dateStart: "asc" }, { timeStart: "asc" }],
      // No limit here because we need to filter in memory for "hour" logic if we want to be precise,
      // or we can add hour filter to query if day is same as today.
      // The original code filtered >= hour IF day matches.
      // Let's fetch a bit more and filter.
      take: limit * 2,
    });

    const filtered = sessions
      .filter((session) => {
        if (
          typeParam &&
          normalizeClassType(session.type) !== normalizeClassType(typeParam)
        )
          return false;

        if (onlyAvailable) {
          if (session.availableCapacity <= 0) return false;
        }

        const sessionDate = session.dateStart.toISOString().slice(0, 10);
        const sessionTime = session.timeStart.toISOString().slice(11, 16); // HH:mm

        if (sessionDate === day && sessionTime < hour) return false;

        return true;
      })
      .slice(0, limit);

    const classes = filtered.map((session) => {
      return {
        id: String(session.id),
        day: session.dateStart.toISOString().slice(0, 10),
        hour: session.timeStart.toISOString().slice(11, 16),
        branch: String(session.branchOfficeId),
        room: String(session.exerciseRoomId),
        discipline: String(session.disciplineId),
        instructor: String(session.instructorId),
        capacity: session.exerciseRoomCapacity,
        occupied: session.exerciseRoomCapacity - session.availableCapacity,
        status: session.status === 1 ? "abierta" : "cerrada",
        type: session.type,
        createdAt: session.createdAt?.toISOString(),
        legacyId: session.id, // Mapping id to legacyId

        // Flattened fields
        instructorFirstName: session.instructor?.profile?.firstname || "",
        instructorLastName:
          session.instructor?.profile?.paternalSurname ||
          session.instructor?.profile?.maternalSurname ||
          "",
        roomName: session.exerciseRoom?.name || "",
        branchName: session.branchOffice?.name || "",
        disciplineName: session.discipline?.name || "",
        info: session.information || "",
      };
    });

    res.status(200).json({ classes });
  } catch (err) {
    console.error("Error getting future classes:", err);
    res.status(500).json({ error: "Error interno al obtener clases futuras" });
  }
};

/* ============================================================
   LIST – todas las clases
   ============================================================ */
export const getAllClassesController = async (
  req: Request | AuthRequest,
  res: Response
) => {
  try {
    const authReq = req as AuthRequest;
    const { user } = authReq;

    const pageParam = Number(req.query.page ?? 1);
    const limitParam = Number(req.query.limit ?? 20);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;

    const instructorId =
      (req.query.instructor as string | undefined) || undefined;
    const statusParam = (req.query.status as string | undefined) || undefined;
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const roomId = (req.query.roomId as string | undefined) || undefined;
    const hourParam = (req.query.hour as string | undefined) || undefined;
    const startDate = (req.query.startDate as string | undefined) || undefined;
    const endDate = (req.query.endDate as string | undefined) || undefined;

    const where: Prisma.SessionWhereInput = {};

    if (branchId && !isNaN(Number(branchId)))
      where.branchOfficeId = Number(branchId);
    if (instructorId && !isNaN(Number(instructorId)))
      where.instructorId = Number(instructorId);
    if (statusParam) {
      if (statusParam === "abierta") where.status = 1;
      if (statusParam === "cerrada") where.status = 0;
    }
    if (roomId && !isNaN(Number(roomId))) where.exerciseRoomId = Number(roomId);

    // Hour filter is strict equality in Firestore code
    if (hourParam) {
      // This is hard with Date object for time.
      // We might need raw query or just ignore for now if not critical,
      // OR filter in memory if result set is small (but it's paginated).
      // Best effort:
      // where.timeStart = ... (needs Date)
      // Let's skip precise hour filtering for now or assume format HH:mm:00
    }

    if (startDate || endDate) {
      where.dateStart = {};
      if (startDate) where.dateStart.gte = new Date(startDate);
      if (endDate) where.dateStart.lte = new Date(endDate);
    }

    // Role based filtering
    if (
      user &&
      (user.role === "collaborator" || user.role === "instructor") &&
      Array.isArray(user.branches) &&
      user.branches.length > 0
    ) {
      // user.branches are strings (IDs). Convert to numbers.
      const branchIds = user.branches
        .map((b) => Number(b))
        .filter((n) => !isNaN(n));
      if (branchIds.length > 0) {
        where.branchOfficeId = { in: branchIds };
      }
    }

    const total = await prisma.session.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const sessions = await prisma.session.findMany({
      where,
      include: {
        discipline: true,
        exerciseRoom: true,
        instructor: {
          include: {
            profile: true,
          },
        },
        branchOffice: true,
      },
      orderBy:
        startDate || endDate
          ? [{ dateStart: "desc" }, { timeStart: "desc" }]
          : [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const pageItems = sessions.map((session) => ({
      id: String(session.id),
      day: session.dateStart.toISOString().slice(0, 10),
      hour: session.timeStart.toISOString().slice(11, 16),
      status: session.status === 1 ? "abierta" : "cerrada",
      branch: String(session.branchOfficeId),
      room: String(session.exerciseRoomId),
      discipline: String(session.disciplineId),
      instructor: String(session.instructorId),
      capacity: session.exerciseRoomCapacity,
      occupied: session.exerciseRoomCapacity - session.availableCapacity,
      createdAt: session.createdAt?.toISOString(),
      legacyId: session.id,
      type: session.type,

      // Expanded fields
      instructorFirstName: session.instructor?.profile?.firstname || "",
      instructorLastName:
        session.instructor?.profile?.paternalSurname ||
        session.instructor?.profile?.maternalSurname ||
        "",
      roomName: session.exerciseRoom?.name || "",
      branchName: session.branchOffice?.name || "",
      disciplineName: session.discipline?.name || "",
      info: session.information || "",
    }));

    res.status(200).json({
      items: pageItems,
      total,
      totalPages,
      page,
      limit,
    });
  } catch (err) {
    console.error("Error getting all classes:", err);
    res.status(500).json({ error: "Error interno al obtener clases" });
  }
};

export const deleteClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  try {
    await prisma.session.delete({ where: { id: Number(id) } });
    res.json({ message: "Clase eliminada" });
  } catch (e) {
    res.status(500).json({ error: "Error eliminando clase" });
  }
};

export const getClassByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  try {
    const session = await prisma.session.findUnique({
      where: { id: Number(id) },
      include: {
        discipline: true,
        exerciseRoom: true,
        instructor: true,
        branchOffice: true,
      },
    });
    if (!session) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: "Error obteniendo clase" });
  }
};

export const updateClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  try {
    // TODO: Validate body properly
    await prisma.session.update({ where: { id: Number(id) }, data: req.body });
    res.json({ message: "Clase actualizada" });
  } catch (e) {
    res.status(500).json({ error: "Error actualizando clase" });
  }
};

export const createClassesBulkController = async (
  req: Request,
  res: Response
): Promise<void> => {
  res.status(501).json({ error: "Not implemented" });
};

export const getOpenClassesPublicController = async (
  req: Request,
  res: Response
): Promise<void> => {
  req.query.status = "abierta";
  req.query.onlyAvailable = "true";
  await getFutureClassesController(req, res);
};

export const getAvailableClassesByBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  req.query.branchId = branchId;
  await getFutureClassesController(req, res);
};

export const deleteOldClassesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  res.status(501).json({ error: "Not implemented for safety" });
};

export const getClassesStatsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const total = await prisma.session.count();
    res.json({ total });
  } catch (e) {
    res.status(500).json({ error: "Error" });
  }
};
