import { Request, Response } from "express";
import admin from "../config/firebase";
import { RolTypeEnum, StatusTypeEnum } from "../types/enums";

const staffCollection = admin.firestore().collection("staff");

export const checkStaffEmailExists = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "El parámetro 'email' es requerido" });
      return;
    }

    const querySnapshot = await staffCollection
    .where("email", "==", email)
    .limit(1)
    .get();
    
		console.log("TCL: querySnapshotsssss", querySnapshot)
    if (!querySnapshot.empty) {
  res.status(409).json({
    error: "Este correo ya está registrado en la base de datos",
    code: "firestore/email-already-exists",
  });
  return;
}

// Mejor que 204, para evitar problemas con axios
res.status(200).json({ message: "Correo disponible" });
  } catch (error) {
    console.error("Error al verificar el email:", error);
    res.status(500).json({
      error: "Error interno al verificar el correo",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};


// 🔐 Crear nuevo usuario staff
export const createStaffUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      email,
      password,
      role,
      branches,
      permissions,
      status,
    }: {
      email: string;
      password: string;
      role: RolTypeEnum;
      branches: string[];
      permissions: Record<string, string[]>;
      status: StatusTypeEnum;
    } = req.body;

    // 🔍 Verificamos si ya hay un usuario con ese email en Firestore
    const existingQuery = await staffCollection
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      res.status(400).json({
        error: "Este correo ya está registrado en la base de datos",
        code: "firestore/email-already-exists",
      });
      return;
    }

    // 🔐 Intentamos crear usuario en Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: true,
    });

    // 📝 Guardamos en Firestore
    await staffCollection.doc(userRecord.uid).set({
      email,
      role,
      branches,
      permissions,
      status,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      message: "Staff creado correctamente",
      uid: userRecord.uid,
    });
  } catch (error: unknown) {
    console.error("Error al crear staff:", error);

    // Type guard para FirebaseError
    if (typeof error === "object" && error !== null && "errorInfo" in error) {
      const firebaseErrorInfo = (
        error as { errorInfo: { code: string; message?: string } }
      ).errorInfo;

      if (firebaseErrorInfo.code === "auth/email-already-exists") {
        res.status(400).json({
          error: "Este correo ya está registrado en Firebase Auth",
          code: firebaseErrorInfo.code,
        });
        return;
      }
    }

    res.status(500).json({
      error: "Error interno al crear staff",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};

// 📋 Listar todos los usuarios staff
export const getAllStaffUsers = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await staffCollection.get();
    const staffList = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ staff: staffList });
  } catch (error) {
    console.error("Error al listar staff:", error);
    res
      .status(500)
      .json({ error: "Error interno al listar staff", details: String(error) });
  }
};

// 🔎 Obtener usuario staff por ID
export const getStaffUserById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const doc = await staffCollection.doc(id).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener staff:", error);
    res.status(500).json({
      error: "Error interno al obtener staff",
      details: String(error),
    });
  }
};

// ✏️ Actualizar usuario staff (solo lo que cambió)
export const updateStaffUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData: Record<string, unknown> = req.body;

    const docRef = staffCollection.doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const existingData = doc.data() as Record<string, unknown>;
    const changes: Record<string, unknown> = {};

    Object.keys(updateData).forEach((key) => {
      if (
        JSON.stringify(updateData[key]) !== JSON.stringify(existingData[key])
      ) {
        changes[key] = updateData[key];
      }
    });

    if (Object.keys(changes).length === 0) {
      res.status(200).json({ message: "No hay cambios para actualizar" });
      return;
    }

    changes.updatedAt = new Date().toISOString();
    await docRef.update(changes);
    res.status(200).json({ message: "Usuario actualizado correctamente" });
  } catch (error) {
    console.error("Error al actualizar staff:", error);
    res.status(500).json({
      error: "Error interno al actualizar staff",
      details: String(error),
    });
  }
};

// ❌ Eliminar usuario staff (Firestore + Auth)
export const deleteStaffUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    await admin.auth().deleteUser(id);
    await staffCollection.doc(id).delete();

    res.status(200).json({ message: "Usuario eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar staff:", error);
    res.status(500).json({
      error: "Error interno al eliminar staff",
      details: String(error),
    });
  }
};

// 🔑 Cambiar contraseña sin pedir la anterior
export const changeStaffPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword }: { newPassword: string } = req.body;

    if (!newPassword) {
      res.status(400).json({ error: "La nueva contraseña es requerida" });
      return;
    }

    await admin.auth().updateUser(id, { password: newPassword });

    res.status(200).json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    res.status(500).json({
      error: "Error interno al cambiar contraseña",
      details: String(error),
    });
  }
};
