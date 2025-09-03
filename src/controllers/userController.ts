import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validationResult } from "express-validator";
import admin from "../config/firebase";
import { sendWelcomeEmail } from "../utils/emailService";

export const completeProfileFromAuthController = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Helper local para extraer Bearer token
  const getBearer = (r: Request): string | null => {
    const h = r.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
  };

  try {
    // 1) Verificar ID token -> obtener uid y email confiables
    const idToken = getBearer(req);
    if (!idToken) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Falta Authorization Bearer token",
      });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { uid } = decoded;
    const emailFromToken = decoded.email ?? "";

    if (!uid || !emailFromToken) {
      res
        .status(401)
        .json({ error: "UNAUTHORIZED", message: "Token inválido" });
      return;
    }

    // 2) Body de perfil
    const {
      firstName,
      lastName,
      phone = "",
      branch = "",
      birthDate = "",
      emergencyContact,
      password, // opcional: si llega, se configura en Auth
      // enabled, // ignorado si llega: no lo forzamos desde cliente
      // freeSession, // ignorado si llega: no lo forzamos desde cliente
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      email, // si llega en el body se ignora; usamos el del token
    } = req.body as {
      firstName: string;
      lastName: string;
      phone?: string;
      branch?: string;
      birthDate?: string;
      emergencyContact?: { name?: string | null; phone?: string | null } | null;
      password?: string;
      enabled?: unknown;
      freeSession?: unknown;
      email?: string;
    };

    if (!firstName || !lastName) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "firstName y lastName son requeridos",
      });
      return;
    }

    // 3) Upsert en Firestore (users/{uid})
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    const nowIso = new Date().toISOString();

    const baseDoc = {
      firstName,
      lastName,
      email: emailFromToken,
      phone,
      branch,
      role: "user" as const,
      isAdmin: false,
      birthDate: birthDate || null,
      emergencyContact: {
        name: emergencyContact?.name ?? null,
        phone: emergencyContact?.phone ?? null,
      },
    };

    if (!snap.exists) {
      // Crear doc inicial con estructuras por defecto
      await userRef.set({
        ...baseDoc,
        isNew: true,
        enabled: true,
        freeSession: false,
        registrationDate: nowIso,
        createdAt: nowIso,
        packages: [],
        transactions: [],
        waitlist: { inList: false, position: null },
        classes: { total: 0, available: 0, taken: 0 },
      });
      // (Opcional) correo de bienvenida
      try {
        await sendWelcomeEmail(emailFromToken, firstName);
      } catch (emailErr) {
        // eslint-disable-next-line no-console
        console.error("No se pudo enviar el correo de bienvenida:", emailErr);
      }
    } else {
      // Actualizar solo campos de perfil
      await userRef.update({
        ...baseDoc,
        updatedAt: nowIso,
      });
    }

    // 4) Si viene password, habilitar login por email+password para ESTE uid
    if (typeof password === "string" && password.trim()) {
      // Firebase valida políticas de contraseña; si no cumple, lanzará error
      await admin.auth().updateUser(uid, { password: password.trim() });
      // Si quieres marcar verificado (normalmente Google ya lo está):
      // await admin.auth().updateUser(uid, { emailVerified: true });
    }

    // 5) Responder con el doc fresco
    const fresh = await userRef.get();
    res.status(200).json({ id: uid, uid, ...fresh.data() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("completeProfileFromAuthController error:", err);

    // Mapear algunos errores comunes de Auth
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message =
      err instanceof Error ? err.message : "Error al completar el perfil";

    if (typeof err === "object" && err && "code" in err) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr.code?.startsWith("auth/")) {
        status = 400;
        code = fbErr.code.toUpperCase().replace(/\//g, "_");
        message = fbErr.message || message;
      }
    }

    res.status(status).json({ error: code, message });
  }
};

export const userController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    branch,
    birthDate,
    emergencyContact,
    enabled = true,
    freeSession = false,
  } = req.body;

  try {
    const userRecord = await admin.auth().createUser({ email, password });

    await admin
      .firestore()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        firstName,
        lastName,
        email,
        phone,
        branch,
        role: "user",
        isAdmin: false,
        isNew: true,
        enabled,
        freeSession,
        birthDate: birthDate ?? null,
        registrationDate: new Date().toISOString(),
        emergencyContact: {
          name: emergencyContact?.name ?? null,
          phone: emergencyContact?.phone ?? null,
        },
        packages: [],
        transactions: [],
        waitlist: { inList: false, position: null },
        classes: { total: 0, available: 0, taken: 0 },
        createdAt: new Date().toISOString(),
      });

    try {
      await sendWelcomeEmail(email, firstName);
    } catch (emailErr) {
      console.error("No se pudo enviar el correo de bienvenida:", emailErr);
    }

    res.status(201).json({
      message: "Usuario registrado correctamente.",
      id: userRecord.uid,
      email: userRecord.email,
    });
  } catch (error) {
    // Detectar error de Firebase Admin
    let status = 500;
    let code = "INTERNAL";
    let message = "Error interno del servidor";

    if (typeof error === "object" && error && "code" in error) {
      const fbErr = error as { code?: string; message?: string };
      if (fbErr.code === "auth/email-already-exists") {
        status = 409;
        code = "EMAIL_ALREADY_EXISTS";
        message = "El correo ya está registrado.";
      } else if (fbErr.message) {
        message = fbErr.message;
      }
    }

    console.error("Error al registrar usuario:", message);
    res.status(status).json({ error: code, message });
  }
};

