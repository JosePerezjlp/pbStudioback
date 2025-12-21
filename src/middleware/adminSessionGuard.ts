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

  const { role, sessionId } = user;

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

  if (!sessionId) {
    res.status(401).json({ error: "Sesión inválida (sin registro de sessionId)" });
    return;
  }

  if (sessionId !== headerSid) {
    res.status(401).json({ error: "Sesión reemplazada" });
    return;
  }

  next();
};
