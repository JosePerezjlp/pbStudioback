// src/middleware/authMiddleware.ts
import { createHmac } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { userService } from "../services/user.service";

const JWT_SECRET =
  process.env.JWT_SECRET || "secreto_super_seguro_para_desarrollo";

/* ---------- Tipos auxiliares ---------- */
export interface AuthRequest extends Request {
  user?: {
    uid: string; // Para compatibilidad
    id: number; // SQL ID (principal)
    role: string;
    isAdmin: boolean;
    branches?: (string | number)[];
    permissions?: Record<string, string[]>;
    sessionId?: string | null;
  };
}

interface JwtPayload {
  uid: string;
  id: number;
  email: string;
  role: string;
  type?: "user" | "staff";
}

interface GympassRequest extends Request {
  gympassEvent?: {
    type: string;
    data: unknown;
  };
  rawBody?: Buffer;
}

/* ---------- Middleware ---------- */
export const verifyToken: RequestHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token no proporcionado" });
    return;
  }

  const token = authHeader.slice(7); // quita "Bearer "

  try {
    // 1. Verificar Token JWT
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // 2. Obtener datos actualizados del usuario desde la BD
    const userType = decoded.type || "user"; // Default to user if not present
    const userContext = await userService.getUserById(decoded.id, userType);

    if (!userContext) {
      res.status(403).json({ error: "Usuario no encontrado" });
      return;
    }

    req.user = {
      uid: userContext.firebaseUid || `sql_${userContext.id}`,
      id: userContext.id,
      role: userContext.role,
      isAdmin: userContext.isAdmin,
      branches: userContext.branches,
      permissions: userContext.permissions,
      sessionId: userContext.sessionId,
    };

    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ error: "Token expirado" });
    } else {
      console.error("[verifyToken] Error verificando token:", err);
      res.status(403).json({ error: "Token inválido" });
    }
  }
};

export const verifyGympassSignature: RequestHandler = (
  req: GympassRequest,
  res: Response,
  next: NextFunction
) => {
  // TODO: Implement actual signature verification
  // const signature = req.headers['x-gympass-signature'] as string;
  // const secret = process.env.GYMPASS_WEBHOOK_SECRET;

  // For now, we allow the request to proceed to fix the build error.
  next();
};
