import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  setCancellationTimesController,
  getCancellationTimesController,
  getGeneralSettingsController,
  setGeneralSettingsController,
  setStatisticsConfigController,
  getStatisticsConfigController,
} from "../controllers/configController";

const router = express.Router();

router.get("/cancellation-times", verifyToken, getCancellationTimesController);
router.post("/cancellation-times", verifyToken, setCancellationTimesController);
router.get("/general-settings", verifyToken, getGeneralSettingsController);
router.post("/general-settings", verifyToken, setGeneralSettingsController);
router.post("/statistics", setStatisticsConfigController);
router.get("/statistics", getStatisticsConfigController);

export default router;
