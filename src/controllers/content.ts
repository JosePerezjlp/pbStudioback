import { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../config/prisma";
import { uploadToFirebaseStorage } from "../utils/firebaseStorage";

/* ─────────────────────────────
   Helpers
────────────────────────────── */

// Helper to get configuration by module
const getConfig = async (moduleName: string) => {
  const config = await prisma.configuration.findFirst({
    where: { module: moduleName },
  });
  return config;
};

// Helper to set configuration by module (create or update)
const setConfig = async (moduleName: string, data: any) => {
  const existing = await getConfig(moduleName);
  const dataStr = typeof data === "string" ? data : JSON.stringify(data);

  if (existing) {
    return await prisma.configuration.update({
      where: { id: existing.id },
      data: { data: dataStr },
    });
  } else {
    return await prisma.configuration.create({
      data: { module: moduleName, data: dataStr },
    });
  }
};

// 🔄 Función genérica para guardar contenido HTML
const updateContent = async (
  moduleName: string,
  html: string,
  res: Response
): Promise<void> => {
  try {
    if (!html || typeof html !== "string") {
      res.status(400).json({ error: "Se requiere contenido HTML válido" });
      return;
    }

    await setConfig(moduleName, { html, updatedAt: new Date().toISOString() });

    res
      .status(200)
      .json({ message: `Contenido '${moduleName}' actualizado correctamente` });
  } catch (error) {
    console.error(`Error al actualizar contenido '${moduleName}':`, error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// 🔄 Función genérica para obtener contenido HTML
const getContent = async (moduleName: string, res: Response): Promise<void> => {
  try {
    const config = await getConfig(moduleName);
    if (!config) {
      // Return empty or default if not found, or 404
      // Frontend expects { html: "..." }
      res
        .status(404)
        .json({ error: `Contenido '${moduleName}' no encontrado` });
      return;
    }

    // Try to parse if it's JSON, otherwise return as string wrapper
    let data;
    try {
      data = JSON.parse(config.data);
    } catch {
      data = { html: config.data };
    }

    res.status(200).json(data);
  } catch (error) {
    console.error(`Error al obtener contenido '${moduleName}':`, error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// HTML content controllers
export const updateWhoWeAreController = (req: Request, res: Response) =>
  updateContent("whoWeAre", req.body.html, res);

export const getWhoWeAreController = (_req: Request, res: Response) =>
  getContent("whoWeAre", res);

export const updateTermsController = (req: Request, res: Response) =>
  updateContent("termsAndConditions", req.body.html, res);

export const getTermsController = (_req: Request, res: Response) =>
  getContent("termsAndConditions", res);

export const updatePrivacyController = (req: Request, res: Response) =>
  updateContent("privacyNotice", req.body.html, res);

export const getPrivacyController = async (_req: Request, res: Response) => {
  try {
    const preferredIds = [
      "privacyNotice",
      "privacy",
      "avisoPrivacidad",
      "aviso_de_privacidad",
    ];

    // Try to find any of the preferred modules
    const configs = await prisma.configuration.findMany({
      where: { module: { in: preferredIds } },
    });

    if (configs.length > 0) {
      // Sort by preferred order if needed, but for now just take the first one found
      // or specific logic. The original code looped.
      // Let's just pick 'privacyNotice' if present, else first available.
      const match =
        configs.find((c) => c.module === "privacyNotice") || configs[0];
      try {
        res.status(200).json(JSON.parse(match.data));
      } catch {
        res.status(200).json({ html: match.data });
      }
      return;
    }

    res.status(404).json({ error: "Contenido 'privacyNotice' no encontrado" });
  } catch (error) {
    console.error("Error al obtener aviso de privacidad:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ✅ Subida de imágenes y contenido de inicio
export const updateHomeContent = [
  multer({ storage: multer.memoryStorage() }).fields([
    { name: "imageMain" },
    { name: "imageUp" },
    { name: "imageLeft" },
    { name: "imageRight" },
  ]),
  async (req: Request, res: Response) => {
    try {
      const {
        textBannerMain,
        textTitleLeft,
        textSubtitleLeft,
        textBtnLeft,
        textTitleRight,
        textSubtitleRight,
        textBtnRight,
      } = req.body;

      const images = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      // Get existing content
      const existingConfig = await getConfig("homeContent");
      let existingData: any = {};
      if (existingConfig) {
        try {
          existingData = JSON.parse(existingConfig.data);
        } catch {
          existingData = {};
        }
      }

      const imageUrls: Record<string, string> = {
        imageMain: existingData.imageMain || "",
        imageUp: existingData.imageUp || "",
        imageLeft: existingData.imageLeft || "",
        imageRight: existingData.imageRight || "",
      };

      await Promise.all(
        Object.keys(imageUrls).map(async (key) => {
          if (images[key]) {
            const file = images[key][0];
            const newUrl = await uploadToFirebaseStorage(file, "home");
            imageUrls[key] = newUrl;
          }
        })
      );

      const newData = {
        textBannerMain,
        textTitleLeft,
        textSubTitleLeft: textSubtitleLeft ?? "",
        textBtnLeft,
        textTitleRight,
        textSubTitleRight: textSubtitleRight ?? "",
        textBtnRight,
        ...imageUrls,
        updatedAt: new Date().toISOString(),
      };

      await setConfig("homeContent", newData);

      res.status(200).json({
        message: "Contenido actualizado",
        data: newData,
      });
    } catch (error) {
      console.error("Error al actualizar home content:", error);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
];

// Obtener contenido home
export const getHomeContent = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const config = await getConfig("homeContent");

    if (!config) {
      res.status(404).json({ error: "Contenido de inicio no encontrado" });
      return;
    }

    try {
      const data = JSON.parse(config.data);
      res.status(200).json(data);
    } catch {
      res.status(500).json({ error: "Error al procesar datos de inicio" });
    }
  } catch (error) {
    console.error("Error al obtener contenido de inicio:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};
