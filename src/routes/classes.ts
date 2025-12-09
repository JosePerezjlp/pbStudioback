import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  createClassController,
  deleteClassController,
  getAllClassesController,
  getClassByIdController,
  getClassesStatsController,
  updateClassController,
  getFutureClassesController,
  createClassesBulkController,
  getOpenClassesPublicController,
} from "../controllers/classController";
import { adminSessionGuard } from "../middleware/adminSessionGuard";

const router = express.Router();

// Públicas (usuarios autenticados pueden ver clases)
router.get("/", getAllClassesController);
router.get("/stats", getClassesStatsController);
router.get("/future", getFutureClassesController);
router.get("/open", getOpenClassesPublicController);
router.get("/:classId", verifyToken, getClassByIdController);

// Protegidas con permisos específicos y sesión única (solo para administradores/staff)
router.post("/", verifyToken, adminSessionGuard, checkPermission("clases", "crear"), createClassController);
router.post(
  "/bulk",
  verifyToken,
  adminSessionGuard,
  checkPermission("clases", "crear"),
  createClassesBulkController
);
router.put("/:classId", verifyToken, adminSessionGuard, checkPermission("clases", "editar"), updateClassController);
router.delete("/:classId", verifyToken, adminSessionGuard, checkPermission("clases", "cancelar"), deleteClassController);

export default router;
