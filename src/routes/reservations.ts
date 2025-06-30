import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createReservationController,
  deleteReservationController,
  getAllReservationsController,
  getReservationByIdController,
  updateReservationController,
} from "../controllers/reservationController";

const router = express.Router();

// Puedes dejar este público o protegido (según tu caso)
router.get("/", getAllReservationsController);

// Protegidas
router.get("/:reservationId", verifyToken, getReservationByIdController);
router.post("/", verifyToken, createReservationController);
router.put("/:reservationId", verifyToken, updateReservationController);
router.delete("/:reservationId", verifyToken, deleteReservationController);

export default router;
