import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
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

// Protegidas (requieren permisos de "sucursales")
router.get(
  "/:branchId",
  verifyToken,
  checkPermission("sucursales", "listado"),
  getBranchByIdController
);
router.post(
  "/",
  verifyToken,
  checkPermission("sucursales", "crear"),
  createBranchController
);
router.put(
  "/:branchId",
  verifyToken,
  checkPermission("sucursales", "editar"),
  updateBranchController
);
router.delete(
  "/:branchId",
  verifyToken,
  checkPermission("sucursales", "editar"),
  deleteBranchController
);

export default router;
