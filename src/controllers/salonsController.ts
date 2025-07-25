import { Request, Response } from "express";
import admin from "../config/firebase";

export const createClassroomController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      name,
      unavailableSpots,
      capacity,
      discipline,
      branch,
      isActive = true,
      type,
    } = req.body;

    const parsedUnavailableSpots = Number(unavailableSpots);
    const parsedCapacity = Number(capacity);

    if (Number.isNaN(parsedUnavailableSpots) || Number.isNaN(parsedCapacity)) {
      res.status(400).json({ error: "Los campos numéricos no son válidos" });
      return;
    }

    const ref = await admin.firestore().collection("classrooms").add({
      name,
      unavailableSpots: parsedUnavailableSpots,
      capacity: parsedCapacity,
      discipline,
      branch,
      isActive,
      type,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ message: "Salón creado correctamente", id: ref.id });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error al crear salón:", error.message);
      res.status(500).json({
        error: "Error al crear salón",
        details: error.message,
      });
    } else {
      console.error("Error al crear salón:", error);
      res.status(500).json({
        error: "Error al crear salón",
        details: String(error),
      });
    }
  }
};

export const getAllClassroomsController = async (
  _req: Request,
  res: Response
) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("classrooms")
      .orderBy("createdAt", "desc")
      .get();
    const classrooms = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ classrooms });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener salones", details: error });
  }
};

export const getClassroomByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classroomId } = req.params;
  try {
    const doc = await admin
      .firestore()
      .collection("classrooms")
      .doc(classroomId)
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener salón", details: error });
  }
};

export const updateClassroomController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classroomId } = req.params;
  try {
    const ref = admin.firestore().collection("classrooms").doc(classroomId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    const updateData = { ...req.body };

    if ("unavailableSpots" in updateData) {
      updateData.unavailableSpots = Number(updateData.unavailableSpots);
    }
    if ("capacity" in updateData) {
      updateData.capacity = Number(updateData.capacity);
    }

    await ref.update(updateData);

    res.status(200).json({ message: "Salón actualizado correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar salón", details: error });
  }
};

export const deleteClassroomController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classroomId } = req.params;
  try {
    const ref = admin.firestore().collection("classrooms").doc(classroomId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    await ref.delete();

    res.status(200).json({ message: "Salón eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar salón", details: error });
  }
};
