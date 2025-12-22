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

      const { role, permissions = {} } = user;

      // Los admins tienen todos los permisos
      if (role === "admin" || user.isAdmin) {
        next();
        return;
      }

      // Para staff (colaborador / instructor), verificar permisos específicos
      if (
        role === "collaborator" ||
        role === "instructor" ||
        role === "reception" ||
        role === "staff"
      ) {
        const modulePermissions = permissions[module] || [];

        if (modulePermissions.includes(action)) {
          next();
          return;
        }

        res.status(403).json({
          error: "Permisos insuficientes",
          required: { module, action },
          userPermissions: permissions,
        });
        return;
      }

      // Otros roles no tienen permisos
      res.status(403).json({ error: "Rol sin permisos" });
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

      const { role, permissions = {} } = user;

      // Los admins tienen todos los permisos
      if (role === "admin" || user.isAdmin) {
        next();
        return;
      }

      // Para staff (colaborador / instructor), verificar al menos uno de los permisos
      if (
        role === "collaborator" ||
        role === "instructor" ||
        role === "reception" ||
        role === "staff"
      ) {
        const hasPermission = permissionPairs.some(([module, action]) => {
          const modulePermissions = permissions[module] || [];
          return modulePermissions.includes(action);
        });

        if (hasPermission) {
          next();
          return;
        }

        res.status(403).json({
          error: "Permisos insuficientes",
          required: permissionPairs,
          userPermissions: permissions,
        });
        return;
      }

      res.status(403).json({ error: "Rol sin permisos" });
    } catch (error) {
      console.error("Error validando permisos:", error);
      res.status(500).json({ error: "Error interno validando permisos" });
    }
  };
};
