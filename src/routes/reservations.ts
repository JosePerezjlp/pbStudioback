import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import {
  createReservationController,
  deleteReservationController,
  getAllReservationsController,
  getReservationByIdController,
  updateReservationController,
} from "../controllers/reservationController";

const router = express.Router();

// Rutas públicas para usuarios comunes (ORDEN IMPORTANTE: específicas primero)
router.get("/my", verifyToken, getAllReservationsController); // Obtener reservas del usuario actual
router.post("/", verifyToken, createReservationController); // Crear reserva
router.get("/", verifyToken, adminSessionGuard, checkPermission("clases", "reservaciones"), getAllReservationsController); // Ver todas las reservas (admin)

// Rutas administrativas con validación de sesión
router.get("/:reservationId", verifyToken, adminSessionGuard, getReservationByIdController); // Ver reserva específica
router.put("/:reservationId", verifyToken, adminSessionGuard, updateReservationController); // Actualizar reserva
router.delete("/:reservationId", verifyToken, adminSessionGuard, deleteReservationController); // Cancelar reserva

export default router;
