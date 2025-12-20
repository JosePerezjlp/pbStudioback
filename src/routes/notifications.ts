import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import { checkPermission } from "../middleware/permissionMiddleware";
import { deleteOldNotificationsController } from "../controllers/notificationController";

const router = express.Router();

// Borrar notificaciones antiguas (Admin + Permiso específico)
router.delete(
  "/cleanup",
  verifyToken,
  adminSessionGuard,
  checkPermission("notificaciones", "borrar"),
  deleteOldNotificationsController
);

export default router;
