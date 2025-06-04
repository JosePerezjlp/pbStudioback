import { Request, Response } from "express";
import bcrypt from 'bcrypt';
import { validationResult } from 'express-validator';
import admin from '../config/firebase';

export const userController = async (req: Request, res: Response) => {
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
  } = req.body;

  try {
    // 1. Crear el usuario en Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    // 2. Hashear la contraseña (solo para almacenamiento interno en Firestore)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Guardar la data adicional en Firestore con el UID generado por Auth
    const newUserRef = admin.firestore().collection("users").doc(userRecord.uid);
    await newUserRef.set({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      phone,
      branch,
      role: 'user',
      isAdmin: false,
      isNew: true,
      birthDate: birthDate || null,
      registrationDate: new Date().toISOString(),
      emergencyContact: emergencyContact || null,
      transactions: [],
      packages: [],
      waitlist: {
        inList: false,
        position: null,
      },
      classes: {
        total: 0,
        available: 0,
        taken: 0,
      },
    });

    res.status(201).json({
      message: "Usuario registrado correctamente.",
      id: userRecord.uid,
      email: userRecord.email,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
    console.error('Error al registrar usuario:', error.message);
    res.status(500).json({
      error: "Error interno del servidor",
      details: error.message,
    });
  } else {
    console.error('Error desconocido:', error);
    res.status(500).json({
      error: "Error interno del servidor",
      details: 'Error desconocido',
    });
  }
  }
};


export const updateUserController = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const { userId } = req.params;
  const updateData = { ...req.body };
  
  try {
    // Prevenir cambios en el rol y estado de admin
    delete updateData.role;
    delete updateData.isAdmin;

    // Si viene password, hay que hashearla
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Eliminar campos undefined o null
    Object.keys(updateData).forEach(key => 
      (updateData[key] === undefined || updateData[key] === null) && delete updateData[key]
    );

    if (Object.keys(updateData).length === 0) {
      res.status(200).json({ message: "No hay datos para actualizar" });
      return;
    }

    await userRef.update(updateData);

    res.status(200).json({ 
      message: "Usuario actualizado correctamente",
      updatedFields: Object.keys(updateData)
    });
  } catch (error) {
    console.error('Error detallado:', error instanceof Error ? error.message : error);
    res.status(500).json({ 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
};

export const deleteUserController = async (req: Request, res: Response) => {
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
      deletedUserId: userId
    });
  } catch (error) {
    console.error('Error detallado:', error instanceof Error ? error.message : error);
    res.status(500).json({ 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
};

export const getAllUsersController = async (_req: Request, res: Response) => {
  try {
    const usersSnapshot = await admin.firestore().collection("users").get();
    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({ 
      users,
      total: users.length
    });
  } catch (error) {
    console.error('Error detallado:', error instanceof Error ? error.message : error);
    res.status(500).json({ 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
};

export const getUserByIdController = async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const userDoc = await admin.firestore().collection("users").doc(userId).get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.status(200).json({
      id: userDoc.id,
      ...userDoc.data()
    });
  } catch (error) {
    console.error('Error detallado:', error instanceof Error ? error.message : error);
    res.status(500).json({ 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
};
