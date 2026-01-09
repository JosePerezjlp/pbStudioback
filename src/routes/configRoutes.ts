import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  setCancellationTimesController,
  getCancellationTimesController,
  getGeneralSettingsController,
  setGeneralSettingsController,
  setStatisticsConfigController,
  getStatisticsConfigController,
  uploadNoticeMiddleware,
  setNoticeConfigController,
  getNoticeConfigController,
} from "../controllers/configController";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import { checkPermission } from "../middleware/permissionMiddleware";

const router = express.Router();

router.get(
  "/cancellation-times",
  verifyToken,
  checkPermission("configuracion", "editar"),
  getCancellationTimesController
);
router.post(
  "/cancellation-times",
  verifyToken,
  adminSessionGuard,
  checkPermission("configuracion", "editar"),
  setCancellationTimesController
);

router.get(
  "/general-settings",
  verifyToken,
  checkPermission("configuracion", "editar"),
  getGeneralSettingsController
);
router.post(
  "/general-settings",
  verifyToken,
  adminSessionGuard,
  checkPermission("configuracion", "editar"),
  setGeneralSettingsController
);

router.get(
  "/statistics",
  verifyToken,
  checkPermission("configuracion", "editar"),
  getStatisticsConfigController
);
router.post(
  "/statistics",
  verifyToken,
  adminSessionGuard,
  checkPermission("configuracion", "editar"),
  setStatisticsConfigController
);

router.get("/notice", getNoticeConfigController);
router.post(
  "/notice",
  verifyToken,
  adminSessionGuard,
  checkPermission("configuracion", "editar"),
  uploadNoticeMiddleware,
  setNoticeConfigController
);

export default router;
