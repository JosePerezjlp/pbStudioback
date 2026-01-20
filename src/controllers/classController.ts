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
import { ClassRequest } from "../models/ClassRequest";
import { ClassPayload } from "../models/ClassPayload";
import { Prisma } from "../generated/prisma/client";

// Estados de la sesión (clase)
const SESSION_STATUS = {
  CLOSED: 0, // cerrada
  OPEN: 1, // abierta
  CANCELED: 2, // cancelada
  DELETED: 3, // borrado lógico / oculto
} as const;

type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

const mapSessionStatusToLabel = (
  status: number,
): "abierta" | "cerrada" | "cancelada" => {
  if (status === SESSION_STATUS.OPEN) return "abierta";
  if (status === SESSION_STATUS.CANCELED) return "cancelada";
  // Consideramos cualquier otro valor como "cerrada" (incluye 0 y legacy)
  return "cerrada";
};

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

// Helper para convertir string HH:mm a Date fijo en UTC (1970-01-01 HH:mm:00)
// Esto evita que el timezone local mueva la hora al guardar/leer @db.Time(0) en MySQL.
const timeStringToDate = (timeStr: string): Date => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  // Crear directamente en UTC sin tocar hora local
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
};

/* ============================================================
   CREATE – crea clase usando type del salón (enum)
   ============================================================ */
