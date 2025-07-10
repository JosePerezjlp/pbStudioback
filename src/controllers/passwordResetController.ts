import { Request, Response } from "express";
import admin from "../config/firebase";
import { sendPasswordResetCodeEmail } from "../utils/emailService";

const COLLECTION = "passwordResets"; // Firestore sub-colección

/* ---------- 1) Solicitar código ---------- */
export const requestResetCode = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    if (!email) {
      res.status(400).json({ error: "Email es requerido" });
      return;
    }

    /* 1. Obtener usuario */
    const userQuery = await admin
      .firestore()
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (userQuery.empty) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    const userSnap = userQuery.docs[0];
    const { role = "user", firstName = "Usuario" } = userSnap.data();
    if (role === "admin") {
      res.status(403).json({ error: "No permitido para administradores" });
      return;
    }

    /* 2. Generar código y fecha de expiración */
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // +2h

    /* 3. Guardar (sobre-escribe si ya existe) */
    await admin
      .firestore()
      .collection(COLLECTION)
      .doc(email)
      .set({ email, code, expiresAt, used: false });

    /* 4. Email */
    await sendPasswordResetCodeEmail(email, firstName, code);

    res.status(200).json({ message: "Código enviado" });
  } catch (err) {
    console.error("❌ requestResetCode:", err);
    res.status(500).json({ error: "Error enviando código" });
  }
};

/* ---------- helper para leer / validar ---------- */
const getAndValidate = async (email: string, code: string | undefined) => {
  const snap = await admin.firestore().collection(COLLECTION).doc(email).get();
  if (!snap.exists) return { ok: false, reason: "Código no encontrado" };

  const { code: saved, expiresAt, used } = snap.data() as {
    code: string;
    expiresAt: number;
    used: boolean;
  };

  if (used) return { ok: false, reason: "Código ya usado" };
  if (Date.now() > expiresAt) return { ok: false, reason: "Código expirado" };
  if (code && code !== saved) return { ok: false, reason: "Código inválido" };

  return { ok: true, snap };
};

/* ---------- 2) Verificar código ---------- */
export const verifyResetCode = async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body as { email: string; code: string };

    const { ok, reason } = await getAndValidate(email, code);
    if (!ok) {
      res.status(400).json({ error: reason });
      return;
    }
    res.status(200).json({ message: "Código válido" });
  } catch (err) {
    console.error("❌ verifyResetCode:", err);
    res.status(500).json({ error: "Error verificando código" });
  }
};

/* ---------- 3) Confirmar nueva contraseña ---------- */
export const confirmPasswordReset = async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body as {
      email: string;
      code: string;
      newPassword: string;
    };

    if (!email || !code || !newPassword) {
      res.status(400).json({ error: "Datos incompletos" });
      return;
    }

    const { ok, reason, snap } = await getAndValidate(email, code);
    if (!ok || !snap) {
      res.status(400).json({ error: reason });
      return;
    }

    /* 1. Obtener UID de ese email en Firebase Auth */
    const userRecord = await admin.auth().getUserByEmail(email);

    /* 2. Cambiar contraseña */
    await admin.auth().updateUser(userRecord.uid, { password: newPassword });

    /* 3. Marcar como usado */
    await snap.ref.update({ used: true });

    res.status(200).json({ message: "Contraseña actualizada" });
  } catch (err) {
    console.error("❌ confirmPasswordReset:", err);
    res.status(500).json({ error: "Error al actualizar contraseña" });
  }
};
