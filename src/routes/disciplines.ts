import express from "express";

import { verifyToken } from "../middleware/authMiddleware";
import {
  createDisciplineController,
  deleteDisciplineController,
  getAllDisciplinesController,
  getDisciplineByIdController,
  updateDisciplineController,
} from "../controllers/disciplinesController.";

const router = express.Router();

// Pública (puedes protegerlas todas si quieres)
router.get("/", getAllDisciplinesController);

// Protegidas
router.get("/:disciplineId", verifyToken, getDisciplineByIdController);
router.post("/", verifyToken, createDisciplineController);
router.put("/:disciplineId", verifyToken, updateDisciplineController);
router.delete("/:disciplineId", verifyToken, deleteDisciplineController);

export default router;
