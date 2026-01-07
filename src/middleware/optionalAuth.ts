// src/middleware/optionalAuth.ts
import type { Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { userService } from "../services/user.service";
import { AuthRequest } from "./authMiddleware";

const JWT_SECRET =
  process.env.JWT_SECRET || "secreto_super_seguro_para_desarrollo";

interface JwtPayload {
  uid: string;
  id: number;
  email: string;
  role: string;
  type?: "user" | "staff";
}

/**
 * Middleware de autenticación opcional
 * Si hay token, lo valida y lo agrega a req.user
 * Si NO hay token o es inválido, simplemente continúa sin error
 */
export const optionalAuth: RequestHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization ?? "";

  // Si no hay token, continuar sin usuario
  if (!authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    // 1. Verificar Token JWT
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // 2. Obtener datos actualizados del usuario desde la BD
    const userType = decoded.type || "user";
    const userContext = await userService.getUserById(decoded.id, userType);

    if (userContext) {
      req.user = {
        uid: `sql_${userContext.id}`,
        id: userContext.id,
        role: userContext.role,
        isAdmin: userContext.isAdmin,
        branches: userContext.branches,
        permissions: userContext.permissions,
        sessionId: userContext.sessionId,
      };
    }
  } catch (err) {
    // Token inválido o expirado - simplemente continuar sin usuario
    console.log(
      "[optionalAuth] Token inválido o expirado, continuando sin autenticación"
    );
  }

  next();
};
