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
        permissions = { clases: ["listado", "crear", "editar", "detalle"] };
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

    // users / staff
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

    // nunca exponer password
    const { password: _omit, ...rest } = data;
		console.log("TCL: _omit", _omit)

    res.status(200).json({
      uid,
      email: str(rest.email),
      ...rest,
      role,
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
