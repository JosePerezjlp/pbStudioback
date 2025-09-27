// src/middleware/authMiddleware.ts
import { createHmac } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import admin from "../config/firebase";

/* ---------- Tipos auxiliares ---------- */
export interface AuthRequest extends Request {
  user?: {
    uid: string;
    role: string;
    isAdmin: boolean;
    branches?: string[]; // Branches permitidas para employees
  };
}

interface FirebaseAuthError {
  code?: string;
  message?: string;
}

interface GympassRequest extends Request {
  gympassEvent?: {
    type: string;
    data: unknown;
  };
  rawBody?: Buffer;
}

/* ---------- Middleware ---------- */
export const verifyToken: RequestHandler = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token no proporcionado" });
    return;
  }

  const idToken = authHeader.slice(7); // quita "Bearer "

  admin
    .auth()
    .verifyIdToken(idToken)
    .then((decoded: DecodedIdToken) => {
      const db = admin.firestore();

      // Consultamos las 3 colecciones. Luego decidimos en orden de prioridad:
      // users -> staff -> instructors
      return Promise.all([
        db.collection("users").doc(decoded.uid).get(),
        db.collection("staff").doc(decoded.uid).get(),
        db.collection("instructors").doc(decoded.uid).get(),
      ]).then(([userSnap, staffSnap, instrSnap]) => {
        let role: string | null = null;
        let branches: string[] = [];

        if (userSnap.exists) {
          const userData = userSnap.data();
          role = (userData?.role as string) ?? "user";
          if (
            role === "admin" ||
            role === "collaborator" ||
            role === "instructor"
          ) {
            branches = (userData?.branches as string[]) || [];
          }
        } else if (staffSnap.exists) {
          const staffData = staffSnap.data();
          role = (staffData?.role as string) ?? "collaborator";
          branches = (staffData?.branches as string[]) || [];
        } else if (instrSnap.exists) {
          const instrData = instrSnap.data();
          role = "instructor";
          const bid = (instrData?.branchId as string) || "";
          branches = bid ? [bid] : [];
        }

        if (!role) {
          res.status(403).json({ error: "Usuario sin perfil registrado" });
          return;
        }

        req.user = {
          uid: decoded.uid,
          role,
          isAdmin: role === "admin",
          // Solo incluir branches si es employee (admin ve todas)
          branches: role === "admin" ? [] : branches,
        };

        next();
      });
    })
    .catch((err: unknown) => {
      const e = err as FirebaseAuthError;
      if (e?.code === "auth/id-token-expired") {
        res.status(401).json({ error: "Token expirado" });
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[verifyToken] Error verificando token:", err);
      res.status(401).json({ error: "Token inválido" });
    });
};

export const verifyGympassSignature: RequestHandler = (
  req: GympassRequest,
  res: Response,
  next: NextFunction
) => {
  const signature = req.headers["x-gympass-signature"] as string;
  const secret = process.env.GYMPASS_TOKEN;
  if (!signature || !secret) {
    res
      .status(401)
      .json({ error: "Firma no proporcionada o secret faltante" });
    return;
  }
  const rawBody = JSON.stringify(req.body);
  const computed = createHmac("sha1", secret)
    .update(rawBody)
    .digest("hex")
    .toUpperCase();
  if (computed !== signature.toUpperCase()) {
    res.status(401).json({ error: "Firma inválida" });
    return;
  }
  req.gympassEvent = {
    type: req.body.event_type,
    data: req.body.event_data,
  };

  next();
};