import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { adminSessionGuard } from "../middleware/adminSessionGuard";
import {
  createCashTransactionController,
  getAllTransactionsController,
  exportTransactionsController,
  getUserTransactionsController,
  // updateTransactionStatusController, // Removed unused import
  cancelTransactionController,
  updateTransactionExpirationController,
  getCajaTransactionsController,
  getTransactionSummaryController,
  getTransactionTotalController,
  getRankingsController,
  getRecentTransactionsController,
  deleteOldTransactionsController,
  getTransactionByIdController,
} from "../controllers/transactionController";
// Resumen de transacciones (solo admins)

const router = express.Router();

/* Rutas públicas para usuarios comunes: */
router.get("/my", verifyToken, getUserTransactionsController); // Obtener transacciones del usuario actual

/* Rutas administrativas (requieren permisos específicos): */
router.get(
  "/total",
  verifyToken,
  checkPermission("transacciones", "listado"),
  getTransactionTotalController
);
router.get(
  "/",
  verifyToken,
  checkPermission("transacciones", "listado"),
  getAllTransactionsController
);
router.get(
  "/export",
  verifyToken,
  checkPermission("transacciones", "exportar"),
  exportTransactionsController
);
router.get(
  "/recent",
  verifyToken,
  checkPermission("transacciones", "listado"),
  getRecentTransactionsController
);
router.get(
  "/caja",
  verifyToken,
  checkPermission("transacciones", "caja"),
  getCajaTransactionsController
);
router.get(
  "/summary",

  // checkPermission("transacciones", "listado"),
  getTransactionSummaryController
);
router.get("/rankings", getRankingsController);
router.get(
  "/user/:userId",
  verifyToken,
  checkPermission("transacciones", "detalle"),
  getUserTransactionsController
);
router.post(
  "/cash",
  verifyToken,
  checkPermission("transacciones", "crear"),
  createCashTransactionController
);
router.patch(
  "/:id/cancel",
  verifyToken,
  checkPermission("transacciones", "cancelar"),
  cancelTransactionController
);
router.patch(
  "/:id/expiration",
  verifyToken,
  checkPermission("transacciones", "editar_fecha_expiracion"),
  updateTransactionExpirationController
);

router.delete(
  "/cleanup",
  verifyToken,
  checkPermission("transacciones", "eliminar"), // Asumiendo que existe este permiso o similar, sino usar uno general de admin
  deleteOldTransactionsController
);

// Detalle de transacción por ID (debe ir al final para no interferir con rutas estáticas)
router.get(
  "/:id",
  verifyToken,
  checkPermission("transacciones", "detalle"),
  getTransactionByIdController
);

export default router;
