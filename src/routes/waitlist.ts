// routes/waitlist.routes.ts
import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
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

// Rutas administrativas (requieren permisos específicos)
router.get("/", verifyToken, checkPermission("clases", "lista_espera"), getAllWaitlistsController);

// 3) Obtener waitlists por clase (query param ?classId=...)
router.get("/by-class", verifyToken, getWaitlistsByClassController);

// 4) Obtener una entrada de waitlist por ID
router.get("/:waitlistId", verifyToken, getWaitlistByIdController);

// 5) Actualizar estado de waitlist (accept/reject)
router.put("/:waitlistId", verifyToken, updateWaitlistController);

// 6) Eliminar entrada de waitlist
router.delete("/:waitlistId", verifyToken, deleteWaitlistController);

export default router;
