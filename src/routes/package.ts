import express from "express";

import { verifyToken } from "../middleware/authMiddleware";
import {
  createPackageController,
  deletePackageController,
  getAllPackagesController,
  getPackageByIdController,
  updatePackageController,
} from "../controllers/packageController";
import { packageValidations } from "../middleware/packageValidation";

const router = express.Router();

router.get("/", verifyToken, getAllPackagesController);
router.get("/:packageId", verifyToken, getPackageByIdController);
router.post("/", verifyToken, packageValidations, createPackageController);
router.put(
  "/:packageId",
  verifyToken,
  packageValidations,
  updatePackageController
);
router.delete("/:packageId", verifyToken, deletePackageController);

export default router;
