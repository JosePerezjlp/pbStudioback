import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  setCancellationTimesController,
  getCancellationTimesController,
} from "../controllers/configController";

const router = express.Router();

router.get("/cancellation-times", verifyToken, getCancellationTimesController);
router.post("/cancellation-times", verifyToken, setCancellationTimesController);

export default router;
