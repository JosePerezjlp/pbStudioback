import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createPayPalOrderController,
  capturePayPalOrderController,
  getAllTransactionsController,
} from "../controllers/paypalController";

const router = express.Router();

// Crear orden de pago (requiere autenticación)
router.post("/create-order", verifyToken, createPayPalOrderController);
// router.post("/create-order", createPayPalOrderController);

// Capturar pago aprobado por el cliente (requiere autenticación)
router.post("/capture-order", verifyToken, capturePayPalOrderController);

// Obtener todas las transacciones guardadas (requiere autenticación)
router.get("/transactions", verifyToken, getAllTransactionsController);

export default router;
