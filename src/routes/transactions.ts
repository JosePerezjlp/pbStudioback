import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createCashTransactionController,
  getAllTransactionsController,
  getUserTransactionsController,
  updateTransactionStatusController,
} from "../controllers/transactionController";

const router = express.Router();

/* Solo usuarios autenticados: */
router.post("/cash", verifyToken, createCashTransactionController);
router.get("/", verifyToken, getAllTransactionsController);
router.get("/user/:userId", verifyToken, getUserTransactionsController);
router.patch("/:id", verifyToken, updateTransactionStatusController);

export default router;
