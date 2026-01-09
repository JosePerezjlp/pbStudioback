import express from "express";

import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  createClassroomController,
  deleteClassroomController,
  getAllClassroomsController,
  getClassroomByIdController,
  updateClassroomController,
  getClassroomsByBranchController,
} from "../controllers/salonsController";

const router = express.Router();

// Pública
router.get("/", getAllClassroomsController);
router.get("/branch/:branchId", getClassroomsByBranchController);

// Protegidas (requieren permisos de "salones")
router.get(
  "/:classroomId",
  verifyToken,
  checkPermission("salones", "listado"),
  getClassroomByIdController
);
router.post(
  "/",
  verifyToken,
  checkPermission("salones", "crear"),
  createClassroomController
);
router.put(
  "/:classroomId",
  verifyToken,
  checkPermission("salones", "editar"),
  updateClassroomController
);
router.delete(
  "/:classroomId",
  verifyToken,
  checkPermission("salones", "editar"),
  deleteClassroomController
);

export default router;
