import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import admin from "../config/firebase";

type DocData = Record<string, unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const boolishTrue = (v: unknown): boolean =>
  v === true || v === "true";

export const loginController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { uid } = req.body as { uid?: string };
    if (!uid) {
      res.status(400).json({ error: "UID es requerido" });
      return;
    }

    const db = admin.firestore();

    // Buscar en users / staff / instructors
    const [userDoc, staffDoc, instrDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("staff").doc(uid).get(),
      db.collection("instructors").doc(uid).get(),
    ]);

    let collection: "users" | "staff" | "instructors" | null = null;
    let snap:
      | FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>
      | null = null;

    if (userDoc.exists) {
      collection = "users";
      snap = userDoc;
    } else if (staffDoc.exists) {
      collection = "staff";
      snap = staffDoc;
    } else if (instrDoc.exists) {
      collection = "instructors";
      snap = instrDoc;
    } else {
      res.status(404).json({ error: "Datos de usuario no encontrados" });
      return;
    }

    const dataUnknown = snap.data() || {};
    const data: DocData = isRecord(dataUnknown) ? dataUnknown : {};

    const roleRaw = str(data.role);
    const role = roleRaw ? roleRaw.toLowerCase() : "";

    // Normalización si viene de instructors (tu panel lo trata como "employee")
    if (collection === "instructors") {
      const enabled = boolishTrue(data.enabled);
      const status = enabled ? "Activo" : "Inactivo";

      // permissions: o lo que venga, o cae a clases[]
      let permissions: Record<string, string[]> = {};
      if (isRecord(data.permissions)) {
        permissions = Object.fromEntries(
          Object.entries(data.permissions).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.filter((x) => typeof x === "string") : [],
          ])
        );
      } else if (Array.isArray(data.clases)) {
        permissions = { clases: data.clases.filter((x) => typeof x === "string") as string[] };
      } else {
        permissions = { clases: ["listado", "crear", "editar", "cancelar", "reservaciones", "lista_espera"] };
      }

      const branch = str(data.branch) ?? "";
      const branches = branch ? [branch] : [];

      // Sesión única
      const newSessionId = uuidv4();
      await db.collection("instructors").doc(uid).update({
        sessionId: newSessionId,
        sessionUpdatedAt: new Date().toISOString(),
      });
      await admin.auth().revokeRefreshTokens(uid);

      res.status(200).json({
        uid,
        email: str(data.email),
        ...data,
        role: "employee",
        status,
        branches,
        branch,
        permissions,
        sessionId: newSessionId,
        sessionNotice: "Esta sesión reemplazará otras activas por seguridad.",
      });
      return;
    }

    // Normalización si viene de staff
    if (collection === "staff") {
      const status = str(data.status) || "Activo";
      const permissions = isRecord(data.permissions) ? data.permissions : {};
      const branches = Array.isArray(data.branches) ? data.branches : [];

      // Sesión única
      const newSessionId = uuidv4();
      await db.collection("staff").doc(uid).update({
        sessionId: newSessionId,
        sessionUpdatedAt: new Date().toISOString(),
      });
      await admin.auth().revokeRefreshTokens(uid);

      // Filtrar campos sensibles como en la lógica de users
      const { password: _omit, ...safeData } = data;

      res.status(200).json({
        uid,
        email: str(safeData.email),
        ...safeData,
        role: "employee",
        status,
        branches,
        permissions,
        sessionId: newSessionId,
        sessionNotice: "Esta sesión reemplazará otras activas por seguridad.",
      });
      return;
    }

    // users (admin o employee)
    const userRef = db.collection(collection).doc(uid);

    let newSessionId: string | null = null;
    let sessionNotice: string | null = null;

    if (role === "admin" || role === "employee") {
      newSessionId = uuidv4();
      await userRef.update({
        sessionId: newSessionId,
        sessionUpdatedAt: new Date().toISOString(),
      });
      await admin.auth().revokeRefreshTokens(uid);
      sessionNotice = "Esta sesión reemplazará otras activas por seguridad.";
    }

    // Normalizar branches y permissions para employees
    let normalizedBranches: string[] = [];
    let normalizedPermissions: Record<string, string[]> = {};

    if (role === "employee") {
      // Normalizar branches
      if (Array.isArray(data.branches)) {
        normalizedBranches = data.branches.filter((b: unknown) => typeof b === "string");
      } else if (typeof data.branch === "string") {
        normalizedBranches = [data.branch];
      }

      // Normalizar permissions
      if (isRecord(data.permissions)) {
        normalizedPermissions = Object.fromEntries(
          Object.entries(data.permissions).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.filter((x: unknown) => typeof x === "string") : [],
          ])
        );
      }
    } else if (role === "admin") {
      // Admin no tiene branches limitadas (array vacío)
      normalizedBranches = [];
      // Admin tiene todos los permisos, pero no se guardan en permissions
      normalizedPermissions = {};
    }

    // nunca exponer password
    const { password: _omit, ...rest } = data;

    res.status(200).json({
      uid,
      email: str(rest.email),
      ...rest,
      role,
      // Asegurar que employees tengan branches y permissions en la respuesta
      ...(role === "employee" && {
        branches: normalizedBranches,
        permissions: normalizedPermissions,
      }),
      ...(role === "admin" && {
        branches: [],
      }),
      sessionId: newSessionId,
      sessionNotice,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error al obtener datos del usuario:", error);
    res.status(500).json({ error: "Error interno al obtener usuario" });
  }
};

export const logoutController = async (req: Request, res: Response) => {
  try {
    const { uid } = req.body as { uid?: string };
    if (uid) {
      await admin.auth().revokeRefreshTokens(uid);
    }
    res.status(200).json({ message: "Sesión cerrada correctamente" });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error detallado:", error);
    res.status(500).json({
      error: "Error al cerrar sesión",
    });
  }
};

export const forceLogoutController = async (req: Request, res: Response) => {
  try {
    const { uid } = req.body as { uid?: string };
    if (!uid) {
      res.status(400).json({ error: "UID es requerido" });
      return;
    }
    await admin.auth().revokeRefreshTokens(uid);
    const userRecord = await admin.auth().getUser(uid);
    const revocationTime = new Date(userRecord.tokensValidAfterTime || "");
    res.status(200).json({
      message: `Tokens revocados para usuario ${uid}`,
      revokedAt: revocationTime.toISOString(),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error forzando logout:", error);
    res.status(500).json({ error: "Error interno al forzar logout" });
  }
};
