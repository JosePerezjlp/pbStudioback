import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  createClassController,
  deleteClassController,
  getAllClassesController,
  getClassByIdController,
  updateClassController,
} from "../controllers/classController";
import { adminSessionGuard } from "../middleware/adminSessionGuard";

const router = express.Router();

// Públicas (usuarios autenticados pueden ver clases)
router.get("/", getAllClassesController);
router.get("/:classId", verifyToken, getClassByIdController);

// Protegidas con permisos específicos (solo para administradores/staff)
router.post("/", verifyToken, checkPermission("clases", "crear"), createClassController);
router.put("/:classId", verifyToken, checkPermission("clases", "editar"), updateClassController);
router.delete("/:classId", verifyToken, checkPermission("clases", "cancelar"), deleteClassController);

export default router;
