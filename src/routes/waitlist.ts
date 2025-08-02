// routes/waitlist.routes.ts
import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createWaitlistController,
  getAllWaitlistsController,
  getWaitlistsByClassController,
  getWaitlistByIdController,
  updateWaitlistController,
  deleteWaitlistController,
} from "../controllers/waitlistController";

const router = express.Router();

// 1) Entrar en lista de espera
router.post("/", verifyToken, createWaitlistController);

// 2) Obtener todas las waitlists
router.get("/", verifyToken, getAllWaitlistsController);

// 3) Obtener waitlists por clase (query param ?classId=...)
router.get("/by-class", verifyToken, getWaitlistsByClassController);

// 4) Obtener una entrada de waitlist por ID
router.get("/:waitlistId", verifyToken, getWaitlistByIdController);

// 5) Actualizar estado de waitlist (accept/reject)
router.put("/:waitlistId", verifyToken, updateWaitlistController);

// 6) Eliminar entrada de waitlist
router.delete("/:waitlistId", verifyToken, deleteWaitlistController);

export default router;
