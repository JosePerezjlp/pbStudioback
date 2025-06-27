import express from "express";

import { verifyToken } from "../middleware/authMiddleware";
import {
  createClassroomController,
  deleteClassroomController,
  getAllClassroomsController,
  getClassroomByIdController,
  updateClassroomController,
} from "../controllers/salonsController";

const router = express.Router();

// Pública
router.get("/", getAllClassroomsController);

// Protegidas
router.get("/:classroomId", verifyToken, getClassroomByIdController);
router.post("/", verifyToken, createClassroomController);
router.put("/:classroomId", verifyToken, updateClassroomController);
router.delete("/:classroomId", verifyToken, deleteClassroomController);

export default router;
