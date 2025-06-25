import { Request, Response } from "express";
import admin from "../config/firebase";

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

export const getAllClassesController = async (_req: Request, res: Response) => {
  try {
    const snapshot = await admin.firestore().collection("classes").get();
    const classes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ classes });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clases", details: error });
  }
};

export const getClassByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  try {
    const doc = await admin.firestore().collection("classes").doc(classId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clase", details: error });
  }
};

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

    await ref.update(updateData);
    res.status(200).json({ message: "Clase actualizada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar clase", details: error });
  }
};

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
