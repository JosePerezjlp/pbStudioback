import { Request, Response } from "express";
import admin from "../config/firebase";
import { RolTypeEnum, StatusTypeEnum } from "../types/enums";

interface StaffUser {
  id: string;
  email?: string;
  role: RolTypeEnum;
  branches: string[];
  permissions: Record<string, string[]>;
  status: StatusTypeEnum;
  firstName?: string;
  lastName?: string;
  phone?: string;
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
}

const staffCollection = admin.firestore().collection("users");

export const checkStaffEmailExists = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.query;
    console.log("TCL: email", email);

    if (!email || typeof email !== "string") {
      res.status(409).json({ error: "El parámetro 'email' es requerido" });
      return;
    }

    const querySnapshot = await staffCollection
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!querySnapshot.empty) {
      res.status(409).json({
        error: "Este correo ya está registrado en la base de datos",
        code: "firestore/email-already-exists",
      });
      return;
    }

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

    // Validar email
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({
        error: "Email inválido o faltante",
      });
      return;
    }

    // Validar password mínimo 8 caracteres
    if (!password || typeof password !== "string" || password.length < 8) {
      res.status(400).json({
        error: "La contraseña debe tener al menos 8 caracteres",
      });
      return;
    }

    // Validar role
    if (!role || (role !== RolTypeEnum.ADMIN && role !== RolTypeEnum.EMPLOYEE)) {
      res.status(400).json({
        error: "Role inválido. Debe ser 'admin' o 'employee'",
      });
      return;
    }

    // Validar branches
    if (!Array.isArray(branches) || branches.length === 0) {
      res.status(400).json({
        error: "Debe asignar al menos una sucursal",
      });
      return;
    }

    // Validar que todas las branches existan
    const branchesCollection = admin.firestore().collection("branches");
    const branchesSnapshots = await Promise.all(
      branches.map((branchId) => branchesCollection.doc(branchId).get())
    );
    
    const invalidBranches = branches.filter((_, index) => !branchesSnapshots[index].exists);
    if (invalidBranches.length > 0) {
      res.status(400).json({
        error: `Las siguientes sucursales no existen: ${invalidBranches.join(", ")}`,
      });
      return;
    }

    // Validar permissions
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
      res.status(400).json({
        error: "Permissions debe ser un objeto",
      });
      return;
    }

    // Validar estructura de permissions (módulos y acciones)
    // Por ahora aceptamos cualquier estructura, pero validamos que sea objeto con arrays como valores
    for (const [module, actions] of Object.entries(permissions)) {
      if (typeof module !== "string") {
        res.status(400).json({
          error: "Los módulos en permissions deben ser strings",
        });
        return;
      }
      if (!Array.isArray(actions)) {
        res.status(400).json({
          error: `Las acciones del módulo '${module}' deben ser un array`,
        });
        return;
      }
      // Validar que todas las acciones sean strings
      if (!actions.every((action) => typeof action === "string")) {
        res.status(400).json({
          error: `Las acciones del módulo '${module}' deben ser strings`,
        });
        return;
      }
    }

    // Validar status
    if (!status || (status !== StatusTypeEnum.ACTIVE && status !== StatusTypeEnum.INACTIVE)) {
      res.status(400).json({
        error: "Status inválido. Debe ser 'Activo' o 'Inactivo'",
      });
      return;
    }

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
      branches, // Array de sucursales
      permissions, // Objeto con módulos y acciones
      status,
      firstName: "Staff",
      lastName: "Fake",
      phone: "0000000000",
      branch: branches[0] ?? "", // Fallback para compatibilidad
      createdAt: new Date().toISOString(),
      isAdmin: role === RolTypeEnum.ADMIN, // Solo true si es admin
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
// 📋 Listar todos los usuarios staff (solo admin y employee, excluyendo superusuarios)
export const getAllStaffUsers = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("users")
      .get();

    // Correos de superusuarios que nunca deben mostrarse
    const superUsers = [
      "johandevadmin@pbstudioapp.com",
      "admintemporal@pbstudioapp.com",
    ];

    const staffList: StaffUser[] = snapshot.docs
      .map((doc) => {
        const data = doc.data() as Omit<StaffUser, "id">;
        return {
          id: doc.id,
          ...data,
        };
      })
      .filter((user) => {
        const email = (user.email ?? "").toLowerCase();
        const role = String(user.role ?? "").toLowerCase();
        if (superUsers.includes(email)) return false;
        return role === RolTypeEnum.ADMIN || role === RolTypeEnum.EMPLOYEE;
      });

    res.status(200).json({ staff: staffList });
  } catch (error) {
    console.error("Error al listar staff:", error);
    res.status(500).json({
      error: "Error interno al listar staff",
      details: String(error),
    });
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

    const data = doc.data();

    if (
      !data ||
      ![RolTypeEnum.ADMIN, RolTypeEnum.EMPLOYEE].includes(
        data.role?.toLowerCase()
      )
    ) {
      res.status(404).json({ error: "Usuario no encontrado como staff" });
      return;
    }

    // Asegurar que branches y permissions estén en la respuesta
    const branches = Array.isArray(data.branches) ? data.branches : [];
    const permissions = (data.permissions && typeof data.permissions === "object" && !Array.isArray(data.permissions))
      ? data.permissions
      : {};

    res.status(200).json({
      id: doc.id,
      ...data,
      firstName: data.firstName ?? "Staff",
      lastName: data.lastName ?? "",
      phone: data.phone ?? "0000000000",
      branch: data.branch ?? branches[0] ?? "",
      branches, // Asegurar que siempre esté como array
      permissions, // Asegurar que siempre esté como objeto
    });
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

    // Validar campos si vienen en el update
    if ("email" in updateData) {
      const email = updateData.email;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        res.status(400).json({
          error: "Email inválido",
        });
        return;
      }
      // Verificar que el email no esté en uso por otro usuario
      const existingQuery = await staffCollection
        .where("email", "==", email)
        .limit(1)
        .get();
      if (!existingQuery.empty && existingQuery.docs[0].id !== id) {
        res.status(400).json({
          error: "Este correo ya está registrado en la base de datos",
          code: "firestore/email-already-exists",
        });
        return;
      }
    }

    if ("role" in updateData) {
      const role = updateData.role;
      if (role !== RolTypeEnum.ADMIN && role !== RolTypeEnum.EMPLOYEE) {
        res.status(400).json({
          error: "Role inválido. Debe ser 'admin' o 'employee'",
        });
        return;
      }
      // Actualizar isAdmin según el role
      changes.isAdmin = role === RolTypeEnum.ADMIN;
    }

    if ("branches" in updateData) {
      const branches = updateData.branches;
      if (!Array.isArray(branches) || branches.length === 0) {
        res.status(400).json({
          error: "Debe asignar al menos una sucursal",
        });
        return;
      }
      // Validar que todas las branches existan
      const branchesCollection = admin.firestore().collection("branches");
      const branchesSnapshots = await Promise.all(
        branches.map((branchId: unknown) => {
          if (typeof branchId !== "string") return null;
          return branchesCollection.doc(branchId).get();
        })
      );
      
      const invalidBranches = branches.filter((branchId: unknown, index: number) => {
        if (typeof branchId !== "string") return true;
        return !branchesSnapshots[index]?.exists;
      });
      
      if (invalidBranches.length > 0) {
        res.status(400).json({
          error: `Las siguientes sucursales no existen: ${invalidBranches.join(", ")}`,
        });
        return;
      }
      // Actualizar branch como fallback
      changes.branch = branches[0] ?? "";
    }

    if ("permissions" in updateData) {
      const permissions = updateData.permissions;
      if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
        res.status(400).json({
          error: "Permissions debe ser un objeto",
        });
        return;
      }
      // Validar estructura de permissions
      for (const [module, actions] of Object.entries(permissions)) {
        if (typeof module !== "string") {
          res.status(400).json({
            error: "Los módulos en permissions deben ser strings",
          });
          return;
        }
        if (!Array.isArray(actions)) {
          res.status(400).json({
            error: `Las acciones del módulo '${module}' deben ser un array`,
          });
          return;
        }
        if (!actions.every((action: unknown) => typeof action === "string")) {
          res.status(400).json({
            error: `Las acciones del módulo '${module}' deben ser strings`,
          });
          return;
        }
      }
    }

    if ("status" in updateData) {
      const status = updateData.status;
      if (status !== StatusTypeEnum.ACTIVE && status !== StatusTypeEnum.INACTIVE) {
        res.status(400).json({
          error: "Status inválido. Debe ser 'Activo' o 'Inactivo'",
        });
        return;
      }
    }

    // Comparar y agregar solo cambios
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