export const updateUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const { userId } = req.params;
  const updateData = { ...req.body };

  try {
    delete updateData.role;
    delete updateData.isAdmin;

    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    if (updateData.emergencyContact) {
      const emergency = updateData.emergencyContact;

      if (typeof emergency === "string") {
        updateData.emergencyContact = { name: emergency, phone: null };
      } else if (typeof emergency === "object") {
        updateData.emergencyContact = {
          name: emergency.name ?? null,
          phone: emergency.phone ?? null,
        };
      }
    }

    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    Object.keys(updateData).forEach((key) => {
      if (
        updateData[key] === undefined ||
        (updateData[key] === null && key !== "emergencyContact")
      ) {
        delete updateData[key];
      }
    });

    if (Object.keys(updateData).length === 0) {
      res.status(200).json({ message: "No hay datos para actualizar" });
      return;
    }

    await userRef.update(updateData);

    res.status(200).json({
      message: "Usuario actualizado correctamente",
      updatedFields: Object.keys(updateData),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al actualizar usuario:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const deleteUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;

  try {
    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    await userRef.delete();

    res.status(200).json({
      message: "Usuario eliminado correctamente",
      deletedUserId: userId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al eliminar usuario:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getAllUsersController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const usersSnapshot = await admin
      .firestore()
      .collection("users")
      .orderBy("createdAt", "desc")
      .get();
    const users = usersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ users, total: users.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener usuarios:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getUserByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;

  try {
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.status(200).json({ id: userDoc.id, ...userDoc.data() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener usuario por ID:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const adminResetPasswordController = async (
  req: Request,
  res: Response
): Promise<void> => {
  // helpers locales para leer código/mensaje sin usar `any`
  const getErrorCode = (e: unknown): string | undefined => {
    if (typeof e === "object" && e !== null && "code" in e) {
      const { code } = e as { code?: unknown };
      return typeof code === "string" ? code : undefined;
    }
    return undefined;
  };

  const getErrorMessage = (e: unknown): string | undefined => {
    if (typeof e === "object" && e !== null && "message" in e) {
      const { message } = e as { message?: unknown };
      return typeof message === "string" ? message : undefined;
    }
    return undefined;
  };

  try {
    const { userId } = req.params;
    const { newPassword } = req.body as { newPassword?: string };

    // Validaciones mínimas
    if (!userId) {
      res.status(400).json({
        error: "USER_ID_REQUIRED",
        message: "Falta userId en la ruta",
      });
      return;
    }

    if (!newPassword || typeof newPassword !== "string") {
      res.status(400).json({
        error: "PASSWORD_REQUIRED",
        message: "La nueva contraseña es requerida",
      });
      return;
    }

    if (newPassword.trim().length < 8) {
      res.status(400).json({
        error: "WEAK_PASSWORD",
        message: "La contraseña debe tener al menos 8 caracteres",
      });
      return;
    }

    // Verificar que exista el doc en Firestore (opcional pero útil)
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    if (!userDoc.exists) {
      res
        .status(404)
        .json({ error: "USER_NOT_FOUND", message: "Usuario no encontrado" });
      return;
    }

    // Actualizar password en Firebase Auth
    await admin.auth().updateUser(userId, { password: newPassword.trim() });

    // Revocar tokens para forzar re-login en todos los dispositivos
    await admin.auth().revokeRefreshTokens(userId);

    // Marcar actualizado en el doc (opcional)
    await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .update({ updatedAt: new Date().toISOString() });

    res
      .status(200)
      .json({ message: "Contraseña actualizada y sesiones revocadas" });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error("adminResetPasswordController error:", err);

    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "No se pudo actualizar la contraseña";

    const fbCode = getErrorCode(err);
    const fbMsg = getErrorMessage(err);

    if (fbCode === "auth/user-not-found") {
      status = 404;
      code = "USER_NOT_FOUND";
      message = "Usuario no encontrado en Auth";
    } else if (typeof fbCode === "string" && fbCode.startsWith("auth/")) {
      status = 400;
      code = fbCode.toUpperCase().replace(/\//g, "_");
      message = fbMsg ?? message;
    } else if (fbMsg) {
      message = fbMsg;
    }

    res.status(status).json({ error: code, message });
  }
};
