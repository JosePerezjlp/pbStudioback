// middleware/verifyToken.ts
import { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";

/* ---------- Tipos auxiliares ---------- */
export interface AuthRequest extends Request {
  user?: {
    uid: string;
    role: string;
    isAdmin: boolean;
  };
}

interface FirebaseAuthError {
  code: string;
  message: string;
}

const isFirebaseAuthError = (err: unknown): err is FirebaseAuthError =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  "message" in err;

/* ---------- Middleware ---------- */
export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    /* 1) Leer encabezado ------------------------------------------- */
    const authHeader = req.headers.authorization ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Token no proporcionado" });
      return; // <- salimos con void
    }

    /* 2) Verificar en Firebase ------------------------------------- */
    const idToken = authHeader.slice(7); // quita "Bearer "
    const decoded = await admin.auth().verifyIdToken(idToken);

    /* 3) Obtener rol del usuario ----------------------------------- */
    const userSnap = await admin
      .firestore()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!userSnap.exists) {
      res.status(403).json({ error: "Usuario sin perfil registrado" });
      return;
    }

    const { role = "user" } = userSnap.data() as { role?: string };

    /* 4) Inyectar en la request ------------------------------------ */
    req.user = {
      uid: decoded.uid,
      role,
      isAdmin: role === "admin",
    };

    next();
  } catch (err) {
    /* 5) Manejo de errores ----------------------------------------- */
    if (isFirebaseAuthError(err) && err.code === "auth/id-token-expired") {
      res.status(401).json({ error: "Token expirado" });
      return;
    }

    console.error("[verifyToken] Error verificando token:", err);
    res.status(401).json({ error: "Token inválido" });
  }
};
