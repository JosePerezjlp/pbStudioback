import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validationResult } from "express-validator";
import admin from "../config/firebase";

export const userController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
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
  } = req.body;

  try {
    const userRecord = await admin.auth().createUser({ email, password });
    const hashedPassword = await bcrypt.hash(password, 10);

    await admin
      .firestore()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        firstName,
        lastName,
        email,
        password: hashedPassword,
        phone,
        branch,
        role: "user",
        isAdmin: false,
        isNew: true,
        birthDate: birthDate ?? null,
        registrationDate: new Date().toISOString(),
        emergencyContact: {
          name: emergencyContact?.name ?? null,
          phone: emergencyContact?.phone ?? null,
        },
        transactions: [],
        packages: [],
        waitlist: { inList: false, position: null },
        classes: { total: 0, available: 0, taken: 0 },
      });

    res.status(201).json({
      message: "Usuario registrado correctamente.",
      id: userRecord.uid,
      email: userRecord.email,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al registrar usuario:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const updateUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const errors = validationResult(req);
  console.log("se activo el controller");
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
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
    const usersSnapshot = await admin.firestore().collection("users").get();
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
    }

    res.status(200).json({ id: userDoc.id, ...userDoc.data() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener usuario por ID:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};
