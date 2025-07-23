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

const router = express.Router();

router.get("/cancellation-times", verifyToken, getCancellationTimesController);
router.post("/cancellation-times", verifyToken, setCancellationTimesController);

router.get("/general-settings", verifyToken, getGeneralSettingsController);
router.post("/general-settings", verifyToken, setGeneralSettingsController);

router.get("/statistics", verifyToken, getStatisticsConfigController);
router.post("/statistics", verifyToken, setStatisticsConfigController);

router.get("/notice", verifyToken, getNoticeConfigController);
router.post(
  "/notice",
  verifyToken,
  uploadNoticeMiddleware,
  setNoticeConfigController
);

export default router;
