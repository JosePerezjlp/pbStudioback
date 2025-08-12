import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { createBranchController, deleteBranchController, getAllBranchesController, getBranchByIdController, updateBranchController } from "../controllers/branchController";
import { adminSessionGuard } from "../middleware/adminSessionGuard";


const router = express.Router();

// Pública
router.get("/", getAllBranchesController);

// Protegidas
router.get("/:branchId", verifyToken, adminSessionGuard, getBranchByIdController);
router.post("/", verifyToken, adminSessionGuard, createBranchController);
router.put("/:branchId", verifyToken, adminSessionGuard, updateBranchController);
router.delete("/:branchId", verifyToken, adminSessionGuard, deleteBranchController);

export default router;
