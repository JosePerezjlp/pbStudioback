import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
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
router.get("/", verifyToken, checkPermission("clases", "reservaciones"), getAllReservationsController); // Ver todas las reservas (admin)

// Rutas con parámetros (después de las específicas)
router.get("/:reservationId", verifyToken, getReservationByIdController); // Ver reserva específica
router.put("/:reservationId", verifyToken, updateReservationController); // Actualizar reserva
router.delete("/:reservationId", verifyToken, deleteReservationController); // Cancelar reserva

export default router;
