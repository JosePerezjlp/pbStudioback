import { Request, Response } from "express";
import admin from "../config/firebase";

// 🔄 Función genérica para guardar contenido
const updateContent = async (docId: string, html: string, res: Response) => {
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

    res.status(200).json({ message: `Contenido '${docId}' actualizado correctamente` });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error(`Error al actualizar contenido '${docId}':`, msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

// 🔄 Función genérica para obtener contenido
const getContent = async (docId: string, res: Response) => {
  try {
    const doc = await admin.firestore().collection("content").doc(docId).get();

    if (!doc.exists) {
      res.status(404).json({ error: `Contenido '${docId}' no encontrado` });
      return;
    }

    const data = doc.data();
    res.status(200).json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error(`Error al obtener contenido '${docId}':`, msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

// --- Who We Are ---
export const updateWhoWeAreController = async (req: Request, res: Response) =>
  updateContent("whoWeAre", req.body.html, res);

export const getWhoWeAreController = async (_req: Request, res: Response) =>
  getContent("whoWeAre", res);

// --- Terms and Conditions ---
export const updateTermsController = async (req: Request, res: Response) =>
  updateContent("termsAndConditions", req.body.html, res);

export const getTermsController = async (_req: Request, res: Response) =>
  getContent("termsAndConditions", res);

// --- Privacy Notice ---
export const updatePrivacyController = async (req: Request, res: Response) =>
  updateContent("privacyNotice", req.body.html, res);

export const getPrivacyController = async (_req: Request, res: Response) =>
  getContent("privacyNotice", res);
