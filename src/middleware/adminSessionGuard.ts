import type { RequestHandler, Response, NextFunction } from "express";
import admin from "../config/firebase";
import { AuthRequest } from "./authMiddleware";
// import type { AuthRequest } from "./verifyToken";

/**
 * Requiere x-session-id válido para roles admin/employee.
 * Busca sessionId en users, staff e instructors.
 */
export const adminSessionGuard: RequestHandler = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const { user } = req;
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const { uid, role } = user;

  // Sólo exigir sesión única para admin y employee
  if (role !== "admin" && role !== "employee") {
    next();
    return;
  }

  const headerSid = (req.headers["x-session-id"] as string | undefined) ?? "";
  if (!headerSid) {
    res.status(401).json({ error: "Falta x-session-id" });
    return;
  }

  const db = admin.firestore();

  db.doc(`users/${uid}`)
    .get()
    .then((uSnap) => {
      if (uSnap.exists)
        return (uSnap.data()?.sessionId as string | undefined) ?? null;
      return db
        .doc(`staff/${uid}`)
        .get()
        .then((sSnap) =>
          sSnap.exists
            ? ((sSnap.data()?.sessionId as string | undefined) ?? null)
            : null
        )
        .then((sid) => {
          if (sid) return sid;
          return db
            .doc(`instructors/${uid}`)
            .get()
            .then((iSnap) =>
              iSnap.exists
                ? ((iSnap.data()?.sessionId as string | undefined) ?? null)
                : null
            );
        });
    })
    .then((storedSid) => {
      if (!storedSid) {
        res
          .status(401)
          .json({ error: "Sesión inválida (sin registro de sessionId)" });
        return;
      }
      if (storedSid !== headerSid) {
        res.status(401).json({ error: "Sesión reemplazada" });
        return;
      }
      next();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[adminSessionGuard] Error:", err);
      res.status(500).json({ error: "Error validando sesión" });
    });
};
