import { Request, Response } from "express";
import admin from "../config/firebase";

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
      room,
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

    // Verificar que no exista una clase con la misma sede, día, hora y salón
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

    const ref = await admin.firestore().collection("classes").add({
      day,
      hour,
      branch,
      room,
      discipline,
      instructor,
      info,
      capacity: parsedCapacity,
      occupied: parsedOccupied,
      status,
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
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    const updateData = { ...req.body };
    if ("capacity" in updateData) {
      updateData.capacity = Number(updateData.capacity);
    }
    if ("occupied" in updateData) {
      updateData.occupied = Number(updateData.occupied);
    }

    // Solo chequeamos conflicto si se va a modificar alguno de los campos clave
    if (
      updateData.day ||
      updateData.hour ||
      updateData.branch ||
      updateData.room
    ) {
      // Toma los nuevos valores, o los originales si no cambiaron
      const dayToCheck = updateData.day ?? doc.data()?.day;
      const hourToCheck = updateData.hour ?? doc.data()?.hour;
      const branchToCheck = updateData.branch ?? doc.data()?.branch;
      const roomToCheck = updateData.room ?? doc.data()?.room;

      // Busca clases distintas a esta, pero con mismos valores clave
      const conflictQuery = await admin
        .firestore()
        .collection("classes")
        .where("day", "==", dayToCheck)
        .where("hour", "==", hourToCheck)
        .where("branch", "==", branchToCheck)
        .where("room", "==", roomToCheck)
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

    await ref.update(updateData);
    res.status(200).json({ message: "Clase actualizada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar clase", details: error });
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
