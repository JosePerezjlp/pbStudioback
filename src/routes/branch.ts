import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  createBranchController,
  deleteBranchController,
  getAllBranchesController,
  getBranchByIdController,
  updateBranchController,
} from "../controllers/branchController";

const router = express.Router();

// Pública
router.get("/", getAllBranchesController);

// Protegidas (solo JWT, sin x-session-id)
router.get("/:branchId", verifyToken, getBranchByIdController);
router.post("/", verifyToken, createBranchController);
router.put("/:branchId", verifyToken, updateBranchController);
router.delete("/:branchId", verifyToken, deleteBranchController);

export default router;