export const createClassController = async (
  req: Request,
  res: Response,
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

    // Números válidos (permitimos omitir y luego usamos la capacidad del salón)
    let parsedCapacity: number | null = null;
    let parsedOccupied = 0;

    try {
      if (capacity !== undefined && capacity !== null && capacity !== "") {
        parsedCapacity = parseNumberOrFail(capacity);
      }

      if (occupied !== undefined && occupied !== null && occupied !== "") {
        parsedOccupied = parseNumberOrFail(occupied);
      }
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

    // El campo gympass puede ser booleano (true/false) o un objeto con más config.
    // Cualquier valor truthy activará la publicación en Wellhub más adelante.

    // Obtener tipo desde el salón
    const roomRecord = await prisma.exerciseRoom.findUnique({
      where: { id: roomId },
    });
    if (!roomRecord) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    // IMPORTANTE: respetar el formato original de MySQL
    // session.type debe guardar exactamente el mismo valor que ya existe
    // en la tabla (por ejemplo 'g' / 'i'), no el enum "groups"/"individual".
    // Para lógica de negocio usamos normalizeClassType al leer.
    const sessionType = roomRecord.type;

    // Capacidad efectiva: si no se envía o viene en 0/negativa, usamos la del salón
    const effectiveCapacity =
      parsedCapacity !== null && parsedCapacity > 0
        ? parsedCapacity
        : roomRecord.capacity;

    const effectiveOccupied = parsedOccupied || 0;

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

    // Nuevos estados:
    // 0 = cerrada, 1 = abierta, 2 = cancelada, 3 = borrada (oculta)
    // En creación normal solo usamos 0/1; 2 y 3 se usan para cancelación/borrado lógico.
    const statusInt: SessionStatus =
      normalizedStatusStr === "abierta"
        ? SESSION_STATUS.OPEN
        : SESSION_STATUS.CLOSED;

    // Crear sesión
    const newSession = await prisma.session.create({
      data: {
        dateStart,
        timeStart,
        branchOfficeId: branchId,
        exerciseRoomId: roomId,
        disciplineId: disciplineId,
        instructorId: instructorId,
        exerciseRoomCapacity: effectiveCapacity,
        availableCapacity: Math.max(effectiveCapacity - effectiveOccupied, 0),
        status: statusInt,
        type: sessionType,
        information: infoNormalized,
        placesNotAvailable: "[]", // Default empty array
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Gympass / Wellhub integration (no bloquea la creación local)
    let wellhubStatus: {
      success: boolean;
      error?: string;
      data?: unknown;
    } | null = null;

    if (gympassEnabled) {
      try {
        const gympassGymId = 198; // ID del gym en Wellhub
        const gympassProductId = 395; // ID del producto en Wellhub

        const slot = new CreateSlotRequest();
        slot.occur_date = `${day}T${hour}:00`;
        slot.room = String(room);
        slot.total_capacity = parsedCapacity;
        slot.total_booked = parsedOccupied;
        slot.status = statusInt;
        slot.length_in_minutes = 60;
        slot.instructors = [];
        slot.product_id = gympassProductId;
        slot.booking_window = null;

        const apiResponse = await GympassService.createClass(
          gympassGymId,
          5,
          slot,
        );

        wellhubStatus = {
          success: true,
          data: apiResponse,
        };
      } catch (error) {
        console.error("Error creating Gympass/Wellhub slot:", error);
        wellhubStatus = {
          success: false,
          error:
            error instanceof Error ? error.message : String(error ?? "Error"),
        };
      }
    }

    res.status(201).json({
      message: "Clase creada correctamente",
      id: newSession.id,
      wellhub: gympassEnabled
        ? (wellhubStatus ?? { success: false, error: "Estado desconocido" })
        : { success: false, error: "Integración Wellhub desactivada" },
    });
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
  res: Response,
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
      req.query.onlyAvailable ?? "true",
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
      status: SESSION_STATUS.OPEN, // Solo clases abiertas
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
        reservations: {
          where: {
            cancellationAt: null, // Solo reservaciones activas
          },
          select: {
            id: true,
            placeNumber: true,
            userId: true,
            attended: true,
            user: {
              select: {
                id: true,
                name: true,
                lastname: true,
                email: true,
              },
            },
          },
        },
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
        status: mapSessionStatusToLabel(session.status),
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

        // Reservaciones con detalle de usuarios y posiciones
        reservations:
          session.reservations?.map((r) => ({
            id: r.id,
            placeNumber: r.placeNumber,
            attended: r.attended,
            user: {
              id: r.user?.id,
              name: r.user?.name,
              lastname: r.user?.lastname,
              email: r.user?.email,
            },
          })) || [],
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
  res: Response,
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

    const where: Prisma.SessionWhereInput = {
      // Ocultar clases borradas lógicamente
      status: { not: SESSION_STATUS.DELETED },
    };

    if (branchId && !isNaN(Number(branchId)))
      where.branchOfficeId = Number(branchId);
    if (instructorId && !isNaN(Number(instructorId)))
      where.instructorId = Number(instructorId);
    if (statusParam) {
      if (statusParam === "abierta") where.status = SESSION_STATUS.OPEN;
      else if (statusParam === "cerrada") where.status = SESSION_STATUS.CLOSED;
      else if (statusParam === "cancelada")
        where.status = SESSION_STATUS.CANCELED;
      else {
        const n = Number(statusParam);
        if (!Number.isNaN(n)) {
          // Permitir filtrar directamente por código 0/1/2/3
          where.status = n as SessionStatus;
        }
      }
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
        // Reservaciones activas con detalle de usuario y asiento
        reservations: {
          where: {
            cancellationAt: null,
          },
          select: {
            id: true,
            placeNumber: true,
            attended: true,
            userId: true,
            user: {
              select: {
                id: true,
                name: true,
                lastname: true,
                email: true,
              },
            },
          },
        },
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
      // Importante: devolver status numérico (0,1,2,3) para el frontend
      status: session.status,
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

      // Información completa del salón (incluye layout de asientos)
      exerciseRoom: session.exerciseRoom,
      // Lugares marcados como no disponibles para esta sesión
      placesNotAvailable: session.placesNotAvailable,
      // Reservas activas con sus asientos y datos básicos del usuario
      reservations:
        session.reservations?.map((r) => ({
          id: r.id,
          placeNumber: r.placeNumber,
          attended: r.attended,
          userId: r.userId,
          user: r.user
            ? {
                id: r.user.id,
                name: r.user.name,
                lastname: r.user.lastname,
                email: r.user.email,
              }
            : null,
        })) || [],
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
  res: Response,
): Promise<void> => {
  const { id, classId } = req.params;
  const idToUse = id || classId; // Acepta ambos nombres de parámetro
  const sessionId = parseInt(idToUse, 10);

  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID de clase inválido" });
    return;
  }

  try {
    // Borrado lógico: marcamos status=3 (DELETED) y actualizamos updatedAt
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: SESSION_STATUS.DELETED,
        updatedAt: new Date(),
      },
    });

    res.json({ message: "Clase eliminada (borrado lógico)" });
  } catch (e) {
    console.error("Error eliminando clase:", e);
    res.status(500).json({
      error: "Error eliminando clase",
      details: e instanceof Error ? e.message : String(e),
    });
  }
};

export const getClassByIdController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id, classId } = req.params;
  const idToUse = id || classId; // Acepta ambos nombres de parámetro
  console.log("📋 getClassById - ID recibido:", idToUse, typeof idToUse);

  const sessionId = parseInt(idToUse, 10);
  console.log(
    "📋 getClassById - ID parseado:",
    sessionId,
    "isNaN:",
    isNaN(sessionId),
  );

  if (isNaN(sessionId)) {
    res
      .status(400)
      .json({ error: "ID de clase inválido", receivedId: idToUse });
    return;
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        discipline: true,
        exerciseRoom: true,
        instructor: {
          include: {
            profile: true,
          },
        },
        branchOffice: true,
        // Importante para backend: incluir reservaciones activas
        reservations: {
          where: {
            cancellationAt: null,
          },
          select: {
            id: true,
            userId: true,
            placeNumber: true,
            attended: true,
            user: {
              select: {
                id: true,
                name: true,
                lastname: true,
                email: true,
              },
            },
          },
        },
      },
    });
    if (!session) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }
    // Aseguramos que en el objeto instructor se incluya firstName
    const rawInstructor: any = session.instructor || null;
    const { profile, ...restInstructor } = rawInstructor || {};

    const instructorWithFirstName =
      rawInstructor != null
        ? {
            ...restInstructor,
            firstName: profile?.firstname ?? null,
          }
        : null;

    const responsePayload: any = {
      ...session,
      instructor: instructorWithFirstName,
    };

    res.json(responsePayload);
  } catch (e) {
    console.error("Error obteniendo clase:", e);
    res.status(500).json({
      error: "Error obteniendo clase",
      details: e instanceof Error ? e.message : String(e),
    });
  }
};

