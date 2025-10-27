import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import {
  createCashTransactionController,
  getAllTransactionsController,
  getUserTransactionsController,
  updateTransactionStatusController,
  cancelTransactionController,
  updateTransactionExpirationController,
  getCajaTransactionsController,
} from "../controllers/transactionController";

const router = express.Router();

/* Rutas públicas para usuarios comunes: */
router.get("/my", verifyToken, getUserTransactionsController); // Obtener transacciones del usuario actual

/* Rutas administrativas (requieren permisos específicos y validación de sesión): */
router.get("/", verifyToken, adminSessionGuard, checkPermission("transacciones", "listado"), getAllTransactionsController);
router.get("/caja", verifyToken, adminSessionGuard, checkPermission("transacciones", "caja"), getCajaTransactionsController);
router.get("/:userId", verifyToken, adminSessionGuard, checkPermission("transacciones", "detalle"), getUserTransactionsController);
router.post("/cash", verifyToken, adminSessionGuard, checkPermission("transacciones", "crear"), createCashTransactionController);
router.patch("/:id/cancel", verifyToken, adminSessionGuard, checkPermission("transacciones", "cancelar"), cancelTransactionController);
router.patch("/:id/expiration", verifyToken, adminSessionGuard, checkPermission("transacciones", "editar_fecha_expiracion"), updateTransactionExpirationController);

export default router;
