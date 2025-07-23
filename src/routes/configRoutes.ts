import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  setCancellationTimesController,
  getCancellationTimesController,
  getGeneralSettingsController,
  setGeneralSettingsController,
} from "../controllers/configController";

const router = express.Router();

router.get("/cancellation-times", verifyToken, getCancellationTimesController);
router.post("/cancellation-times", verifyToken, setCancellationTimesController);
router.get("/general-settings", verifyToken, getGeneralSettingsController);
router.post("/general-settings", verifyToken, setGeneralSettingsController);

export default router;
