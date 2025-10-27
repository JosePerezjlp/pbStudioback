import { Request, Response } from "express";
import multer from "multer";
import admin from "../config/firebase";
import { uploadToFirebase } from "../utils/uploadToFirebase";

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

    await admin
      .firestore()
      .collection("configurations")
      .doc("cancellation_times")
      .set(configData, { merge: true });

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
      res
        .status(404)
        .json({ error: "No hay configuración de estadísticas guardada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener configuración de estadísticas:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// notice

const bucket = admin.storage().bucket();

const deleteFromFirebase = async (url: string) => {
  try {
    const storageDomain = "https://storage.googleapis.com/";
    const filePath = url.replace(`${storageDomain}${bucket.name}/`, "");
    await bucket.file(filePath).delete();
    console.log("✅ Imagen eliminada:", filePath);
  } catch (error) {
    console.warn("⚠️ No se pudo eliminar la imagen:", url, error);
  }
};

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

    const docRef = admin.firestore().collection("configurations").doc("notice");

    const existingDoc = await docRef.get();
    const existingData = existingDoc.exists ? existingDoc.data() || {} : {};
    const oldImageUrl = existingData.image || "";

    let newImageUrl = oldImageUrl;

    // Si hay nueva imagen, la subimos
    if (req.file) {
      newImageUrl = await uploadToFirebase(req.file, "notices");

      // si la imagen anterior existe y es distinta, la borramos
      if (oldImageUrl && oldImageUrl !== newImageUrl) {
        await deleteFromFirebase(oldImageUrl);
      }
    }

    await docRef.set(
      {
        image: newImageUrl,
        url,
        active: active === "true" || active === true,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(200).json({
      message: "Aviso guardado correctamente",
      data: {
        image: newImageUrl,
        url,
        active: active === "true" || active === true,
      },
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
    const doc = await admin
      .firestore()
      .collection("configurations")
      .doc("notice")
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "No hay aviso configurado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener aviso:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};