type ChangeStaffPasswordParams = { id: string };
type ChangeStaffPasswordBody = { newPassword: string };

type RequestUser = {
  uid: string;
  email: string;
  role: RolTypeEnum;
  isAdmin: boolean;
};

function hasRequestUser(req: Request): req is Request & { user: RequestUser } {
  const u = (req as Request & { user?: Partial<RequestUser> }).user;
  return !!u && typeof u.uid === "string" && typeof u.isAdmin === "boolean";
}

export const changeStaffPassword = async (
  req: Request<ChangeStaffPasswordParams, unknown, ChangeStaffPasswordBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({
        error:
          "La nueva contraseña es requerida y debe tener al menos 8 caracteres",
      });
      return;
    }

    if (!hasRequestUser(req) || !req.user.isAdmin) {
      res.status(403).json({ error: "No autorizado" });
      return;
    }

    await admin.auth().updateUser(id, { password: newPassword });
    await admin.auth().revokeRefreshTokens(id);

    await admin
      .firestore()
      .collection("users")
      .doc(id)
      .set({ updatedAt: new Date().toISOString() }, { merge: true });

    res
      .status(200)
      .json({ message: "Contraseña actualizada y sesiones revocadas" });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    res.status(500).json({
      error: "Error interno al cambiar contraseña",
      details: String(error),
    });
  }
};
