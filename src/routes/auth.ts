import express from "express";
import { forceLogoutController, loginController, logoutController } from "../controllers/authController";
import { verifyToken } from "../middleware/authMiddleware";

const router = express.Router();

router.post("/login", loginController);
router.post("/logout", verifyToken, logoutController);
router.post("/force-logout", forceLogoutController);

export default router; 