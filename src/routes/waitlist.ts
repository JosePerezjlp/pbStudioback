// routes/waitlist.routes.ts
import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import {
  createWaitlistController,
  getAllWaitlistsController,
  getWaitlistsByClassController,
  getWaitlistByIdController,
  updateWaitlistController,
  deleteWaitlistController,
} from "../controllers/waitlistController";

const router = express.Router();

// Rutas públicas para usuarios comunes
router.post("/", verifyToken, createWaitlistController); // Entrar en lista de espera
router.get("/my", verifyToken, getAllWaitlistsController); // Obtener waitlists del usuario actual

// Rutas administrativas (requieren permisos específicos y validación de sesión)
router.get("/", verifyToken, adminSessionGuard, checkPermission("clases", "lista_espera"), getAllWaitlistsController);

// 3) Obtener waitlists por clase (query param ?classId=...)
router.get("/by-class", verifyToken, adminSessionGuard, getWaitlistsByClassController);

// 4) Obtener una entrada de waitlist por ID
router.get("/:waitlistId", verifyToken, adminSessionGuard, getWaitlistByIdController);

// 5) Actualizar estado de waitlist (accept/reject)
router.put("/:waitlistId", verifyToken, adminSessionGuard, updateWaitlistController);

// 6) Eliminar entrada de waitlist
router.delete("/:waitlistId", verifyToken, adminSessionGuard, deleteWaitlistController);

export default router;