export const updateClassController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id, classId } = req.params;
  const idToUse = id || classId; // Acepta ambos nombres de parámetro

  // Validar que el ID es válido
  const sessionId = parseInt(idToUse, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID de clase inválido" });
    return;
  }

  try {
    const {
      day,
      hour,
      branch,
      room,
      discipline,
      instructor,
      info,
      capacity,
      occupied,
      status,
      enabled,
    } = req.body;

    // Preparar datos para actualizar
    const updateData: any = {};

    // Campos opcionales que se pueden actualizar
    if (day !== undefined) {
      updateData.dateStart = new Date(day);
    }

    if (hour !== undefined) {
      const [hours, minutes] = hour.split(":").map(Number);
      const timeDate = new Date();
      timeDate.setFullYear(1970, 0, 1);
      timeDate.setHours(hours, minutes, 0, 0);
      updateData.timeStart = timeDate;
    }

    if (branch !== undefined) updateData.branchOfficeId = Number(branch);
    if (room !== undefined) updateData.exerciseRoomId = Number(room);
    if (discipline !== undefined) updateData.disciplineId = Number(discipline);
    if (instructor !== undefined) updateData.instructorId = Number(instructor);
    if (info !== undefined) updateData.information = info;

    // Capacidad y lugares disponibles: misma filosofía que en createClassController
    // Si se envía capacity/occupied, actualizamos exerciseRoomCapacity y recalculamos availableCapacity
    // Siempre respetando que availableCapacity = capacidad - ocupados (o 0 mínimo)
    if (capacity !== undefined || occupied !== undefined) {
      const current = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (!current) {
        res.status(404).json({ error: "Clase no encontrada" });
        return;
      }

      // Capacidad base del salón (por si la sesión actual tiene 0)
      const roomIdForCapacity =
        (room !== undefined && Number(room)) ||
        current.exerciseRoomId ||
        undefined;

      let roomCapacityFallback: number | null = null;
      if (roomIdForCapacity) {
        const roomRecord = await prisma.exerciseRoom.findUnique({
          where: { id: Number(roomIdForCapacity) },
        });
        roomCapacityFallback = roomRecord?.capacity ?? null;
      }

      const rawCapacity =
        capacity !== undefined && capacity !== "" ? Number(capacity) : null;

      const newCapacity =
        rawCapacity !== null && rawCapacity > 0
          ? rawCapacity
          : current.exerciseRoomCapacity > 0
            ? current.exerciseRoomCapacity
            : (roomCapacityFallback ?? current.exerciseRoomCapacity);

      const rawOccupied =
        occupied !== undefined && occupied !== "" ? Number(occupied) : null;

      const newOccupied =
        rawOccupied !== null && rawOccupied >= 0
          ? rawOccupied
          : newCapacity - current.availableCapacity;

      updateData.exerciseRoomCapacity = newCapacity;
      updateData.availableCapacity = Math.max(newCapacity - newOccupied, 0);
    }
    if (status !== undefined) {
      // Acepta "abierta" | "cerrada" | "cancelada" o valores numéricos 0/1/2/3
      if (status === "abierta") updateData.status = SESSION_STATUS.OPEN;
      else if (status === "cerrada") updateData.status = SESSION_STATUS.CLOSED;
      else if (status === "cancelada")
        updateData.status = SESSION_STATUS.CANCELED;
      else {
        const n = Number(status);
        if (!Number.isNaN(n)) updateData.status = n as SessionStatus;
      }
    }

    updateData.updatedAt = new Date();

    await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
    });

    res.json({ message: "Clase actualizada" });
  } catch (e) {
    console.error("Error actualizando clase:", e);
    res.status(500).json({
      error: "Error actualizando clase",
      details: e instanceof Error ? e.message : String(e),
    });
  }
};

