import { Request, Response } from "express";
import multer from "multer";
import prisma from "../config/prisma";
import { uploadLocal, deleteLocalFile } from "../utils/uploadLocal";

// Helper to save configuration
const saveConfiguration = async (moduleName: string, data: any) => {
  const existing = await prisma.configuration.findFirst({
    where: { module: moduleName },
  });

  if (existing) {
    return prisma.configuration.update({
      where: { id: existing.id },
      data: { data: JSON.stringify(data) },
    });
  } else {
    return prisma.configuration.create({
      data: {
        module: moduleName,
        data: JSON.stringify(data),
      },
    });
  }
};

// Helper to get configuration
const getConfiguration = async (moduleName: string) => {
  const config = await prisma.configuration.findFirst({
    where: { module: moduleName },
  });

  if (!config) return null;
  return JSON.parse(config.data);
};

// Crea o reemplaza el tiempo de cancelación
export const setCancellationTimesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { individual, groups, changeIndividual, changeGroups } = req.body;

    const parsedIndividual = Number(individual);
    const parsedGroups = Number(groups);
    const parsedChangeIndividual = Number(changeIndividual);
    const parsedChangeGroups = Number(changeGroups);

    if (
      Number.isNaN(parsedIndividual) ||
      Number.isNaN(parsedGroups) ||
      Number.isNaN(parsedChangeIndividual) ||
      Number.isNaN(parsedChangeGroups)
    ) {
      res.status(400).json({ error: "Los valores deben ser numéricos" });
      return;
    }

    const configData: Record<string, number | string> = {
      individual: parsedIndividual,
      groups: parsedGroups,
      updatedAt: new Date().toISOString(),
    };

    // Agregar campos opcionales si están presentes
    if (!Number.isNaN(parsedChangeIndividual)) {
      configData.changeIndividual = parsedChangeIndividual;
    }
    if (!Number.isNaN(parsedChangeGroups)) {
      configData.changeGroups = parsedChangeGroups;
    }

    await saveConfiguration("cancellation_times", configData);

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
    const data = await getConfiguration("cancellation_times");

    if (!data) {
      res.status(404).json({ error: "No hay configuración guardada" });
      return;
    }

    res.status(200).json(data);
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

    await saveConfiguration("general_settings", {
      email,
      package: pkg,
      header,
      footer,
      updatedAt: new Date().toISOString(),
    });

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
    const data = await getConfiguration("general_settings");

    if (!data) {
      res.status(404).json({ error: "No hay configuración general guardada" });
      return;
    }

    res.status(200).json(data);
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

    await saveConfiguration("statistics_settings", {
      startDate,
      updatedAt: new Date().toISOString(),
    });

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
    const data = await getConfiguration("statistics_settings");

    if (!data) {
      res
        .status(404)
        .json({ error: "No hay configuración de estadísticas guardada" });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Error al obtener configuración de estadísticas:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// notice

// Middleware de subida de imagen
export const uploadNoticeMiddleware = multer({
  storage: multer.memoryStorage(),
}).single("image");

// POST: guarda o reemplaza aviso
export const setNoticeConfigController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { url, active } = req.body;

    const existingData = (await getConfiguration("notice")) || {};
    const oldImageUrl = existingData.image || "";

    let newImageUrl = oldImageUrl;

    // Si hay nueva imagen, la subimos
    if (req.file) {
      newImageUrl = await uploadLocal(req.file, "notices");

      // si la imagen anterior existe y es distinta, la borramos
      if (oldImageUrl && oldImageUrl !== newImageUrl) {
        await deleteLocalFile(oldImageUrl);
      }
    }

    const newData = {
      image: newImageUrl,
      url,
      active: active === "true" || active === true,
      updatedAt: new Date().toISOString(),
    };

    await saveConfiguration("notice", newData);

    res.status(200).json({
      message: "Aviso guardado correctamente",
      data: newData,
    });
  } catch (error) {
    console.error("Error al guardar aviso:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// GET: obtiene aviso actual
export const getNoticeConfigController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const data = await getConfiguration("notice");

    if (!data) {
      res.status(404).json({ error: "No hay aviso configurado" });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Error al obtener aviso:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};
