// src/middleware/permissionMiddleware.ts
import type { RequestHandler, Response, NextFunction } from "express";
import { AuthRequest } from "./authMiddleware";

/**
 * Middleware para validar permisos específicos de staff
 * Uso: checkPermission("reservaciones", "crear")
 */
export const checkPermission = (
  module: string,
  action: string
): RequestHandler => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { user } = req;

      if (!user) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }
      // Validación de permisos desactivada: cualquier usuario autenticado puede continuar
      // (se mantiene solo el chequeo de autenticación básica).
      next();
    } catch (error) {
      console.error("Error validando permisos:", error);
      res.status(500).json({ error: "Error interno validando permisos" });
    }
  };
};

/**
 * Middleware para validar múltiples permisos (OR)
 * Uso: checkAnyPermission([["reservaciones", "crear"], ["reservaciones", "cancelar"]])
 */
export const checkAnyPermission = (
  permissionPairs: Array<[string, string]>
): RequestHandler => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { user } = req;

      if (!user) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }
      // Validación de permisos desactivada: cualquier usuario autenticado puede continuar
      next();
    } catch (error) {
      console.error("Error validando permisos:", error);
      res.status(500).json({ error: "Error interno validando permisos" });
    }
  };
};