export const createClassesBulkController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      branchId: branchIdRaw,
      day,
      slots,
    } = req.body as {
      branchId?: unknown;
      day?: unknown;
      slots?: any;
    };

    const branchId = Number(branchIdRaw);
    if (!branchId || Number.isNaN(branchId)) {
      res.status(400).json({
        error: "Parámetro 'branchId' inválido",
      });
      return;
    }

    if (!day || typeof day !== "string") {
      res.status(400).json({
        error: "Parámetro 'day' es requerido",
      });
      return;
    }

    if (!Array.isArray(slots) || slots.length === 0) {
      res.status(400).json({
        error: "Parámetro 'slots' debe ser un arreglo no vacío",
      });
      return;
    }

    const dateStart = new Date(day);
    if (Number.isNaN(dateStart.getTime())) {
      res.status(400).json({
        error: "Parámetro 'day' inválido",
      });
      return;
    }

    const created: number[] = [];
    const updated: number[] = [];

    for (const rawSlot of slots) {
      try {
        const slot = rawSlot || {};

        // Saltar slots desactivados explícitamente
        if (slot.isActive === false) continue;

        const roomId = Number(slot.roomId);
        const disciplineId = Number(slot.disciplineId);
        const instructorId = Number(slot.instructorId);
        const classIdRaw = slot.id ?? slot.sessionId;
        const classId =
          classIdRaw !== undefined && classIdRaw !== null
            ? Number(classIdRaw)
            : NaN;
        const capacityRaw = slot.capacity;
        const occupiedRaw = slot.occupied;
        const hour = String(slot.hour || "");
        const info = slot.info as string | undefined;

        if (!roomId || !disciplineId || !instructorId || !hour) {
          res.status(400).json({
            error:
              "Datos inválidos en uno de los slots (roomId, disciplineId, instructorId, hour)",
            created,
          });
          return;
        }

        const timeStart = timeStringToDate(hour);

        // Verificar salón
        const roomRecord = await prisma.exerciseRoom.findUnique({
          where: { id: roomId },
        });

        if (!roomRecord) {
          res.status(404).json({
            error: `Salón no encontrado para roomId=${roomId}`,
            created,
          });
          return;
        }

        // Capacidad y ocupación efectivas
        let parsedCapacity: number | null = null;
        let parsedOccupied = 0;

        if (
          capacityRaw !== undefined &&
          capacityRaw !== null &&
          capacityRaw !== ""
        ) {
          const n = Number(capacityRaw);
          if (!Number.isNaN(n)) parsedCapacity = n;
        }

        if (
          occupiedRaw !== undefined &&
          occupiedRaw !== null &&
          occupiedRaw !== ""
        ) {
          const n = Number(occupiedRaw);
          if (!Number.isNaN(n)) parsedOccupied = n;
        }

        const effectiveCapacity =
          parsedCapacity !== null && parsedCapacity > 0
            ? parsedCapacity
            : roomRecord.capacity;

        const effectiveOccupied = parsedOccupied || 0;

        const infoNormalized =
          info && typeof info === "string" && info.trim() !== ""
            ? info.trim()
            : null;

        const normalizedStatusStr =
          slot.isActive === false ? "cerrada" : "abierta";
        const statusInt = normalizedStatusStr === "abierta" ? 1 : 0;

        // Si el slot trae id/sessionId, interpretamos que es una EDICIÓN
        // de una clase existente en lugar de crear una nueva.
        if (!Number.isNaN(classId) && classId > 0) {
          const existing = await prisma.session.findUnique({
            where: { id: classId },
          });

          if (!existing) {
            // Si no existe, caemos al flujo de creación normal.
          } else {
            const updatedSession = await prisma.session.update({
              where: { id: classId },
              data: {
                dateStart,
                timeStart,
                branchOfficeId: branchId,
                exerciseRoomId: roomId,
                disciplineId,
                instructorId,
                exerciseRoomCapacity: effectiveCapacity,
                availableCapacity: Math.max(
                  effectiveCapacity - effectiveOccupied,
                  0,
                ),
                status: statusInt,
                type: roomRecord.type,
                information: infoNormalized,
                updatedAt: new Date(),
              },
            });

            updated.push(updatedSession.id);
            continue;
          }
        }

        // Creación de nueva clase: evitar duplicados exactos por día/hora/sede/salón
        const conflict = await prisma.session.findFirst({
          where: {
            dateStart,
            branchOfficeId: branchId,
            exerciseRoomId: roomId,
          },
        });

        if (conflict) {
          const conflictTime = conflict.timeStart.toISOString().slice(11, 16);
          const reqTime = hour.slice(0, 5);
          if (conflictTime === reqTime) {
            res.status(409).json({
              error:
                "Ya existe una clase programada en ese salón, sede y horario.",
              code: "CONFLICTING_CLASS",
              created,
              updated,
            });
            return;
          }
        }

        const newSession = await prisma.session.create({
          data: {
            dateStart,
            timeStart,
            branchOfficeId: branchId,
            exerciseRoomId: roomId,
            disciplineId,
            instructorId,
            exerciseRoomCapacity: effectiveCapacity,
            availableCapacity: Math.max(
              effectiveCapacity - effectiveOccupied,
              0,
            ),
            status: statusInt,
            type: roomRecord.type,
            information: infoNormalized,
            placesNotAvailable: "[]",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        created.push(newSession.id);
      } catch (innerErr) {
        console.error("Error creando clase en bulk:", innerErr);
        res.status(500).json({
          error: "Error al crear clases en bulk",
          details:
            innerErr instanceof Error ? innerErr.message : String(innerErr),
          created,
        });
        return;
      }
    }

    res.status(201).json({
      message: "Clases creadas correctamente",
      created,
      updated,
    });
  } catch (error) {
    console.error("Error en createClassesBulkController:", error);
    res.status(500).json({
      error: "Error interno al crear clases en bulk",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getOpenClassesPublicController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  req.query.status = "abierta";
  req.query.onlyAvailable = "true";
  await getFutureClassesController(req, res);
};

export const getAvailableClassesByBranchController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { branchId } = req.params;
  req.query.branchId = branchId;
  await getFutureClassesController(req, res);
};

export const deleteOldClassesController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.status(501).json({ error: "Not implemented for safety" });
};

// Lista reservaciones realizadas con paquetes ilimitados en un rango de fechas
export const getAllUnlimitedClassesController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    if (!startDate || !endDate) {
      res.status(400).json({
        error: "Parámetros startDate y endDate son obligatorios",
      });
      return;
    }

    const start = DateTime.fromISO(String(startDate)).startOf("day");
    const end = DateTime.fromISO(String(endDate)).endOf("day");

    if (!start.isValid || !end.isValid) {
      res.status(400).json({ error: "Fechas inválidas" });
      return;
    }

    const sessions = await prisma.session.findMany({
      where: {
        dateStart: {
          gte: start.toJSDate(),
          lte: end.toJSDate(),
        },
        // Excluir clases borradas lógicamente
        status: { not: SESSION_STATUS.DELETED },
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
          where: { cancellationAt: null },
        },
      },
      orderBy: {
        dateStart: "asc",
      },
    });

    const classes = sessions.map((s) => ({
      id: s.id,
      date: s.dateStart,
      time: s.timeStart,
      branchOfficeId: s.branchOfficeId,
      disciplineId: s.disciplineId,
      roomId: s.exerciseRoomId,
      instructorId: s.instructorId,
      capacity: s.exerciseRoomCapacity,
      reservationsCount: s.reservations.length,
      status: s.status,
      disciplineName: s.discipline?.name ?? null,
      roomName: s.exerciseRoom?.name ?? null,
      branchName: s.branchOffice?.name ?? null,
      instructorName:
        s.instructor?.profile?.firstname || s.instructor?.username || null,
    }));

    res.status(200).json({ classes });
  } catch (error) {
    console.error("Error al obtener clases ilimitadas:", error);
    res.status(500).json({
      error: "Error al obtener clases ilimitadas",
      details: String(error),
    });
  }
};

