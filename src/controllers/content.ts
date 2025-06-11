import { Request, Response } from "express";
import multer from "multer";
import admin from "../config/firebase";
import { uploadToFirebase } from "../utils/uploadToFirebase";

// ✅ Función para eliminar una imagen de Firebase Storage
const deleteFromFirebase = async (url: string) => {
  try {
    const bucket = admin.storage().bucket();

    const storageDomain = "https://storage.googleapis.com/";
    const pathStart = `${bucket.name}/`;

    if (!url.startsWith(storageDomain + pathStart)) {
      console.warn("⚠️ URL no pertenece al bucket esperado:", url);
      return;
    }

    const filePath = url.replace(storageDomain + pathStart, "");
    await bucket.file(filePath).delete();

    console.log("✅ Imagen eliminada:", filePath);
  } catch (error) {
    console.warn("⚠️ No se pudo eliminar la imagen:", url, error);
  }
};


// 🔄 Función genérica para guardar contenido HTML
const updateContent = async (
  docId: string,
  html: string,
  res: Response
): Promise<void> => {
  try {
    if (!html || typeof html !== "string") {
      res.status(400).json({ error: "Se requiere contenido HTML válido" });
      return;
    }

    const contentRef = admin.firestore().collection("content").doc(docId);

    await contentRef.set(
      {
        html,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res
      .status(200)
      .json({ message: `Contenido '${docId}' actualizado correctamente` });
  } catch (error) {
    console.error(`Error al actualizar contenido '${docId}':`, error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// 🔄 Función genérica para obtener contenido HTML
const getContent = async (docId: string, res: Response): Promise<void> => {
  try {
    const doc = await admin.firestore().collection("content").doc(docId).get();
    if (!doc.exists) {
      res.status(404).json({ error: `Contenido '${docId}' no encontrado` });
      return;
    }

    res.status(200).json(doc.data());
  } catch (error) {
    console.error(`Error al obtener contenido '${docId}':`, error);
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

export const getPrivacyController = (_req: Request, res: Response) =>
  getContent("privacyNotice", res);

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
        textSubtitleLeft, // ✅ corregido
        textBtnLeft,
        textTitleRight,
        textSubtitleRight, // ✅ corregido
        textBtnRight,
      } = req.body;

      const images = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      const contentRef = admin.firestore().collection("homeContent").doc("main");
      const existingDoc = await contentRef.get();
      const existingData = existingDoc.exists ? existingDoc.data() || {} : {};

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
            const newUrl = await uploadToFirebase(file);

            const oldUrl = imageUrls[key];
            if (oldUrl && oldUrl !== newUrl) {
              await deleteFromFirebase(oldUrl);
            }

            imageUrls[key] = newUrl;
          }
        })
      );

      await contentRef.set(
        {
          textBannerMain,
          textTitleLeft,
          textSubTitleLeft: textSubtitleLeft ?? "", // ← evita undefined
          textBtnLeft,
          textTitleRight,
          textSubTitleRight: textSubtitleRight ?? "", // ← evita undefined
          textBtnRight,
          ...imageUrls,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      

      const updatedDoc = await contentRef.get();

      res.status(200).json({
        message: "Contenido actualizado",
        data: updatedDoc.data(),
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
    const doc = await admin
      .firestore()
      .collection("homeContent")
      .doc("main")
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "Contenido de inicio no encontrado" });
      return;
    }

    res.status(200).json(doc.data());
  } catch (error) {
    console.error("Error al obtener contenido de inicio:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};
