import { Request, Response } from "express";
import admin from "../config/firebase";

export const createDisciplineController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { name, description, enabled = true } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Nombre inválido o faltante" });
      return;
    }

    const newDiscipline = {
      name,
      description: description || "",
      enabled: Boolean(enabled),
      createdAt: new Date().toISOString(),
    };

    const ref = await admin
      .firestore()
      .collection("disciplines")
      .add(newDiscipline);

    res
      .status(201)
      .json({ message: "Disciplina creada correctamente", id: ref.id });
  } catch (error) {
    console.error("Error al crear disciplina:", error);
    res.status(500).json({ error: "Error al crear disciplina" });
  }
};

export const getAllDisciplinesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("disciplines")
      .orderBy("createdAt", "desc")
      .get();
    const disciplines = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ disciplines });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener disciplinas",
      details: error,
    });
  }
};

export const getDisciplineByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { disciplineId } = req.params;
  try {
    const doc = await admin
      .firestore()
      .collection("disciplines")
      .doc(disciplineId)
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "Disciplina no encontrada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener disciplina", details: error });
  }
};

export const updateDisciplineController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { disciplineId } = req.params;
  try {
    const ref = admin.firestore().collection("disciplines").doc(disciplineId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Disciplina no encontrada" });
      return;
    }

    const updateData: {
      name?: string;
      description?: string;
      enabled?: boolean;
    } = {};

    if (req.body.name) updateData.name = String(req.body.name);
    if (req.body.description)
      updateData.description = String(req.body.description);
    if ("enabled" in req.body) updateData.enabled = Boolean(req.body.enabled);

    await ref.update(updateData);

    res.status(200).json({ message: "Disciplina actualizada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar disciplina", details: error });
  }
};

export const deleteDisciplineController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { disciplineId } = req.params;
  try {
    const ref = admin.firestore().collection("disciplines").doc(disciplineId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Disciplina no encontrada" });
      return;
    }

    await ref.delete();
    res.status(200).json({ message: "Disciplina eliminada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar disciplina", details: error });
  }
};
