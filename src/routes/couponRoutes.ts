import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  createCouponController,
  getAllCouponsController,
  getCouponByIdController,
  updateCouponController,
  deleteCouponController,
  getCouponsWithRemainingUsesController,
} from "../controllers/couponController";

const router = express.Router();

// La ruta /validate está definida públicamente en index.ts para evitar duplicación
// router.get("/validate", validateCouponController); // Duplicado - ya existe en index.ts

router.post(
  "/",
  verifyToken,
  checkPermission("cupones", "crear"),
  createCouponController
);
router.get(
  "/",
  verifyToken,
  checkPermission("cupones", "listado"),
  getAllCouponsController
);
router.get(
  "/available",
  verifyToken,
  checkPermission("cupones", "listado"),
  getCouponsWithRemainingUsesController
);
router.get(
  "/:couponId",
  verifyToken,
  checkPermission("cupones", "detalle"),
  getCouponByIdController
);
router.put(
  "/:couponId",
  verifyToken,
  checkPermission("cupones", "editar"),
  updateCouponController
);
router.delete(
  "/:couponId",
  verifyToken,
  checkPermission("cupones", "editar"),
  deleteCouponController
);

export default router;
