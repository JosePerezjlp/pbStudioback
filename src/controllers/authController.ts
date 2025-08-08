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

    const db = admin.firestore();

    // 1) users/{uid}
    let userDoc = await db.collection("users").doc(uid).get();
    let collection = "users";

    // 2) staff/{uid}
    if (!userDoc.exists) {
      userDoc = await db.collection("staff").doc(uid).get();
      collection = "staff";
    }

    // 3) instructors/{uid} → mapear a payload tipo “staff”
    if (!userDoc.exists) {
      const instrSnap = await db.collection("instructors").doc(uid).get();
      if (!instrSnap.exists) {
        res.status(404).json({ error: "Datos de usuario no encontrados" });
        return;
      }

      const instr = instrSnap.data() as Record<string, unknown>;

      // Normalizaciones mínimas para el panel:
      const { enabled } = instr;
      const status =
        enabled === true || enabled === "true" ? "Activo" : "Inactivo";

      // Si existe permissions, lo usamos; si no, tomamos clases[] y lo metemos en permissions.clases
      const permissions =
        (instr.permissions as Record<string, string[] | undefined>) ??
        (Array.isArray(instr.clases)
          ? { clases: instr.clases as string[] }
          : { clases: ["listado", "crear", "editar", "detalle"] });

      // branches como array (staff usa arreglo)
      const branch = (instr.branch as string) ?? "";
      const branches = branch ? [branch] : [];

      // Armamos el payload. Evitamos exponer el password hasheado.
      const {
        password, // eslint-disable-line @typescript-eslint/no-unused-vars
        ...rest
      } = instr;

      res.status(200).json({
        uid,
        email: instr.email,
        ...rest,
        // overrides / campos garantizados para el panel:
        role: "employee",
        status,
        branches,
        branch, // lo conservamos por si tu UI lo usa
        permissions,
      });
      return;
    }

    // → Flujo original para users/staff (intacto)
    const userRef = db.collection(collection).doc(uid);
    const userData = userDoc.data() || {};
    const role = (userData.role as string) ?? "user";

    let newSessionId: string | null = null;
    let sessionNotice: string | null = null;

    if (role === "admin") {
      newSessionId = uuidv4();
      await userRef.update({ sessionId: newSessionId });
      sessionNotice = "Esta sesión reemplazará otras activas.";
    }

    const { ...userDataWithoutPassword } = userData as {
      password?: unknown;
      [k: string]: unknown;
    };

    res.status(200).json({
      uid,
      email: userData.email,
      ...userDataWithoutPassword,
      role,
      sessionNotice,
      sessionId: newSessionId,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error al obtener datos del usuario:", error);
    res.status(500).json({ error: "Error interno al obtener usuario" });
  }
};

export const logoutController = async (req: Request, res: Response) => {
  try {
    const { uid } = req.body;
    await admin.auth().revokeRefreshTokens(uid);
    res.status(200).json({ message: "Sesión cerrada correctamente" });
  } catch (error) {
    // eslint-disable-next-line no-console
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
    console.error(
      "Error forzando logout:",
      error instanceof Error ? error.message : error
    );
    res.status(500).json({ error: "Error interno al forzar logout" });
  }
};
