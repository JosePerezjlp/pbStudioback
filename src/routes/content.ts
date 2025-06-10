// src/routes/content.routes.ts
import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  getWhoWeAreController,
  updateWhoWeAreController,
  getTermsController,
  updateTermsController,
  getPrivacyController,
  updatePrivacyController,
} from "../controllers/content";

const router = express.Router();

// --- Rutas para "Quiénes somos" ---
router.get("/who-we-are", getWhoWeAreController);
router.post("/who-we-are", verifyToken, updateWhoWeAreController);

// --- Rutas para "Términos y condiciones" ---
router.get("/terms", getTermsController);
router.post("/terms", verifyToken, updateTermsController);

// --- Rutas para "Aviso de privacidad" ---
router.get("/privacy", getPrivacyController);
router.post("/privacy", verifyToken, updatePrivacyController);

export default router;
