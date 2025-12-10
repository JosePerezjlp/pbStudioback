// import express from "express";
// import { verifyGympassSignature, verifyToken } from "../middleware/authMiddleware";
// import {
//   createCategoryController,
//   createSlotController,
//   getClassesController,
//   getProductsController,
//   getUserChecking,
//   updateBookingController,
//   wellhubWebhookController,
// } from "../controllers/wellHubController";

// const router = express.Router();

// /* ============================================================
//    WELLHUB – check-in de usuario
//    ============================================================ */
// router.get("/checking/:userId", verifyToken, getUserChecking);
// router.post("/check-in-webhook",verifyGympassSignature, wellhubWebhookController);

// /* ============================================================
//    GYMPASS – productos y clases
//    ============================================================ */
// router.get("/:gymId/products", verifyToken, getProductsController);
// router.get("/:gymId/classes", verifyToken, getClassesController);

// /* ============================================================
//    GYMPASS – crear slot y categorías
//    ============================================================ */
// router.post(
//   "/:gymId/classes/:classId/slots",
//   verifyToken,
//   createSlotController
// );
// // router.post("/:gymId/classes", verifyToken, createCategoryController);
// router.post("/:gymId/classes", createCategoryController);

// /* ============================================================
//    GYMPASS – simular check-in
//    ============================================================ */
// router.get("/cheking/:userId", verifyToken, getUserChecking);
// /* ============================================================
//    GYMPASS – actualizar reserva (booking)
//    ============================================================ */
// router.put("/reserve/:classId", verifyToken, updateBookingController);

// export default router;
