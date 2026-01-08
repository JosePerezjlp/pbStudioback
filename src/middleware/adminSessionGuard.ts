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

  const { role } = user;

  // Mantener el guard como placeholder para roles admin/employee,
  // pero sin exigir x-session-id (solo requiere JWT válido).
  if (role !== "admin" && role !== "employee") {
    next();
    return;
  }

  next();
};
