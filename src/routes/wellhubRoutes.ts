import express from "express";
import {
  verifyGympassSignature,
  verifyToken,
} from "../middleware/authMiddleware";
import {
  createCategoryController,
  createSlotController,
  getClassesController,
  getProductsController,
  getUserChecking,
  wellhubBookingWebhookController,
  updateBookingController,
  wellhubWebhookController,
} from "../controllers/wellHubController";

const router = express.Router();

router.get("/checking/:userId", verifyToken, getUserChecking);
router.post(
  "/check-in-webhook",
  verifyGympassSignature,
  wellhubWebhookController
);

router.post(
  "/booking-webhook",
  verifyGympassSignature,
  wellhubBookingWebhookController
);

router.get("/:gymId/products", verifyToken, getProductsController);
router.get("/:gymId/classes", verifyToken, getClassesController);

// DESHABILITADO TEMPORALMENTE: creación de slots y categorías de Wellhub
// router.post(
//   "/:gymId/classes/:classId/slots",
//   verifyToken,
//   createSlotController
// );
// router.post("/:gymId/classes", verifyToken, createCategoryController);

router.get("/cheking/:userId", verifyToken, getUserChecking);
router.put("/reserve/:classId", verifyToken, updateBookingController);

export default router;
