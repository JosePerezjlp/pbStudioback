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
  getRankingsController,
  getRecentTransactionsController,
  deleteOldTransactionsController,
} from "../controllers/transactionController";
// Resumen de transacciones (solo admins)

const router = express.Router();

/* Rutas públicas para usuarios comunes: */
router.get("/my", verifyToken, getUserTransactionsController); // Obtener transacciones del usuario actual

/* Rutas administrativas (requieren permisos específicos y validación de sesión): */
router.get(
  "/",
  verifyToken,
  adminSessionGuard,
  checkPermission("transacciones", "listado"),
  getAllTransactionsController
);
router.get(
  "/export",
  verifyToken,
  adminSessionGuard,
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
  adminSessionGuard,
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
  "/:userId",
  verifyToken,
  adminSessionGuard,
  checkPermission("transacciones", "detalle"),
  getUserTransactionsController
);
router.post(
  "/cash",
  verifyToken,
  adminSessionGuard,
  checkPermission("transacciones", "crear"),
  createCashTransactionController
);
router.patch(
  "/:id/cancel",
  verifyToken,
  adminSessionGuard,
  checkPermission("transacciones", "cancelar"),
  cancelTransactionController
);
router.patch(
  "/:id/expiration",
  verifyToken,
  adminSessionGuard,
  checkPermission("transacciones", "editar_fecha_expiracion"),
  updateTransactionExpirationController
);

router.delete(
  "/cleanup",
  verifyToken,
  adminSessionGuard,
  checkPermission("transacciones", "eliminar"), // Asumiendo que existe este permiso o similar, sino usar uno general de admin
  deleteOldTransactionsController
);

export default router;
