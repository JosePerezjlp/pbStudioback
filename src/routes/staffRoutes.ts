import express from "express";

import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  createStaffUser,
  changeStaffPassword,
  deleteStaffUser,
  getAllStaffUsers,
  getStaffUserById,
  updateStaffUser,
  checkStaffEmailExists,
} from "../controllers/staff.controller";

const router = express.Router();

// Gestión de staff: requiere permisos de módulo "staff"
router.get(
  "/check-email",
  verifyToken,
  checkPermission("staff", "crear"),
  checkStaffEmailExists
);
router.post(
  "/",
  verifyToken,
  checkPermission("staff", "crear"),
  createStaffUser
);
router.put(
  "/:id",
  verifyToken,
  checkPermission("staff", "editar"),
  updateStaffUser
);
router.delete(
  "/:id",
  verifyToken,
  checkPermission("staff", "editar"),
  deleteStaffUser
);
router.get(
  "/",
  verifyToken,
  checkPermission("staff", "listado"),
  getAllStaffUsers
);
router.get(
  "/:id",
  verifyToken,
  checkPermission("staff", "listado"),
  getStaffUserById
);
router.post(
  "/change-password/:id",
  verifyToken,
  checkPermission("staff", "editar"),
  changeStaffPassword
);

export default router;