export const getClassesStatsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // Contar solo clases no borradas lógicamente
    const total = await prisma.session.count({
      where: { status: { not: SESSION_STATUS.DELETED } },
    });
    res.json({ total });
  } catch (e) {
    res.status(500).json({ error: "Error" });
  }
};

export const getClassesByDayController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { day, branchId } = req.query;

    if (!day) {
      res.status(400).json({ error: "El parámetro 'day' es requerido" });
      return;
    }

    const where: Prisma.SessionWhereInput = {
      dateStart: new Date(day as string),
      // Ocultar clases borradas lógicamente
      status: { not: SESSION_STATUS.DELETED },
    };

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
      orderBy: [{ timeStart: "asc" }],
    });

    const formattedSessions = sessions.map((s) => ({
      id: String(s.id),
      day: s.dateStart.toISOString().split("T")[0],
      hour: s.timeStart.toISOString().slice(11, 16),
      discipline: s.discipline?.name || "",
      disciplineId: String(s.disciplineId),
      instructor: s.instructor
        ? `${s.instructor.profile?.firstname || ""} ${s.instructor.profile?.paternalSurname || ""}`.trim()
        : "",
      instructorId: String(s.instructorId),
      branch: s.branchOffice?.name || "",
      branchId: String(s.branchOfficeId),
      room: s.exerciseRoom?.name || "",
      roomId: String(s.exerciseRoomId),
      info: s.information || "",
      capacity: s.exerciseRoomCapacity || 0,
      occupied: s.exerciseRoomCapacity - s.availableCapacity,
      status: mapSessionStatusToLabel(s.status),
      gympass: !!s.gympassSlotId,
      type: s.type,
    }));

    res.json(formattedSessions);
  } catch (e) {
    console.error("Error en getClassesByDayController:", e);
    res.status(500).json({ error: "Error al obtener clases por día" });
  }
};
