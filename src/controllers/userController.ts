import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validationResult } from "express-validator";
import admin from "../config/firebase";
import { sendWelcomeEmail } from "../utils/emailService";

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
