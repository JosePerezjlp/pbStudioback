import { Request, Response } from "express";
import admin from "../config/firebase";
import {getRoomTypeById } from "../utils/getRoomType";

type ClassType = "groups" | "individual";

interface ClassDoc {
  day: string;
  hour: string;
  branch: string;
  room: string;
  discipline: string;
  instructor: string;
  info: string;
  capacity: number;
  occupied: number;
  status: "abierta" | "cerrada";
  createdAt?: string;
  type?: ClassType;
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

// CREA UNA CLASE, VERIFICANDO DUPLICADOS
export const createClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      day,
      hour,
      branch,
      room,         // ← ID del salón
      discipline,
      instructor,
      info,
      capacity,
      occupied,
      status = "abierta",
    } = req.body;

    const parsedCapacity = Number(capacity);
    const parsedOccupied = Number(occupied);
    if (Number.isNaN(parsedCapacity) || Number.isNaN(parsedOccupied)) {
      res.status(400).json({ error: "Los campos numéricos no son válidos" });
      return;
    }

    // Evitar duplicados
    const conflictQuery = await admin
      .firestore()
      .collection("classes")
      .where("day", "==", day)
      .where("hour", "==", hour)
      .where("branch", "==", branch)
      .where("room", "==", room) // ← seguimos guardando el ID
      .get();

    if (!conflictQuery.empty) {
      res.status(409).json({
        error: "Ya existe una clase programada en ese salón, sede y horario.",
        code: "CONFLICTING_CLASS",
      });
      return;
    }

    // Obtener type desde el salón por ID
    const roomType = (await getRoomTypeById(String(room))) ?? "individual";

    const ref = await admin.firestore().collection("classes").add({
      day,
      hour,
      branch,
      room, // id del salón
      discipline,
      instructor,
      info,
      capacity: parsedCapacity,
      occupied: parsedOccupied,
      status,
      type: roomType, // ← se guarda el tipo
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ message: "Clase creada correctamente", id: ref.id });
  } catch (error) {
    console.error("Error al crear clase:", error);
    res.status(500).json({
      error: "Error al crear clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

// LISTA TODAS LAS CLASES
export const getAllClassesController = async (_req: Request, res: Response) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("classes")
      .orderBy("createdAt", "desc")
      .get();
    const classes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ classes });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clases", details: error });
  }
};

// OBTIENE UNA CLASE POR ID
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
    res.status(500).json({ error: "Error al obtener clase", details: error });
  }
};

// ACTUALIZA UNA CLASE, VERIFICANDO DUPLICADOS
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
    const roomToUse = updateData.room ?? current.room; // ID del salón

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

    // Si cambió room o branch, recalcular type desde el salón por ID
    if (branchBody !== undefined || roomBody !== undefined) {
      const resolvedType =
        (await getRoomTypeById(roomToUse)) ??
        current.type ??
        "individual";
      updateData.type = resolvedType;
    }

    // Ignoramos 'type' si viene del cliente: lo calculamos nosotros
    if ("type" in body) {
      // no hacemos nada; simplemente no lo copiamos a updateData
    }

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

// ELIMINA UNA CLASE
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
    res.status(500).json({ error: "Error al eliminar clase", details: error });
  }
};
