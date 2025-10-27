import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
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

/* Rutas administrativas (requieren permisos específicos): */
router.get("/", verifyToken, checkPermission("transacciones", "listado"), getAllTransactionsController);
router.get("/caja", verifyToken, checkPermission("transacciones", "caja"), getCajaTransactionsController);
router.get("/:userId", verifyToken, checkPermission("transacciones", "detalle"), getUserTransactionsController);
router.post("/cash", verifyToken, checkPermission("transacciones", "crear"), createCashTransactionController);
router.patch("/:id/cancel", verifyToken, checkPermission("transacciones", "cancelar"), cancelTransactionController);
router.patch("/:id/expiration", verifyToken, checkPermission("transacciones", "editar_fecha_expiracion"), updateTransactionExpirationController);

export default router;
