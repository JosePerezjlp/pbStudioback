import express from "express";

import { verifyToken } from "../middleware/authMiddleware";
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

router.get("/check-email", verifyToken, checkStaffEmailExists);
router.post("/", verifyToken, createStaffUser);
router.put("/:id", verifyToken, updateStaffUser);
router.delete("/:id", verifyToken, deleteStaffUser);
router.get("/", verifyToken, getAllStaffUsers);
router.get("/:id", verifyToken, getStaffUserById);
router.post("/change-password/:id", verifyToken, changeStaffPassword);

export default router;
