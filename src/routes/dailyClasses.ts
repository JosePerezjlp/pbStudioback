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

const router = express.Router();

// Rutas específicas para "clases por día" con permisos específicos
router.get("/", verifyToken, checkPermission("clases_por_dia", "listado"), getAllClassesController);
router.get("/:classId", verifyToken, checkPermission("clases_por_dia", "listado"), getClassByIdController);
router.post("/", verifyToken, checkPermission("clases_por_dia", "crear"), createClassController);
router.put("/:classId", verifyToken, checkPermission("clases_por_dia", "editar"), updateClassController);
router.delete("/:classId", verifyToken, checkPermission("clases_por_dia", "editar"), deleteClassController);

export default router;
