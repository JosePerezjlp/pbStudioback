// src/controllers/classroomController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";

interface Seat {
  id: string;
  x: number;
  y: number;
  reserved?: boolean;
}

interface ClassroomData {
  name: string;
  unavailableSpots: number;
  capacity: number;
  discipline: string;
  branch: string;
  isActive: boolean;
  type: string;
  seatsLayout?: Seat[];
  createdAt: string;
}

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
      seatsLayout,
    } = req.body as {
      name: string;
      unavailableSpots: string;
      capacity: string;
      discipline: string;
      branch: string;
      isActive?: boolean;
      type: string;
      seatsLayout?: string | Seat[];
    };

    const parsedUnavailableSpots = Number(unavailableSpots);
    const parsedCapacity = Number(capacity);
    if (Number.isNaN(parsedUnavailableSpots) || Number.isNaN(parsedCapacity)) {
      res.status(400).json({ error: "Los campos numéricos no son válidos" });
      return;
    }

    let seats: Seat[] | undefined;
    if (seatsLayout !== undefined) {
      seats =
        typeof seatsLayout === "string" ? JSON.parse(seatsLayout) : seatsLayout;
      if (!Array.isArray(seats) || seats.length > 20) {
        res.status(400).json({
          error: "La disposición de asientos admite máximo 20 puestos",
        });
        return;
      }
    }

    const payload: ClassroomData = {
      name,
      unavailableSpots: parsedUnavailableSpots,
      capacity: parsedCapacity,
      discipline,
      branch,
      isActive,
      type,
      createdAt: new Date().toISOString(),
    };
    if (seats) payload.seatsLayout = seats;

    const ref = await admin.firestore().collection("classrooms").add(payload);
    res.status(201).json({ message: "Salón creado correctamente", id: ref.id });
  } catch (err) {
    console.error("Error al crear salón:", err);
    const details = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Error al crear salón", details });
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
      ...(doc.data() as ClassroomData),
    }));
    res.status(200).json({ classrooms });
  } catch (err) {
    console.error("Error al obtener salones:", err);
    res
      .status(500)
      .json({ error: "Error al obtener salones", details: String(err) });
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

    res.status(200).json({ id: doc.id, ...(doc.data() as ClassroomData) });
  } catch (err) {
    console.error("Error al obtener salón:", err);
    res
      .status(500)
      .json({ error: "Error al obtener salón", details: String(err) });
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

    const body = req.body as Record<string, unknown>;
    const updateData: Partial<ClassroomData> = {};

    if (body.unavailableSpots !== undefined) {
      const n = Number(body.unavailableSpots);
      if (Number.isNaN(n)) {
        res
          .status(400)
          .json({ error: "unavailableSpots no es un número válido" });
        return;
      }
      updateData.unavailableSpots = n;
    }
    if (body.capacity !== undefined) {
      const n = Number(body.capacity);
      if (Number.isNaN(n)) {
        res.status(400).json({ error: "capacity no es un número válido" });
        return;
      }
      updateData.capacity = n;
    }
    if (body.name !== undefined) updateData.name = String(body.name);
    if (body.discipline !== undefined)
      updateData.discipline = String(body.discipline);
    if (body.branch !== undefined) updateData.branch = String(body.branch);
    if (body.isActive !== undefined)
      updateData.isActive = Boolean(body.isActive);
    if (body.type !== undefined) updateData.type = String(body.type);

    if (body.seatsLayout !== undefined) {
      const raw = body.seatsLayout;
      const seats: Seat[] =
        typeof raw === "string" ? JSON.parse(raw as string) : (raw as Seat[]);
      if (!Array.isArray(seats) || seats.length > 20) {
        res.status(400).json({
          error: "La disposición de asientos admite máximo 20 puestos",
        });
        return;
      }
      updateData.seatsLayout = seats;
    }

    await ref.update(updateData);
    res.status(200).json({ message: "Salón actualizado correctamente" });
  } catch (err) {
    console.error("Error al actualizar salón:", err);
    res
      .status(500)
      .json({ error: "Error al actualizar salón", details: String(err) });
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
  } catch (err) {
    console.error("Error al eliminar salón:", err);
    res
      .status(500)
      .json({ error: "Error al eliminar salón", details: String(err) });
  }
};
