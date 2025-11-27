import express from "express";
import { forceLogoutController, loginController, logoutController, oauthLoginController } from "../controllers/authController";
import { verifyToken } from "../middleware/authMiddleware";

const router = express.Router();

router.post("/login", loginController);
router.post("/oauth-login", oauthLoginController);
router.post("/logout", verifyToken, logoutController);
router.post("/force-logout", forceLogoutController);

export default router; 
