import { Request, Response } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcrypt";
import admin from "../config/firebase";

export const loginController = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return Promise.resolve();
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email y contraseña son requeridos" });
      return Promise.resolve();
    }

    // Autenticar con Firebase Auth
    const userCredential = await admin.auth().getUserByEmail(email);

    if (!userCredential) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return Promise.resolve();
    }

    // Buscar el usuario en Firestore para obtener su rol y contraseña
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userCredential.uid)
      .get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Datos de usuario no encontrados" });
      return Promise.resolve();
    }

    const userData = userDoc.data();

    // Verificar la contraseña
    const isValidPassword = await bcrypt.compare(
      password,
      (userData?.password as string) || ""
    );
    if (!isValidPassword) {
      res.status(401).json({ error: "Contraseña incorrecta" });
      return Promise.resolve();
    }

    // Crear token personalizado con los claims
    const customToken = await admin
      .auth()
      .createCustomToken(userCredential.uid, {
        role: userData?.role || "user",
        isAdmin: userData?.role === "admin",
      });

    // Crear objeto de usuario sin la contraseña
    const userDataWithoutPassword = { ...userData };
    delete userDataWithoutPassword.password;

    res.status(200).json({
      token: customToken,
      user: {
        uid: userCredential.uid,
        email: userCredential.email,
        ...userDataWithoutPassword,
        role: userData?.role || "user",
      },
    });
    return Promise.resolve();
  } catch (error) {
    console.error(
      "Error detallado:",
      error instanceof Error ? error.message : error
    );
    res.status(401).json({
      error: "Error de autenticación",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
    return Promise.resolve();
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
