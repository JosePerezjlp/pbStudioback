import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createCouponController,
  getAllCouponsController,
  getCouponByIdController,
  updateCouponController,
  deleteCouponController,
  validateCouponController,
} from "../controllers/couponController";

const router = express.Router();

// Ruta pública para validar cupón (sin autenticación)
router.get("/validate", validateCouponController);

router.post("/", verifyToken, createCouponController);
router.get("/", verifyToken, getAllCouponsController);
router.get("/:couponId", verifyToken, getCouponByIdController);
router.put("/:couponId", verifyToken, updateCouponController);
router.delete("/:couponId", verifyToken, deleteCouponController);

export default router;
