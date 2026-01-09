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
  getHomeContent,
  updateHomeContent,
} from "../controllers/content";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import { checkPermission } from "../middleware/permissionMiddleware";

const router = express.Router();

// --- Rutas para "Quiénes somos" ---
router.get("/who-we-are", getWhoWeAreController);
router.post(
  "/who-we-are",
  verifyToken,
  adminSessionGuard,
  checkPermission("contenido", "editar"),
  updateWhoWeAreController
);

// --- Rutas para "Términos y condiciones" ---
router.get("/terms", getTermsController);
router.post(
  "/terms",
  verifyToken,
  adminSessionGuard,
  checkPermission("contenido", "editar"),
  updateTermsController
);

// --- Rutas para "Aviso de privacidad" ---
router.get("/privacy", getPrivacyController);
router.post(
  "/privacy",
  verifyToken,
  adminSessionGuard,
  checkPermission("contenido", "editar"),
  updatePrivacyController
);

router.get("/home", getHomeContent);
router.post(
  "/home",
  verifyToken,
  adminSessionGuard,
  checkPermission("contenido", "editar"),
  ...updateHomeContent
);

export default router;
