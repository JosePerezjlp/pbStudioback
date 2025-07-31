import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import admin from "../config/firebase";

export const loginController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { uid } = req.body;

    if (!uid) {
      res.status(400).json({ error: "UID es requerido" });
      return;
    }

    let userDoc = await admin.firestore().collection("users").doc(uid).get();
    let collection = "users";
    const userRef = admin.firestore().collection(collection).doc(uid);

    if (!userDoc.exists) {
      userDoc = await admin.firestore().collection("staff").doc(uid).get();
      collection = "staff";

      if (!userDoc.exists) {
        res.status(404).json({ error: "Datos de usuario no encontrados" });
        return;
      }
    }

    const userData = userDoc.data();
    const role = userData?.role ?? "user";

    let newSessionId: string | null = null;
    let sessionNotice = null;

    if (role === "admin") {
      newSessionId = uuidv4();
      await userRef.update({ sessionId: newSessionId });
      sessionNotice = "Esta sesión reemplazará otras activas.";
    }

    const userDataWithoutPassword = { ...userData };
    delete userDataWithoutPassword.password;

    res.status(200).json({
      uid,
      email: userData?.email,
      ...userDataWithoutPassword,
      role,
      sessionNotice,
      sessionId: newSessionId,
    });
  } catch (error) {
    console.error("Error al obtener datos del usuario:", error);
    res.status(500).json({ error: "Error interno al obtener usuario" });
  }
};

export const logoutController = async (req: Request, res: Response) => {
  try {
    const { uid } = req.body;

    // Revocar todos los tokens del usuario
    await admin.auth().revokeRefreshTokens(uid);

    res.status(200).json({ message: "Sesión cerrada correctamente" });
  } catch (error) {
    console.error(
      "Error detallado:",
      error instanceof Error ? error.message : error
    );
    res.status(500).json({
      error: "Error al cerrar sesión",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const forceLogoutController = async (req: Request, res: Response) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      res.status(400).json({ error: "UID es requerido" });
    }

    await admin.auth().revokeRefreshTokens(uid);

    const userRecord = await admin.auth().getUser(uid);
    const revocationTime = new Date(userRecord.tokensValidAfterTime || "");

    res.status(200).json({
      message: `Tokens revocados para usuario ${uid}`,
      revokedAt: revocationTime.toISOString(),
    });
  } catch (error) {
    console.error(
      "Error forzando logout:",
      error instanceof Error ? error.message : error
    );
    res.status(500).json({ error: "Error interno al forzar logout" });
  }
};
