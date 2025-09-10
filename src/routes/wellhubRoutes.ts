import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createCategoryController,
  createSlotController,
  getClassesController,
  getProductsController,
  getUserChecking,
} from "../controllers/wellHubController";

const router = express.Router();

/* ============================================================
   WELLHUB – check-in de usuario
   ============================================================ */
router.get("/checking/:userId", verifyToken, getUserChecking);

/* ============================================================
   GYMPASS – productos y clases
   ============================================================ */
router.get("/:gymId/products", verifyToken, getProductsController);
router.get("/:gymId/classes", verifyToken, getClassesController);

/* ============================================================
   GYMPASS – crear slot y categorías
   ============================================================ */
router.post(
  "/:gymId/classes/:classId/slots",
  verifyToken,
  createSlotController
);
router.post("/:gymId/classes", verifyToken, createCategoryController);

/* ============================================================
   GYMPASS – simular check-in
   ============================================================ */
router.get("/cheking/:userId", verifyToken, getUserChecking);

export default router;
