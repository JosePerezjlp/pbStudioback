import express from "express";
import {
  requestResetCode,
  verifyResetCode,
  confirmPasswordReset,
} from "../controllers/passwordResetController";

const router = express.Router();

router.post("/request-code", requestResetCode);      // { email }
router.post("/verify-code", verifyResetCode);        // { email, code }
router.post("/confirm", confirmPasswordReset);       // { email, code, newPassword }

export default router;
