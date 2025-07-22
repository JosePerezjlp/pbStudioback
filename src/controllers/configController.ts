import { Request, Response } from "express";
import admin from "../config/firebase";

// Crea o reemplaza el tiempo de cancelación
export const setCancellationTimesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { individual, groups } = req.body;

    const parsedIndividual = Number(individual);
    const parsedGroups = Number(groups);

    if (Number.isNaN(parsedIndividual) || Number.isNaN(parsedGroups)) {
      res.status(400).json({ error: "Los valores deben ser numéricos" });
      return;
    }

    await admin
      .firestore()
      .collection("configurations")
      .doc("cancellation_times")
      .set(
        {
          individual: parsedIndividual,
          groups: parsedGroups,
          updatedAt: new Date().toISOString(),
        },
        { merge: true } // permite actualizar sin sobrescribir campos no incluidos
      );

    res.status(200).json({ message: "Configuración guardada correctamente" });
  } catch (error) {
    console.error("Error al guardar configuración:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// Obtiene el tiempo de cancelación
export const getCancellationTimesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const doc = await admin
      .firestore()
      .collection("configurations")
      .doc("cancellation_times")
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "No hay configuración guardada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener configuración:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};
