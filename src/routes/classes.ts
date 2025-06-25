import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createClassController,
  deleteClassController,
  getAllClassesController,
  getClassByIdController,
  updateClassController,
} from "../controllers/classController";

const router = express.Router();

// Pública (aunque está protegida con verifyToken)
router.get("/", verifyToken, getAllClassesController);

// Protegidas
router.get("/:classId", verifyToken, getClassByIdController);
router.post("/", verifyToken, createClassController);
router.put("/:classId", verifyToken, updateClassController);
router.delete("/:classId", verifyToken, deleteClassController);

export default router;
