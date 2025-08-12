import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createClassController,
  deleteClassController,
  getAllClassesController,
  getClassByIdController,
  updateClassController,
} from "../controllers/classController";
import { adminSessionGuard } from "../middleware/adminSessionGuard";

const router = express.Router();

// Pública (aunque está protegida con verifyToken)
router.get("/", getAllClassesController);

// Protegidas
router.get("/:classId", verifyToken, adminSessionGuard, getClassByIdController);
router.post("/", verifyToken, adminSessionGuard, createClassController);
router.put("/:classId", verifyToken, adminSessionGuard, updateClassController);
router.delete("/:classId", verifyToken, adminSessionGuard, deleteClassController);

export default router;
