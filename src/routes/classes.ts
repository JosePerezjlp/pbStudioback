import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { optionalAuth } from "../middleware/optionalAuth";
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
  getAvailableClassesByBranchController,
  deleteOldClassesController,
  getAllUnlimitedClassesController,
} from "../controllers/classController";
import { getClassesForReservationController } from "../controllers/reservationClassController";
import { adminSessionGuard } from "../middleware/adminSessionGuard";

const router = express.Router();

// Públicas (con autenticación opcional para filtros basados en rol)
router.get("/", optionalAuth, getAllClassesController);
router.get("/stats", getClassesStatsController);
router.get("/future", getFutureClassesController);
router.get("/open", getOpenClassesPublicController);
router.get("/available", getAvailableClassesByBranchController);
router.get("/for-reservation", verifyToken, getClassesForReservationController);
router.get("/all-unlimited", verifyToken, getAllUnlimitedClassesController);
router.get("/:classId", verifyToken, getClassByIdController);

// Protegidas con permisos específicos (solo para administradores/staff)
router.post(
  "/",
  verifyToken,
  checkPermission("clases", "crear"),
  createClassController
);
router.post(
  "/bulk",
  verifyToken,
  checkPermission("clases", "crear"),
  createClassesBulkController
);
router.put(
  "/:classId",
  verifyToken,
  checkPermission("clases", "editar"),
  updateClassController
);
router.delete(
  "/:classId",
  verifyToken,
  checkPermission("clases", "cancelar"),
  deleteClassController
);

router.delete(
  "/cleanup/old",
  verifyToken,
  checkPermission("clases", "cancelar"),
  deleteOldClassesController
);

export default router;
