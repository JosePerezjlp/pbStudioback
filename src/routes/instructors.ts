import express from "express";
import {
  createInstructorController,
  deleteInstructorController,
  getAllInstructorsController,
  getInstructorByIdController,
  updateInstructorController,
} from "../controllers/instructorController";
import { verifyToken } from "../middleware/authMiddleware";

const router = express.Router();

// Pública
router.get("/", getAllInstructorsController);

// Protegidas
router.get("/:instructorId", verifyToken, getInstructorByIdController);
router.post("/", verifyToken, createInstructorController);
router.put("/:instructorId", verifyToken, updateInstructorController);
router.delete("/:instructorId", verifyToken, deleteInstructorController);

export default router;
