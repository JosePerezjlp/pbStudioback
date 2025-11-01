// src/controllers/classController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ClassType } from "../types/enums";
import { getRoomTypeById } from "../utils/getRoomType";
import { AuthRequest } from "../middleware/authMiddleware";

interface ClassDoc {
  day: string;
  hour: string;
  branch: string;
  room: string; // ID del salón
  discipline: string;
  instructor: string;
  info: string;
  capacity: number;
  occupied: number;
  status: "abierta" | "cerrada";
  createdAt?: string;
  updatedAt?: string;
  type?: ClassType; // enum estricto
}

const parseNumberOrFail = (value: unknown): number => {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error("INVALID_NUMBER");
  }
  return n;
};

const asStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/* ============================================================
   CREATE – crea clase usando type del salón (enum)
   ============================================================ */
export const createClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      day,
      hour,
      branch,
      room, // ID del salón
      discipline,
      instructor,
      info,
      capacity,
      occupied,
      status = "abierta",
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

    // Evitar duplicados (mismo día/hora/sede/salón)
    const conflictQuery = await admin
      .firestore()
      .collection("classes")
      .where("day", "==", day)
      .where("hour", "==", hour)
      .where("branch", "==", branch)
      .where("room", "==", room)
      .get();

    if (!conflictQuery.empty) {
      res.status(409).json({
        error: "Ya existe una clase programada en ese salón, sede y horario.",
        code: "CONFLICTING_CLASS",
      });
      return;
    }

    // Obtener tipo desde el salón, con fallback al enum
    const roomType =
      (await getRoomTypeById(String(room))) ?? ClassType.INDIVIDUAL;

    // Normalizar info como opcional (si viene undefined, null o string vacío, no se guarda o se guarda como "")
    const infoNormalized = info && typeof info === 'string' && info.trim() !== '' 
      ? info.trim() 
      : '';

    const classData: Record<string, unknown> = {
      day,
      hour,
      branch,
      room,
      discipline,
      instructor,
      capacity: parsedCapacity,
      occupied: parsedOccupied,
      status,
      type: roomType, // enum
      createdAt: new Date().toISOString(),
    };

    // Solo agregar info si tiene valor
    if (infoNormalized) {
      classData.info = infoNormalized;
    }

    const ref = await admin.firestore().collection("classes").add(classData);

    res.status(201).json({ message: "Clase creada correctamente", id: ref.id });
  } catch (error) {
    console.error("Error al crear clase:", error);
    res.status(500).json({
      error: "Error al crear clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/* ============================================================
   LIST – todas las clases
   ============================================================ */
export const getAllClassesController = async (req: Request | AuthRequest, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    let query = admin
      .firestore()
      .collection("classes")
      .orderBy("createdAt", "desc");

    // Si el usuario es employee (no admin) y tiene branches limitadas, filtrar
    let classes = [];
    if (user && user.role === "employee" && user.branches && user.branches.length > 0) {
      // Obtener todas y filtrar en memoria (Firestore no soporta "in" con orderBy fácilmente)
      const snapshot = await query.get();
      const allClasses = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      // Filtrar solo las clases de las branches permitidas
      classes = allClasses.filter((classItem: any) => 
        classItem.branch && user.branches!.includes(classItem.branch)
      );
    } else {
      // Admin o sin autenticación: devolver todas
      const snapshot = await query.get();
      classes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    }

    res.status(200).json({ classes });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener clases", details: String(error) });
  }
};

/* ============================================================
   GET ONE – clase por id
   ============================================================ */
export const getClassByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  try {
    const doc = await admin
      .firestore()
      .collection("classes")
      .doc(classId)
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener clase", details: String(error) });
  }
};

/* ============================================================
   UPDATE – recalcula type (enum) si cambia room/branch
   ============================================================ */
export const updateClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;

  try {
    const ref = admin.firestore().collection("classes").doc(classId);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    const current = snap.data() as ClassDoc | undefined;
    if (!current) {
      res.status(500).json({ error: "Documento de clase inválido" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updateData: Partial<ClassDoc> = {};

    // Strings
    const dayBody = asStringOrUndefined(body.day);
    const hourBody = asStringOrUndefined(body.hour);
    const branchBody = asStringOrUndefined(body.branch);
    const roomBody = asStringOrUndefined(body.room); // ID del salón
    const disciplineBody = asStringOrUndefined(body.discipline);
    const instructorBody = asStringOrUndefined(body.instructor);
    const infoBody = asStringOrUndefined(body.info);

    if (dayBody !== undefined) updateData.day = dayBody;
    if (hourBody !== undefined) updateData.hour = hourBody;
    if (branchBody !== undefined) updateData.branch = branchBody;
    if (roomBody !== undefined) updateData.room = roomBody;
    if (disciplineBody !== undefined) updateData.discipline = disciplineBody;
    if (instructorBody !== undefined) updateData.instructor = instructorBody;
    if (infoBody !== undefined) updateData.info = infoBody;

    // Status
    if (body.status === "abierta" || body.status === "cerrada") {
      updateData.status = body.status;
    }

    // Numéricos
    if (body.capacity !== undefined) {
      try {
        updateData.capacity = parseNumberOrFail(body.capacity);
      } catch {
        res.status(400).json({ error: "capacity no es un número válido" });
        return;
      }
    }
    if (body.occupied !== undefined) {
      try {
        updateData.occupied = parseNumberOrFail(body.occupied);
      } catch {
        res.status(400).json({ error: "occupied no es un número válido" });
        return;
      }
    }

    // ¿Cambian campos clave?
    const willChangeKeyFields =
      dayBody !== undefined ||
      hourBody !== undefined ||
      branchBody !== undefined ||
      roomBody !== undefined;

    const dayToCheck = updateData.day ?? current.day;
    const hourToCheck = updateData.hour ?? current.hour;
    const branchToUse = updateData.branch ?? current.branch;
    const roomToUse = updateData.room ?? current.room;

    if (willChangeKeyFields) {
      // Chequeo de conflicto
      const conflictQuery = await admin
        .firestore()
        .collection("classes")
        .where("day", "==", dayToCheck)
        .where("hour", "==", hourToCheck)
        .where("branch", "==", branchToUse)
        .where("room", "==", roomToUse)
        .get();

      const conflict = conflictQuery.docs.find((d) => d.id !== classId);
      if (conflict) {
        res.status(409).json({
          error: "Ya existe una clase programada en ese salón, sede y horario.",
          code: "CONFLICTING_CLASS",
        });
        return;
      }
    }

    // Si cambió room o branch, recalcular type desde el salón (enum)
    if (branchBody !== undefined || roomBody !== undefined) {
      const resolvedType =
        (await getRoomTypeById(roomToUse)) ??
        current.type ??
        ClassType.INDIVIDUAL;
      updateData.type = resolvedType;
    }

    // Ignoramos 'type' si viene del cliente (lo calculamos nosotros)
    if ("type" in body) {
      // noop
    }

    updateData.updatedAt = new Date().toISOString();

    await ref.update(updateData);
    res.status(200).json({ message: "Clase actualizada correctamente" });
  } catch (error) {
    console.error("Error al actualizar clase:", error);
    res.status(500).json({
      error: "Error al actualizar clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/* ============================================================
   DELETE – elimina clase
   ============================================================ */
export const deleteClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  try {
    const ref = admin.firestore().collection("classes").doc(classId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    await ref.delete();
    res.status(200).json({ message: "Clase eliminada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar clase", details: String(error) });
  }
};
