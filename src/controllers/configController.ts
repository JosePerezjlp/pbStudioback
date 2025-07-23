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

// General

export const setGeneralSettingsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, package: pkg, header, footer } = req.body;

    if (!email || !pkg) {
      res.status(400).json({ error: "Email y paquete son obligatorios" });
      return;
    }

    await admin
      .firestore()
      .collection("configurations")
      .doc("general_settings")
      .set(
        {
          email,
          package: pkg,
          header,
          footer,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    res
      .status(200)
      .json({ message: "Configuración general guardada correctamente" });
  } catch (error) {
    console.error("Error al guardar configuración general:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const getGeneralSettingsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const doc = await admin
      .firestore()
      .collection("configurations")
      .doc("general_settings")
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "No hay configuración general guardada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener configuración general:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// statistics

// POST - Guarda o actualiza la fecha de estadísticas
export const setStatisticsConfigController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { startDate } = req.body;

    if (!startDate) {
      res.status(400).json({ error: "La fecha de inicio es requerida" });
      return;
    }

    await admin
      .firestore()
      .collection("configurations")
      .doc("statistics_settings")
      .set(
        {
          startDate,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    res.status(200).json({ message: "Configuración guardada correctamente" });
  } catch (error) {
    console.error("Error al guardar configuración de estadísticas:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// GET - Obtiene la fecha guardada
export const getStatisticsConfigController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const doc = await admin
      .firestore()
      .collection("configurations")
      .doc("statistics_settings")
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "No hay configuración de estadísticas guardada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener configuración de estadísticas:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};
