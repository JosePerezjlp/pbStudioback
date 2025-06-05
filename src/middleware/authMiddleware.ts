import { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    role: string;
    isAdmin: boolean;
  };
}

export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Token no proporcionado" });

      return;
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(decodedToken.uid)
      .get();
    const userData = userDoc.data();

    req.user = {
      uid: decodedToken.uid,
      role: userData?.role ?? "user",
      isAdmin: userData?.role === "admin",
    };

    next();
  } catch (error) {
    console.error("Error de autenticación:", error);
    res.status(401).json({ error: "Token inválido" });
  }
};
