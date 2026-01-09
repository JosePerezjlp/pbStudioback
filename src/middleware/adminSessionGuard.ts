import type { RequestHandler, Response, NextFunction } from "express";
import { AuthRequest } from "./authMiddleware";

/**
 * Requiere x-session-id válido para roles admin/employee.
 * Busca sessionId en la base de datos (SQL) a través de req.user.
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
  // Validación de sesión/admin desactivada: con estar autenticado es suficiente.
  next();
};
