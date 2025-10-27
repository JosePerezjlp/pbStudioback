import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createCouponController,
  getAllCouponsController,
  getCouponByIdController,
  updateCouponController,
  deleteCouponController,
} from "../controllers/couponController";

const router = express.Router();

// La ruta /validate está definida públicamente en index.ts para evitar duplicación
// router.get("/validate", validateCouponController); // Duplicado - ya existe en index.ts

router.post("/", verifyToken, createCouponController);
router.get("/", verifyToken, getAllCouponsController);
router.get("/:couponId", verifyToken, getCouponByIdController);
router.put("/:couponId", verifyToken, updateCouponController);
router.delete("/:couponId", verifyToken, deleteCouponController);

export default router;
