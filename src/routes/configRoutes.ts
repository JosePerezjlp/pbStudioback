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

const router = express.Router();

router.get("/cancellation-times", verifyToken, getCancellationTimesController);
router.post("/cancellation-times", verifyToken, adminSessionGuard, setCancellationTimesController);

router.get("/general-settings", verifyToken, getGeneralSettingsController);
router.post("/general-settings", verifyToken, adminSessionGuard, setGeneralSettingsController);

router.get("/statistics", verifyToken, getStatisticsConfigController);
router.post("/statistics", verifyToken, adminSessionGuard, setStatisticsConfigController);

router.get("/notice", getNoticeConfigController);
router.post(
  "/notice",
  verifyToken,
  adminSessionGuard,
  uploadNoticeMiddleware,
  setNoticeConfigController
);

export default router;
